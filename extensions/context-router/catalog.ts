export type ToolRecord = {
  name?: unknown;
  description?: unknown;
  sourceInfo?: { source?: unknown };
};

export type SkillRecord = {
  name?: unknown;
  description?: unknown;
  filePath?: unknown;
};

export type ToolMatch = {
  name: string;
  description: string;
  source: "builtin" | "sdk" | "extension";
  active: boolean;
};

export type SkillMatch = {
  name: string;
  description: string;
  path: string;
};

export function projectToolCatalog(
  tools: readonly ToolRecord[],
  _activeNames: readonly string[],
  _query: string,
): ToolMatch[] {
  return tools as ToolMatch[];
}

export function selectCurrentToolMatches(
  _matches: readonly ToolMatch[],
  requestedNames: readonly string[],
  _registeredNames: readonly string[],
): string[] {
  return [...requestedNames];
}

export function projectSkillCatalog(
  skills: readonly SkillRecord[],
  _query: string,
): SkillMatch[] {
  return skills as SkillMatch[];
}
