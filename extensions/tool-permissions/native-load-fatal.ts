/** Crash Pi when the WASM permission engine cannot load. */
export function fatalNativeEngineUnavailable(reason: string): never {
  const message = [
    "Fatal: tool-permissions WASM permission engine failed to load.",
    `Reason: ${reason}`,
    "No TypeScript fallback is available; Pi cannot continue.",
    "Build the WASM artifact from the repo root:",
    "  npm run build:native",
    "Requires wasi-sdk at WASI_SDK_PATH or ~/.local/wasi-sdk.",
  ].join("\n");
  console.error(message);
  process.exit(1);
  throw new Error(message);
}
