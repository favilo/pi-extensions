export type SubagentToolRequestCallArgs = {
  toolName?: string;
  input?: Record<string, unknown>;
};

export type Theme = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

export type RenderComponent = {
  render(width: number): string[];
  invalidate?(): void;
};

export function renderSubagentToolRequestCall(
  _args: SubagentToolRequestCallArgs,
  _theme: Theme,
): RenderComponent {
  return {
    render(_width) {
      return [];
    },
  };
}
