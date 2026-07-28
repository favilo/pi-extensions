export const ENABLE_TERMINAL_FOCUS_REPORTING = "\x1b[?1004h";
export const DISABLE_TERMINAL_FOCUS_REPORTING = "\x1b[?1004l";

export function terminalFocusFromInput(data: string): boolean | undefined {
  if (data === "\x1b[I") return true;
  if (data === "\x1b[O") return false;
  return undefined;
}

export function hardwareCursorVisibility(terminalFocused: boolean, focusedVisibility: boolean): boolean {
  return terminalFocused && focusedVisibility;
}
