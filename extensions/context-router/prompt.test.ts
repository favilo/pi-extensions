import assert from "node:assert";
import { test } from "node:test";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { sanitizeSkillsPrompt, buildAvailabilityPrompt } from "./prompt.ts";

test("sanitizeSkillsPrompt replaces exactly one canonical skills stanza", () => {
  const skills = [
    { name: "test-skill", description: "A skill for testing", filePath: "/path/to/SKILL.md" },
  ];
  const stanza = formatSkillsForPrompt(skills as any);
  const initialPrompt = `HEADER SECTION\n${stanza}\nFOOTER SECTION`;

  const result = sanitizeSkillsPrompt(initialPrompt, skills);
  assert.strictEqual(result.outcome, "replaced");
  assert.strictEqual(result.count, 1);
  assert.strictEqual(result.systemPrompt, "HEADER SECTION\n\nFOOTER SECTION");
  assert.strictEqual(result.byteDelta, result.systemPrompt.length - initialPrompt.length);
  assert.ok(result.byteDelta < 0);
});

test("sanitizeSkillsPrompt returns absent when prompt contains no skills stanza", () => {
  const skills = [
    { name: "test-skill", description: "A skill for testing", filePath: "/path/to/SKILL.md" },
  ];
  const initialPrompt = "HEADER SECTION ONLY\nFOOTER SECTION ONLY";

  const result = sanitizeSkillsPrompt(initialPrompt, skills);
  assert.strictEqual(result.outcome, "absent");
  assert.strictEqual(result.count, 0);
  assert.strictEqual(result.byteDelta, 0);
  assert.strictEqual(result.systemPrompt, initialPrompt);
});

test("sanitizeSkillsPrompt returns ambiguous when prompt contains multiple skills stanzas", () => {
  const skills = [
    { name: "test-skill", description: "A skill for testing", filePath: "/path/to/SKILL.md" },
  ];
  const stanza = formatSkillsForPrompt(skills as any);
  const initialPrompt = `HEADER\n${stanza}\nMIDDLE\n${stanza}\nFOOTER`;

  const result = sanitizeSkillsPrompt(initialPrompt, skills);
  assert.strictEqual(result.outcome, "ambiguous");
  assert.strictEqual(result.count, 2);
  assert.strictEqual(result.byteDelta, 0);
  assert.strictEqual(result.systemPrompt, initialPrompt);
});

test("sanitizeSkillsPrompt returns absent when skills array is empty", () => {
  const initialPrompt = "HEADER SECTION\nFOOTER SECTION";
  const result = sanitizeSkillsPrompt(initialPrompt, []);
  assert.strictEqual(result.outcome, "absent");
  assert.strictEqual(result.count, 0);
  assert.strictEqual(result.byteDelta, 0);
  assert.strictEqual(result.systemPrompt, initialPrompt);
});

test("buildAvailabilityPrompt returns bounded non-MCP summaries and compressed lists", () => {
  const section = buildAvailabilityPrompt({
    summaries: [
      { name: "read", description: "Read file contents" },
      { name: "bash", description: "Run shell commands" },
      { name: "find_tools", description: "Find registered tools" },
    ],
    suppressedTools: ["mcp__deploy", "mcp__build"],
    skillNames: ["deploy", "test"],
  });

  assert.match(section, /read\(Read file contents…\)/);
  assert.match(section, /bash\(Run shell commands…\)/);
  assert.match(section, /find_tools\(Find registered tools…\)/);
  assert.match(section, /Suppressed:.*mcp__build/);
  assert.match(section, /Suppressed:.*mcp__deploy/);
  assert.match(section, /Skills:.*deploy/);
  assert.match(section, /Skills:.*test/);
  assert.doesNotMatch(section, /parameters|schema|path\/to|secret|api_key/);
});

test("buildAvailabilityPrompt escapes XML-special characters in names", () => {
  const section = buildAvailabilityPrompt({
    summaries: [{ name: "tool<>&\"'", description: "A & B" }],
    suppressedTools: ["mcp<>&\"'"],
    skillNames: ["skill<>&\"'"],
  });

  assert.doesNotMatch(section, /<>/);
  assert.match(section, /tool&lt;&gt;&amp;&quot;&apos;/);
  assert.match(section, /mcp&lt;&gt;&amp;&quot;&apos;/);
  assert.match(section, /skill&lt;&gt;&amp;&quot;&apos;/);
});

test("buildAvailabilityPrompt is deterministic and bounded", () => {
  const options = {
    summaries: Array.from({ length: 20 }, (_, i) => ({
      name: `tool-${String(i).padStart(2, "0")}`,
      description: `Description for tool ${i}`,
    })),
    suppressedTools: Array.from({ length: 50 }, (_, i) => `suppressed-${i}`),
    skillNames: Array.from({ length: 30 }, (_, i) => `skill-${i}`),
  };

  const section1 = buildAvailabilityPrompt(options);
  const section2 = buildAvailabilityPrompt(options);
  assert.strictEqual(section1, section2, "must be deterministic");

  const lines = section1.split("\n");
  assert.ok(lines.length <= 200, "must be reasonably bounded");
});
