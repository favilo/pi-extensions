import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("documents user and project permission policy locations and trust behavior", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  assert.match(readme, /~\/\.pi\/agent\/permissions\.toml/);
  assert.match(readme, /\.pi\/permissions\.toml/);
  assert.match(readme, /persisted trust decision/);
  assert.match(readme, /~\/\.pi\/tool-permissions\/audit\.log/);
  assert.match(readme, /seven days/);
});

test("documents both scoped save shortcuts in the prompt implementation", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /Ctrl\+A allow\+save project/);
  assert.match(source, /Ctrl\+Shift\+A allow\+save user/);
  assert.match(source, /matchesKey\(data, "ctrl\+shift\+a"\)/);
  const shifted = source.indexOf('matchesKey(data, "ctrl+shift+a")');
  const plain = source.indexOf('matchesKey(data, "ctrl+a")');
  assert.ok(shifted >= 0 && plain >= 0 && shifted < plain, "shifted shortcut must be handled before plain Ctrl+A");
});
