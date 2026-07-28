import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DISABLE_TERMINAL_FOCUS_REPORTING,
  ENABLE_TERMINAL_FOCUS_REPORTING,
  hardwareCursorVisibility,
  terminalFocusFromInput,
} from "./render.ts";

const WIDGET_ID = "focus-aware-cursor";

export default function focusAwareCursor(pi: ExtensionAPI): void {
  let cleanup: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setWidget(WIDGET_ID, (tui) => {
      cleanup?.();

      let terminalFocused = true;
      let focusedVisibility = tui.getShowHardwareCursor();
      let disposed = false;

      tui.terminal.write(ENABLE_TERMINAL_FOCUS_REPORTING);
      const removeFocusListener = tui.addInputListener((data) => {
        const nextFocus = terminalFocusFromInput(data);
        if (nextFocus === undefined) return undefined;

        if (!nextFocus) focusedVisibility = tui.getShowHardwareCursor();
        terminalFocused = nextFocus;
        tui.setShowHardwareCursor(hardwareCursorVisibility(terminalFocused, focusedVisibility));
        tui.requestRender();
        return { consume: true };
      });

      const disposeWidget = () => {
        if (disposed) return;
        disposed = true;
        removeFocusListener();
        tui.terminal.write(DISABLE_TERMINAL_FOCUS_REPORTING);
        tui.setShowHardwareCursor(focusedVisibility);
      };
      cleanup = disposeWidget;

      return {
        render(): string[] {
          return [];
        },
        invalidate(): void { },
        dispose(): void {
          disposeWidget();
        },
      };
    });
  });

  pi.on("session_shutdown", () => {
    cleanup?.();
    cleanup = undefined;
  });
}
