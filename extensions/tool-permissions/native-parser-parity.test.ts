import "../test-support/forbid-fetch.ts";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseToml } from "smol-toml";
import { parseBashCommand, type BashParseResult } from "./bash-parser.ts";

type Corpus = { cases: Array<{ name: string; command: string }> };
type NativeParser = (request: {
  version: number;
  operation: string;
  nonce: string;
  command: string;
}) => unknown;

function loadNativeParser(): NativeParser | undefined {
  try {
    const require = createRequire(import.meta.url);
    const native = require("./native/generated/index.js") as { parse?: NativeParser };
    return native.parse;
  } catch {
    return undefined;
  }
}

function comparable(result: BashParseResult): unknown {
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    subcommands: result.subcommands.map(({ normalized, command, args, span }) => ({ normalized, command, args, span })),
  };
}

test("native parser matches the TypeScript parser across the shared corpus", (t) => {
  const parseNative = loadNativeParser();
  if (!parseNative) {
    t.skip("native artifact is not built; run npm run build:native for native parity verification");
    return;
  }

  const corpus = parseToml(readFileSync(new URL("./native-parser-corpus.toml", import.meta.url), "utf8")) as unknown as Corpus;
  for (const fixture of corpus.cases) {
    const expected = parseBashCommand(fixture.command);
    const actual = parseNative({ version: 1, operation: "parse", nonce: fixture.name, command: fixture.command }) as {
      ok: boolean;
      reason: string;
      subcommands: Array<{ normalized: string; command: string; args: string[]; start: number; end: number }>;
    };
    const nativeResult: BashParseResult = actual.ok
      ? { ok: true, subcommands: actual.subcommands.map((subcommand) => ({
        normalized: subcommand.normalized,
        command: subcommand.command,
        args: subcommand.args,
        span: { start: subcommand.start, end: subcommand.end },
      })) }
      : { ok: false, reason: actual.reason as "unsupported_syntax" | "parse_error", detail: "native parser diagnostic" };
    assert.deepEqual(comparable(nativeResult), comparable(expected), fixture.name);
  }
});
