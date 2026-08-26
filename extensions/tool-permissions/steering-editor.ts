import { Editor, type EditorTheme, type TUI, matchesKey } from "@earendil-works/pi-tui";

export type SteeringEditorMode = "normal" | "insert";

export interface SteeringEditorOptions {
  tui?: TUI;
  theme?: EditorTheme;
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
 * SteeringEditor embeds the official Pi TUI Editor component UI node
 * while providing modal Vim keybindings and permission prompt integration.
 */
export class SteeringEditor {
  private editor: Editor;
  private vimMode: boolean = false;
  private mode: SteeringEditorMode = "insert";

  constructor(options: SteeringEditorOptions = {}) {
    const tui: any = options.tui ?? { requestRender: () => {} };
    if (!tui.terminal) {
      tui.terminal = { rows: 24, cols: 80 };
    }
    const theme: EditorTheme = options.theme ?? defaultTheme;

    this.editor = new Editor(tui as TUI, theme, { paddingX: 0 });
    this.vimMode = options.vimMode ?? false;
    this.mode = this.vimMode ? "insert" : "insert";

    if (options.initialText) {
      this.editor.setText(options.initialText);
    }
  }

  get focused(): boolean {
    return this.editor.focused;
  }

  set focused(value: boolean) {
    this.editor.focused = value;
  }

  setVimMode(enabled: boolean): void {
    this.vimMode = enabled;
    if (!enabled) {
      this.mode = "insert";
    }
  }

  getMode(): SteeringEditorMode {
    return this.mode;
  }

  getValue(): string {
    return this.editor.getExpandedText();
  }

  setValue(text: string): void {
    this.editor.setText(text);
  }

  handleInput(data: string): void {
    if (!data) return;

    if (matchesKey(data, "escape")) {
      if (this.vimMode && this.mode === "insert") {
        this.mode = "normal";
        return;
      }
    }

    if (this.mode === "insert" || !this.vimMode) {
      this.editor.handleInput(data);
      return;
    }

    // Normal Vim mode navigation and manipulation via Editor calls
    switch (data) {
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
        // Pass modifier keys / paste buffers through to Editor
        if (data.length > 1 || data.charCodeAt(0) < 32) {
          this.editor.handleInput(data);
        }
        break;
    }
  }

  render(width: number): string[] {
    const modeLabel = this.vimMode ? (this.mode === "normal" ? " [NORMAL]" : " [INSERT]") : "";
    const effectiveWidth = Math.max(1, width - modeLabel.length);
    const rawLines = this.editor.render(effectiveWidth);

    // Editor.render() includes top border (line 0) and bottom border (last line).
    // Extract the actual content lines between the borders.
    let contentLines =
      rawLines.length > 2 ? rawLines.slice(1, -1) : rawLines.length === 1 ? rawLines : [];
    if (contentLines.length === 0) {
      contentLines = [""];
    }

    if (modeLabel) {
      const lastIdx = contentLines.length - 1;
      contentLines[lastIdx] = contentLines[lastIdx] + modeLabel;
    }
    return contentLines;
  }

  invalidate(): void {
    this.editor.invalidate();
  }
}
