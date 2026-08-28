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

/** Converts shell output chunks into ordered, stream-attributed completed-line events. */
export function createBackgroundBashMonitor(
  onEvent: (event: BackgroundBashMonitorEvent) => void,
): BackgroundBashMonitor {
  const pending: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
  let sequence = 0;
  let closed = false;

  function emitCompleted(stream: "stdout" | "stderr"): void {
    let newline = pending[stream].indexOf("\n");
    while (newline !== -1) {
      const line = pending[stream].slice(0, newline).replace(/\r$/, "");
      pending[stream] = pending[stream].slice(newline + 1);
      onEvent({ stream, sequence: ++sequence, line });
      newline = pending[stream].indexOf("\n");
    }
  }

  function append(stream: "stdout" | "stderr", chunk: string): void {
    if (closed || chunk.length === 0) return;
    pending[stream] += chunk;
    emitCompleted(stream);
  }

  function flush(): void {
    if (closed) return;
    for (const stream of ["stdout", "stderr"] as const) {
      if (pending[stream].length === 0) continue;
      const line = pending[stream].replace(/\r$/, "");
      pending[stream] = "";
      onEvent({ stream, sequence: ++sequence, line });
    }
  }

  return {
    append,
    flush,
    close() {
      if (closed) return;
      flush();
      closed = true;
    },
  };
}
