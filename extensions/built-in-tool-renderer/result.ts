type ToolResult = {
  content: Array<{ type: string; text?: string }>;
};

export function toolErrorText(result: ToolResult, isError: boolean, fallback: string): string | undefined {
  if (!isError) return undefined;

  const content = result.content.find((item) => item.type === "text" && item.text);
  return content?.text?.split("\n")[0] || fallback;
}

/** Extract the user steering annotation attached to a tool result, if any. */
export function steeringAnnotation(result: ToolResult): string | undefined {
  for (const item of result.content) {
    if (item.type !== "text" || !item.text) continue;
    const match = item.text.match(/<user-steering\b[^>]*>\s*([\s\S]*?)\s*<\/user-steering>/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}
