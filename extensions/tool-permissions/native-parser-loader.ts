import { createRequire } from "node:module";
import { createNativeProbeRequest, decodeNativeProbeResponse, NATIVE_CONTRACT_VERSION, NATIVE_PARSER_NONCE } from "./native-contract.ts";
import type { BashParseResult, ParsedSubcommand } from "./bash-parser.ts";
import type { NativeOperation } from "./native/index.d.ts";

type NativeParserModule = {
  probe(request: unknown): unknown;
  parse(request: unknown): unknown;
};

let cached: { path: string; module: NativeParserModule } | undefined;

function loadModule(path: string): NativeParserModule {
  if (cached?.path === path) return cached.module;
  const module = createRequire(import.meta.url)(path) as Partial<NativeParserModule>;
  if (typeof module.probe !== "function" || typeof module.parse !== "function") {
    throw new Error("native parser module is missing probe or parse");
  }
  decodeNativeProbeResponse(module.probe(createNativeProbeRequest(NATIVE_PARSER_NONCE)));
  cached = { path, module: module as NativeParserModule };
  return cached.module;
}

function decodeParseResult(value: unknown): BashParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("native parser response must be an object");
  const response = value as Record<string, unknown>;
  if (response.version !== NATIVE_CONTRACT_VERSION || response.operation !== ("parse" as NativeOperation) || response.nonce !== NATIVE_PARSER_NONCE || typeof response.ok !== "boolean") throw new Error("native parser response contract mismatch");
  if (typeof response.reason !== "string" || typeof response.detail !== "string" || !Array.isArray(response.subcommands)) throw new Error("native parser response shape is invalid");
  if (!response.ok) {
    if (response.reason !== "unsupported_syntax" && response.reason !== "parse_error") throw new Error("native parser failure reason is invalid");
    return { ok: false, reason: response.reason, detail: response.detail };
  }
  const subcommands = response.subcommands.map((value): ParsedSubcommand => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("native subcommand must be an object");
    const subcommand = value as Record<string, unknown>;
    if (typeof subcommand.normalized !== "string" || typeof subcommand.command !== "string" || !Array.isArray(subcommand.args) || !subcommand.args.every((arg) => typeof arg === "string")) throw new Error("native subcommand shape is invalid");
    const range = { start: subcommand.start, end: subcommand.end };
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || (range.start as number) < 0 || (range.end as number) < (range.start as number)) throw new Error("native subcommand span is invalid");
    return { normalized: subcommand.normalized, command: subcommand.command, args: subcommand.args as string[], span: { start: range.start as number, end: range.end as number } };
  });
  return { ok: true, subcommands };
}

export function parseWithNativeFallback(command: string, fallback: () => BashParseResult): BashParseResult {
  const packagePath = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  if (!packagePath) return fallback();
  try {
    const module = loadModule(packagePath);
    const result = module.parse({ version: NATIVE_CONTRACT_VERSION, operation: "parse" as NativeOperation, nonce: NATIVE_PARSER_NONCE, command });
    return decodeParseResult(result);
  } catch {
    return fallback();
  }
}
