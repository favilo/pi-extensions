type ToolResult = {
  content: Array<{ type: string; text?: string }>;
};

export function toolErrorText(result: ToolResult, isError: boolean, fallback: string): string | undefined {
  if (!isError) return undefined;

  const content = result.content.find((item) => item.type === "text" && item.text);
  return content?.text?.split("\n")[0] || fallback;
}
