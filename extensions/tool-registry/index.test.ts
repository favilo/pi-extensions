import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { getPublishedToolDefinitions, publishToolDefinition, unpublishToolDefinition } from "./index.ts";

test("published definitions are replaced by later definitions with the same name", () => {
  const first = { name: "registry-test", label: "first", description: "first", parameters: {}, execute: async () => ({ content: [] }) } as never;
  const second = { name: "registry-test", label: "second", description: "second", parameters: {}, execute: async () => ({ content: [] }) } as never;

  publishToolDefinition(first);
  publishToolDefinition(second);
  assert.equal(getPublishedToolDefinitions().find((tool) => tool.name === "registry-test")?.label, "second");
  unpublishToolDefinition("registry-test");
  assert.equal(getPublishedToolDefinitions().some((tool) => tool.name === "registry-test"), false);
});
