const MAX_RESULTS = 8;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_PATH_LENGTH = 512;
const MAX_QUERY_LENGTH = 160;

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

type Ranked<T> = { value: T; score: number };

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";

  return redactSecrets(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function redactSecrets(value: string): string {
  return value
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*([:=])\s*[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/\bsk-[a-z0-9_-]{16,}\b/gi, "[REDACTED]");
}

function queryTerms(query: string): string[] {
  const normalized = normalizeText(query, MAX_QUERY_LENGTH).toLocaleLowerCase().trim();
  if (!normalized) return [];
  if (normalized === "*" || normalized === "all") return ["*"];
  const terms = normalized
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean);
  return terms.length > 0 ? terms : [];
}

function sourceCategory(source: unknown): ToolMatch["source"] {
  if (source === "builtin") return "builtin";
  if (source === "sdk") return "sdk";
  return "extension";
}

function countOccurrences(value: string, term: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const match = value.indexOf(term, offset);
    if (match === -1) return count;
    count += 1;
    offset = match + term.length;
  }
}

function scoreMatch(name: string, description: string, source: string, terms: readonly string[]): number | undefined {
  if (terms.length === 1 && terms[0] === "*") return 1;

  const searchableName = name.toLocaleLowerCase();
  const searchableDescription = description.toLocaleLowerCase();
  const searchableSource = source.toLocaleLowerCase();
  let score = 0;

  const activeTerms = terms.filter((term) => term !== "all" && term !== "*");
  const termsToUse = activeTerms.length > 0 ? activeTerms : terms;

  for (const term of termsToUse) {
    const termScore = (countOccurrences(searchableName, term) * 2)
      + countOccurrences(searchableDescription, term)
      + countOccurrences(searchableSource, term);
    score += termScore;
  }

  return score > 0 ? score : undefined;
}

function orderMatches<T extends { name: string }>(matches: Ranked<T>[]): T[] {
  return matches
    .sort((left, right) => right.score - left.score || left.value.name.localeCompare(right.value.name))
    .slice(0, MAX_RESULTS)
    .map((match) => match.value);
}

export function projectToolCatalog(
  tools: readonly ToolRecord[],
  activeNames: readonly string[],
  query: string,
): ToolMatch[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const active = new Set(activeNames);
  const unique = new Map<string, ToolMatch>();
  for (const tool of tools) {
    const name = normalizeText(tool.name, MAX_NAME_LENGTH);
    const description = normalizeText(tool.description, MAX_DESCRIPTION_LENGTH);
    if (!name || !description || unique.has(name)) continue;

    unique.set(name, {
      name,
      description,
      source: sourceCategory(tool.sourceInfo?.source),
      active: active.has(name),
    });
  }

  const matches: Ranked<ToolMatch>[] = [];
  for (const tool of unique.values()) {
    const score = scoreMatch(tool.name, tool.description, tool.source, terms);
    if (score !== undefined) matches.push({ value: tool, score });
  }
  return orderMatches(matches);
}

export function selectCurrentToolMatches(
  matches: readonly ToolMatch[],
  requestedNames: readonly string[],
  registeredNames: readonly string[],
): string[] {
  const selected = new Set(requestedNames);
  const registered = new Set(registeredNames);

  return matches
    .map((match) => match.name)
    .filter((name) => selected.has(name) && registered.has(name))
    .slice(0, MAX_RESULTS);
}

function isSkillPath(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md") || path.endsWith("\\SKILL.md");
}

export function projectSkillCatalog(
  skills: readonly SkillRecord[],
  query: string,
): SkillMatch[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const unique = new Map<string, SkillMatch>();
  for (const skill of skills) {
    const name = normalizeText(skill.name, MAX_NAME_LENGTH);
    const description = normalizeText(skill.description, MAX_DESCRIPTION_LENGTH);
    const path = typeof skill.filePath === "string" && skill.filePath.length <= MAX_PATH_LENGTH
      ? skill.filePath
      : "";
    if (!name || !description || !path || !isSkillPath(path) || unique.has(name)) continue;

    unique.set(name, { name, description, path });
  }

  const matches: Ranked<SkillMatch>[] = [];
  for (const skill of unique.values()) {
    const score = scoreMatch(skill.name, skill.description, "skill", terms);
    if (score !== undefined) matches.push({ value: skill, score });
  }
  return orderMatches(matches);
}
