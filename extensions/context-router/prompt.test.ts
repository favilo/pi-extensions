import assert from "node:assert";
import { test } from "node:test";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { sanitizeSkillsPrompt } from "./prompt.ts";

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
