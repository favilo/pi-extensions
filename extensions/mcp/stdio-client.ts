import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type StdioMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type JsonRpcResponse = { id?: number; result?: any; error?: { message?: string };
};
export type SpawnMcpProcess = (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;
export type StdioMcpClientOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  framing?: "jsonl" | "content-length";
  clientName?: string;
  clientVersion?: string;
  requestTimeoutMs?: number;
  spawnProcess?: SpawnMcpProcess;
};

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_STDERR_BYTES = 8_192;

/** JSON-RPC MCP client for servers using newline or Content-Length stdio transport. */
export class StdioMcpClient {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly framing: "jsonl" | "content-length";
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly spawnProcess: SpawnMcpProcess;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private stderrBuffer = "";
  private child: ChildProcessWithoutNullStreams | undefined;

  constructor(commandOrOptions: string | StdioMcpClientOptions, spawnProcess?: SpawnMcpProcess) {
    const options = typeof commandOrOptions === "string" ? { command: commandOrOptions, spawnProcess } : commandOrOptions;
    this.command = options.command;
    this.args = options.args ?? [];
    this.cwd = options.cwd;
    this.env = options.env;
    this.framing = options.framing ?? "jsonl";
    this.clientName = options.clientName ?? "pi-extensions";
    this.clientVersion = options.clientVersion ?? "0.1.0";
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"] }));
  }

  async start(): Promise<StdioMcpTool[]> {
    await this.initialize();
    return this.listTools();
  }

  async initialize(): Promise<void> {
    this.child = this.spawnProcess(this.command, this.args, { cwd: this.cwd, env: { ...process.env, ...this.env } });
    this.child.stdout.on("data", (chunk: Buffer | string) => this.receive(Buffer.from(chunk)));
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrBuffer = (this.stderrBuffer + String(chunk)).slice(-MAX_STDERR_BYTES);
    });
    this.child.on("error", (error) => this.fail(this.withStderr(error instanceof Error ? error : new Error(String(error)))));
    this.child.on("exit", (code, signal) => this.fail(this.withStderr(new Error(`MCP server exited (${code ?? signal ?? "unknown"})`))));

    await this.request("initialize", {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<StdioMcpTool[]> {
    const response = await this.request("tools/list", {});
    return (response.tools ?? []) as StdioMcpTool[];
  }

  call(name: string, arguments_: unknown): Promise<any> {
    return this.request("tools/call", { name, arguments: arguments_ ?? {} });
  }

  close(): void {
    this.fail(new Error("MCP client closed"));
    this.child?.kill();
    this.child = undefined;
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(this.withStderr(new Error(`MCP request timed out for ${method}`)));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) throw this.withStderr(new Error("MCP server is not writable"));
    const body = JSON.stringify(message);
    if (this.framing === "jsonl") this.child.stdin.write(`${body}\n`);
    else this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      while (this.framing === "jsonl" ? this.readJsonLine() : this.readContentLength()) {}
    } catch (error) {
      this.fail(this.withStderr(error instanceof Error ? error : new Error(String(error))));
      this.child?.kill();
    }
  }

  private readJsonLine(): boolean {
    const lineEnd = this.buffer.indexOf(10);
    if (lineEnd === -1) return false;
    const body = this.buffer.subarray(0, lineEnd).toString("utf8").replace(/\r$/, "");
    this.buffer = this.buffer.subarray(lineEnd + 1);
    if (body.trim()) this.handle(JSON.parse(body) as JsonRpcResponse);
    return true;
  }

  private readContentLength(): boolean {
    const headerEnd = this.buffer.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) return false;
    const header = this.buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) throw new Error("MCP response missing Content-Length");
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (this.buffer.length < bodyStart + length) return false;
    const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    this.buffer = this.buffer.subarray(bodyStart + length);
    this.handle(JSON.parse(body) as JsonRpcResponse);
    return true;
  }

  private handle(response: JsonRpcResponse): void {
    if (response.id === undefined) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) pending.reject(this.withStderr(new Error(response.error.message ?? "MCP request failed")));
    else pending.resolve(response.result);
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private withStderr(error: Error): Error {
    const stderr = this.stderrBuffer.trim();
    return stderr ? new Error(`${error.message}; stderr: ${stderr}`) : error;
  }
}
