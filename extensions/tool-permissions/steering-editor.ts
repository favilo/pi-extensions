import { Editor, type Component, type EditorTheme, type Focusable, type TUI, matchesKey } from "@earendil-works/pi-tui";

export type SteeringEditorMode = "normal" | "insert";

export type CustomEditorFactory = (tui: TUI, theme: any, keybindings: any) => Component;

export interface SteeringEditorOptions {
  tui?: TUI;
  theme?: EditorTheme;
  keybindings?: unknown;
  customEditorFactory?: CustomEditorFactory;
  vimMode?: boolean;
  initialText?: string;
}

const defaultTheme: EditorTheme = {
  borderColor: (s: string) => s,
  selectList: {
    selectedPrefix: (s: string) => s,
    selectedText: (s: string) => s,
    description: (s: string) => s,
    scrollInfo: (s: string) => s,
    noMatch: (s: string) => s,
  },
};

/**
 * SteeringEditor embeds the registered custom editor (e.g. pi-vim-mode plugin)
 * via ctx.ui.getEditorComponent() if available, or falls back to the official
 * Pi TUI Editor component.
 */
export class SteeringEditor implements Component, Focusable {
  private editor?: Editor;
  private customEditor?: Component;
  private vimMode: boolean = false;
  private mode: SteeringEditorMode = "insert";

  constructor(options: SteeringEditorOptions = {}) {
    const tui: any = options.tui ?? { requestRender: () => {} };
    if (!tui.terminal) {
      tui.terminal = { rows: 24, cols: 80 };
    }
    const theme: EditorTheme = options.theme ?? defaultTheme;

    if (options.customEditorFactory) {
      try {
        const customComp = options.customEditorFactory(tui as TUI, theme, options.keybindings);
        if (customComp) {
          this.customEditor = customComp;
        }
      } catch {
        // Fallback to built-in Editor if factory fails
      }
    }

    if (!this.customEditor) {
      this.editor = new Editor(tui as TUI, theme, { paddingX: 0 });
      this.editor.disableSubmit = true;
      if (options.initialText) {
        this.editor.setText(options.initialText);
      }
    }

    this.vimMode = options.vimMode ?? false;
    this.mode = this.vimMode ? "insert" : "insert";
  }

  get focused(): boolean {
    if (this.customEditor && "focused" in this.customEditor) {
      return Boolean((this.customEditor as any).focused);
    }
    return this.editor?.focused ?? false;
  }

  set focused(value: boolean) {
    if (this.customEditor && "focused" in this.customEditor) {
      (this.customEditor as any).focused = value;
    }
    if (this.editor) {
      this.editor.focused = value;
    }
  }

  setVimMode(enabled: boolean): void {
    this.vimMode = enabled;
    if (!enabled) {
      this.mode = "insert";
    }
  }

  getMode(): SteeringEditorMode {
    if (this.customEditor && "mode" in this.customEditor) {
      return (this.customEditor as any).mode;
    }
    return this.mode;
  }

  getValue(): string {
    if (this.customEditor) {
      if (typeof (this.customEditor as any).getExpandedText === "function") {
        return (this.customEditor as any).getExpandedText();
      }
      if (typeof (this.customEditor as any).getValue === "function") {
        return (this.customEditor as any).getValue();
      }
      if (typeof (this.customEditor as any).getText === "function") {
        return (this.customEditor as any).getText();
      }
    }
    return this.editor?.getExpandedText() ?? "";
  }

  setValue(text: string): void {
    if (this.customEditor && typeof (this.customEditor as any).setText === "function") {
      (this.customEditor as any).setText(text);
      return;
    }
    this.editor?.setText(text);
  }

  handleInput(data: string): void {
    if (!data) return;

    const inputData = data === "\r" || data === "\r\n" ? "\n" : data;

    if (this.customEditor) {
      this.customEditor.handleInput?.(inputData);
      return;
    }

    if (!this.editor) return;

    if (matchesKey(inputData, "escape")) {
      if (this.vimMode && this.mode === "insert") {
        this.mode = "normal";
        return;
      }
    }

    if (this.mode === "insert" || !this.vimMode) {
      this.editor.handleInput(inputData);
      return;
    }

    // Normal Vim mode navigation and manipulation via Editor calls
    switch (inputData) {
      case "i":
        this.mode = "insert";
        break;
      case "a":
        this.editor.handleInput("\x1b[C"); // Right
        this.mode = "insert";
        break;
      case "I":
        this.editor.handleInput("\x1b[H"); // Home / Line start
        this.mode = "insert";
        break;
      case "A":
        this.editor.handleInput("\x1b[F"); // End / Line end
        this.mode = "insert";
        break;
      case "h":
        this.editor.handleInput("\x1b[D"); // Left
        break;
      case "l":
        this.editor.handleInput("\x1b[C"); // Right
        break;
      case "j":
        this.editor.handleInput("\x1b[B"); // Down
        break;
      case "k":
        this.editor.handleInput("\x1b[A"); // Up
        break;
      case "0":
        this.editor.handleInput("\x1b[H"); // Home
        break;
      case "$":
        this.editor.handleInput("\x1b[F"); // End
        break;
      case "x":
        this.editor.handleInput("\x1b[3~"); // Forward delete
        break;
      default:
        if (data.length > 1 || data.charCodeAt(0) < 32) {
          this.editor.handleInput(data);
        }
        break;
    }
  }

  render(width: number): string[] {
    if (this.customEditor) {
      return this.customEditor.render(width);
    }

    if (!this.editor) return [""];

    const modeLabel = this.vimMode ? (this.mode === "normal" ? " [NORMAL]" : " [INSERT]") : "";
    const effectiveWidth = Math.max(1, width - modeLabel.length);
    const lines = this.editor.render(effectiveWidth);
    if (!this.vimMode) {
      return lines;
    }

    if (lines.length === 0) {
      return [modeLabel.trim()];
    }

    // Append mode indicator to the line above bottom border
    const contentIdx = lines.length > 2 ? lines.length - 2 : lines.length - 1;
    lines[contentIdx] = lines[contentIdx] + modeLabel;
    return lines;
  }

  invalidate(): void {
    this.customEditor?.invalidate?.();
    this.editor?.invalidate();
  }
}
