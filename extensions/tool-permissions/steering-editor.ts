import type { Component, Focusable } from "@earendil-works/pi-tui";

export type SteeringEditorMode = "normal" | "insert";

export interface SteeringEditorOptions {
  vimMode?: boolean;
  initialText?: string;
}

/**
 * Prototype boundary for embedding prompt editor input behavior and Vim mode
 * in permission prompt steering.
 */
export class SteeringEditor implements Component, Focusable {
  focused: boolean = false;
  private mode: SteeringEditorMode = "insert";
  private text: string = "";

  constructor(options: SteeringEditorOptions = {}) {
    this.text = options.initialText ?? "";
    this.mode = options.vimMode ? "insert" : "insert";
  }

  handleInput(data: string): void {
    if (data) {
      this.text += data;
    }
  }

  getValue(): string {
    return this.text;
  }

  setValue(text: string): void {
    this.text = text;
  }

  getMode(): SteeringEditorMode {
    return this.mode;
  }

  render(_width: number): string[] {
    return [this.text];
  }

  invalidate(): void {
    // Component cache invalidation
  }
}
