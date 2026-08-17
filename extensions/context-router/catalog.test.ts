import assert from "node:assert/strict";
import test from "node:test";
import {
  projectSkillCatalog,
  projectToolCatalog,
  selectCurrentToolMatches,
  type SkillRecord,
  type ToolRecord,
} from "./catalog.ts";

test("tool discovery projects normalized, redacted metadata without schemas or raw provenance", () => {
  const tools: ToolRecord[] = [
    {
      name: "mcp__build\u0000",
      description: "Build\nproject with token=super-secret-value-1234567890",
      sourceInfo: {
        source: "mcp",
        path: "/private/provider/tool.ts",
      },
      parameters: { credential: "must not reach the model" },
      promptGuidelines: ["must not reach the model"],
    } as ToolRecord,
  ];

  const matches = projectToolCatalog(tools, ["mcp__build"], "build");

  assert.deepEqual(matches, [
    {
      name: "mcp__build",
      description: "Build project with token=[REDACTED]",
      source: "extension",
      active: true,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(matches), /private|credential|super-secret|parameters|guidelines/i);
});

test("tool discovery supports wildcard, all, and multi-term OR matching", () => {
  const tools: ToolRecord[] = [
    { name: "mcp_build", description: "Build packages" },
    { name: "mcp_deploy", description: "Deploy packages" },
  ];

  const wildcard = projectToolCatalog(tools, [], "*");
  assert.equal(wildcard.length, 2);

  const multiTerm = projectToolCatalog(tools, [], "all available tools build");
  assert.equal(multiTerm.length, 1);
  assert.equal(multiTerm[0].name, "mcp_build");
});

test("tool discovery bounds fields, rejects empty queries, and uses stable score/name ordering", () => {
  const overlong = "x".repeat(1_000);
  const tools: ToolRecord[] = [
    { name: "zeta", description: "build" },
    { name: "alpha", description: "build" },
    { name: "builder", description: overlong },
  ];

  assert.deepEqual(projectToolCatalog(tools, [], "   \u0000\n"), []);

  const matches = projectToolCatalog(tools, [], "build");

  assert.deepEqual(matches.map(({ name }) => name), ["builder", "alpha", "zeta"]);
  assert.ok(matches.every(({ name, description }) => name.length <= 80 && description.length <= 240));
});

test("tool activation accepts only selected current registered matches", () => {
  const matches = projectToolCatalog(
    [
      { name: "mcp_build", description: "Build packages" },
      { name: "mcp_deploy", description: "Deploy packages" },
    ],
    [],
    "packages",
  );

  assert.deepEqual(
    selectCurrentToolMatches(matches, ["mcp_deploy", "missing", "mcp_build"], ["mcp_build", "missing"]),
    ["mcp_build"],
  );
});

test("skill discovery returns bounded SKILL.md metadata without bodies or provenance", () => {
  const skills: SkillRecord[] = [
    {
      name: "deploy\u0007",
      description: "Deploy\nservices with api_key=super-secret-value-1234567890",
      filePath: "/tmp/skills/deploy/SKILL.md",
      body: "must not reach the model",
      sourceInfo: { path: "/private/provenance" },
    } as SkillRecord,
    {
      name: "root-markdown",
      description: "A direct markdown skill",
      filePath: "/tmp/skills/root.md",
    },
  ];

  const matches = projectSkillCatalog(skills, "deploy");

  assert.deepEqual(matches, [
    {
      name: "deploy",
      description: "Deploy services with api_key=[REDACTED]",
      path: "/tmp/skills/deploy/SKILL.md",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(matches), /super-secret|must not reach|private\/provenance|body/i);
});
