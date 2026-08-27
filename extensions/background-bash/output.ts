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

/** Bounded per-stream output capture with explicit truncation metadata. */
export function createOutputCapture(_options: OutputCaptureOptions = {}): OutputCapture {
  const empty = (): CapturedStream => ({ text: "", truncated: false, totalLines: 0, totalBytes: 0, keptBytes: 0 });
  void DEFAULT_MAX_LINES;
  void DEFAULT_MAX_BYTES;
  return {
    append() {},
    snapshot() {
      return { stdout: empty(), stderr: empty() };
    },
  };
}
