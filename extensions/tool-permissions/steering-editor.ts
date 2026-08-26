import { CURSOR_MARKER, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

export type SteeringEditorMode = "normal" | "insert";

export interface SteeringEditorOptions {
  vimMode?: boolean;
  initialText?: string;
}

export class SteeringEditor {
  focused: boolean = false;
  private vimMode: boolean = false;
  private mode: SteeringEditorMode = "insert";
  private text: string = "";
  private cursorPos: number = 0;

  constructor(options: SteeringEditorOptions = {}) {
    this.vimMode = options.vimMode ?? false;
    this.text = options.initialText ?? "";
    this.cursorPos = this.text.length;
    this.mode = this.vimMode ? "insert" : "insert";
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
    return this.text;
  }

  setValue(text: string): void {
    this.text = text;
    this.cursorPos = Math.min(this.cursorPos, this.text.length);
  }

  handleInput(data: string): void {
    if (!data) return;

    if (matchesKey(data, "escape")) {
      if (this.vimMode && this.mode === "insert") {
        this.mode = "normal";
        if (this.text.length > 0) {
          this.cursorPos = Math.min(this.cursorPos, this.text.length - 1);
        }
      }
      return;
    }

    if (this.mode === "insert") {
      if (data === "\x7f" || data === "\x08" || matchesKey(data, "backspace")) {
        if (this.cursorPos > 0) {
          this.text = this.text.slice(0, this.cursorPos - 1) + this.text.slice(this.cursorPos);
          this.cursorPos--;
        }
        return;
      }
      if (matchesKey(data, "left")) {
        this.cursorPos = Math.max(0, this.cursorPos - 1);
        return;
      }
      if (matchesKey(data, "right")) {
        this.cursorPos = Math.min(this.text.length, this.cursorPos + 1);
        return;
      }
      if (matchesKey(data, "home")) {
        this.cursorPos = 0;
        return;
      }
      if (matchesKey(data, "end")) {
        this.cursorPos = this.text.length;
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        this.text = this.text.slice(0, this.cursorPos) + data + this.text.slice(this.cursorPos);
        this.cursorPos++;
        return;
      }
    } else if (this.vimMode && this.mode === "normal") {
      switch (data) {
        case "i":
          this.mode = "insert";
          break;
        case "a":
          this.mode = "insert";
          this.cursorPos = Math.min(this.text.length, this.cursorPos + 1);
          break;
        case "I":
          this.mode = "insert";
          this.cursorPos = 0;
          break;
        case "A":
          this.mode = "insert";
          this.cursorPos = this.text.length;
          break;
        case "h":
          this.cursorPos = Math.max(0, this.cursorPos - 1);
          break;
        case "l":
          if (this.text.length > 0) {
            this.cursorPos = Math.min(this.text.length - 1, this.cursorPos + 1);
          }
          break;
        case "0":
          this.cursorPos = 0;
          break;
        case "$":
          if (this.text.length > 0) {
            this.cursorPos = this.text.length - 1;
          }
          break;
        case "w": {
          const match = /\s\S/.exec(this.text.slice(this.cursorPos));
          if (match) {
            this.cursorPos += match.index + 1;
          } else {
            this.cursorPos = Math.max(0, this.text.length - 1);
          }
          break;
        }
        case "b": {
          const before = this.text.slice(0, this.cursorPos);
          const rev = before.split("").reverse().join("");
          const match = /\S\s/.exec(rev);
          if (match) {
            this.cursorPos = before.length - (match.index + 1);
          } else {
            this.cursorPos = 0;
          }
          break;
        }
        case "x":
          if (this.text.length > 0 && this.cursorPos < this.text.length) {
            this.text = this.text.slice(0, this.cursorPos) + this.text.slice(this.cursorPos + 1);
            if (this.cursorPos >= this.text.length && this.text.length > 0) {
              this.cursorPos = this.text.length - 1;
            }
          }
          break;
      }
    }
  }

  render(width: number): string[] {
    const modeLabel = this.vimMode ? (this.mode === "normal" ? " [NORMAL]" : " [INSERT]") : "";
    const effectiveWidth = Math.max(1, width - modeLabel.length);

    let content = "";
    if (this.focused) {
      const before = this.text.slice(0, this.cursorPos);
      const atChar = this.text[this.cursorPos] ?? " ";
      const after = this.text.slice(this.cursorPos + 1);
      content = `${before}${CURSOR_MARKER}\x1b[7m${atChar}\x1b[27m${after}`;
    } else {
      content = this.text;
    }

    const line = truncateToWidth(content, effectiveWidth) + modeLabel;
    return [line];
  }

  invalidate(): void {
    // Cache invalidation
  }
}
