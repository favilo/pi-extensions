import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAuditLogger } from "./audit.ts";

test("writes to the current UTC log and points audit.log at it", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-permission-audit-"));
  const logger = createAuditLogger({
    homeDir: home,
    now: () => new Date("2026-07-31T23:59:00.000Z"),
  });

  logger.write({ tool: "bash", decision: "allow_once" });

  const datedPath = join(home, ".pi", "tool-permissions", "audit-2026-07-31.log");
  const linkPath = join(home, ".pi", "tool-permissions", "audit.log");
  assert.equal(existsSync(datedPath), true);
  try {
    assert.equal(readlinkSync(linkPath), "audit-2026-07-31.log");
  } catch {
    const aliasStats = statSync(linkPath);
    const datedStats = statSync(datedPath);
    assert.equal(aliasStats.dev, datedStats.dev);
    assert.equal(aliasStats.ino, datedStats.ino);
  }
  assert.match(readFileSync(datedPath, "utf8"), /"decision":"allow_once"/);
});

test("removes dated logs older than seven UTC days", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-permission-audit-"));
  const directory = join(home, ".pi", "tool-permissions");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "audit-2026-07-22.log"), "old\n");
  writeFileSync(join(directory, "audit-2026-07-24.log"), "keep\n");
  const logger = createAuditLogger({
    homeDir: home,
    now: () => new Date("2026-07-31T12:00:00.000Z"),
  });

  logger.write({ tool: "bash", decision: "allow_once" });

  assert.equal(existsSync(join(directory, "audit-2026-07-22.log")), false);
  assert.equal(existsSync(join(directory, "audit-2026-07-24.log")), true);
});

test("warns and falls back when the dated target cannot be written", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-permission-audit-"));
  const target = join(home, ".pi", "tool-permissions", "audit-2026-07-31.log");
  mkdirSync(target, { recursive: true });
  const warnings: string[] = [];
  const logger = createAuditLogger({
    homeDir: home,
    now: () => new Date("2026-07-31T12:00:00.000Z"),
    warn: (message) => warnings.push(message),
  });

  logger.write({ tool: "bash", decision: "allow_once" });

  assert.equal(warnings.length, 1);
  assert.match(readFileSync(join(home, ".config", "pi", "audit.log"), "utf8"), /"tool":"bash"/);
});

test("migrates the legacy log once without duplicating entries", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-permission-audit-"));
  const legacyPath = join(home, ".config", "pi", "audit.log");
  mkdirSync(join(home, ".config", "pi"), { recursive: true });
  const legacyEntry = '{"time":"2026-07-30T12:00:00.000Z","tool":"read"}\\n';
  writeFileSync(legacyPath, legacyEntry);
  const logger = createAuditLogger({
    homeDir: home,
    now: () => new Date("2026-07-31T12:00:00.000Z"),
  });

  logger.write({ tool: "bash", decision: "allow_once" });
  logger.write({ tool: "bash", decision: "allow_once" });

  const datedPath = join(home, ".pi", "tool-permissions", "audit-2026-07-31.log");
  const contents = readFileSync(datedPath, "utf8");
  assert.equal(contents.split(legacyEntry).length - 1, 1);
  assert.equal(existsSync(legacyPath), false);
});
