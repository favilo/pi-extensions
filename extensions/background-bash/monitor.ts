export type BackgroundBashMonitorEvent = {
  stream: "stdout" | "stderr";
  sequence: number;
  line: string;
};

export type BackgroundBashMonitor = {
  append(stream: "stdout" | "stderr", chunk: string): void;
  flush(): void;
  close(): void;
};

export function createBackgroundBashMonitor(
  _onEvent: (event: BackgroundBashMonitorEvent) => void,
): BackgroundBashMonitor {
  return {
    append() {},
    flush() {},
    close() {},
  };
}
