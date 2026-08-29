export type CapturedStream = {
  text: string;
  truncated: boolean;
  totalLines: number;
  totalBytes: number;
  keptBytes: number;
};

export type BackgroundBashOutput = {
  stdout: CapturedStream;
  stderr: CapturedStream;
};

export type OutputCaptureOptions = {
  maxLinesPerStream?: number;
  maxBytesPerStream?: number;
};

export type OutputCapture = {
  append(stream: "stdout" | "stderr", chunk: string): void;
  snapshot(): BackgroundBashOutput;
};

const DEFAULT_MAX_LINES = 1_000;
const DEFAULT_MAX_BYTES = 32 * 1_024;

type StreamState = {
  kept: string;
  keptBytes: number;
  keptNewlines: number;
  totalBytes: number;
  totalNewlines: number;
  lastChar: string | undefined;
  truncated: boolean;
};

/** Prefix spanning at most `maxNewlines` complete lines, each including its terminator. */
function firstCompleteLines(text: string, maxNewlines: number): string {
  if (maxNewlines <= 0) return "";
  let index = -1;
  for (let line = 0; line < maxNewlines; line++) {
    index = text.indexOf("\n", index + 1);
    if (index === -1) return text;
  }
  return text.slice(0, index + 1);
}

/** Longest prefix whose UTF-8 encoding fits within the byte budget, without splitting characters. */
function utf8Prefix(text: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function createStreamState(): StreamState {
  return { kept: "", keptBytes: 0, keptNewlines: 0, totalBytes: 0, totalNewlines: 0, lastChar: undefined, truncated: false };
}

/** Bounded per-stream output capture with explicit truncation metadata. */
export function createOutputCapture(options: OutputCaptureOptions = {}): OutputCapture {
  const maxLines = options.maxLinesPerStream ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytesPerStream ?? DEFAULT_MAX_BYTES;
  const streams: Record<"stdout" | "stderr", StreamState> = { stdout: createStreamState(), stderr: createStreamState() };

  function append(stream: "stdout" | "stderr", chunk: string): void {
    const state = streams[stream];
    state.totalBytes += Buffer.byteLength(chunk, "utf8");
    state.totalNewlines += chunk.split("\n").length - 1;
    if (chunk.length > 0) state.lastChar = chunk.at(-1);
    if (state.truncated) return;

    const byLines = firstCompleteLines(chunk, maxLines - state.keptNewlines);
    const bounded = utf8Prefix(byLines, Math.max(0, maxBytes - state.keptBytes));
    if (bounded.length < chunk.length) state.truncated = true;
    state.kept += bounded;
    state.keptBytes += Buffer.byteLength(bounded, "utf8");
    state.keptNewlines += bounded.split("\n").length - 1;
  }

  return {
    append,
    snapshot() {
      const view = (state: StreamState): CapturedStream => ({
        text: state.kept,
        truncated: state.truncated,
        totalLines: state.totalNewlines + (state.totalBytes > 0 && state.lastChar !== "\n" ? 1 : 0),
        totalBytes: state.totalBytes,
        keptBytes: state.keptBytes,
      });
      return { stdout: view(streams.stdout), stderr: view(streams.stderr) };
    },
  };
}
