import "../test-support/forbid-fetch.ts";
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import { registerNativeToolPermissionsCallbacks } from "./native-registration-loader.ts";

function withNativeRegistrationModule(source: string, run: () => void): void {
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-registration-"));
  const packagePath = join(directory, "index.cjs");
  writeFileSync(packagePath, source, "utf8");
  process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const restorePackagePath = setNativePackagePathForTests(packagePath);
  try {
    run();
  } finally {
    restorePackagePath();
    if (previousPackage === undefined) delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
    if (previousDisable === undefined) delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
    rmSync(directory, { recursive: true, force: true });
  }
}

const compatibleProbe = `exports.probe = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: request.operation, ok: true, nonce: request.nonce });`;

test("native registration passes pi so native can call pi.on for lifecycle diagnostics", async () => {
  const moduleSource = `${compatibleProbe}
exports.registerToolPermissionsCallbacks = (request, pi) => {
  assert.equal(typeof pi.on, "function");
  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("Rust native registration active.", "info");
  });
  return { version: ${NATIVE_CONTRACT_VERSION}, operation: "register_callbacks", ok: true, nonce: request.nonce, registrations: ["session_start"] };
};
const assert = require("node:assert/strict");
`;
  const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
  withNativeRegistrationModule(moduleSource, () => {
    const result = registerNativeToolPermissionsCallbacks({
      on(eventName: string, handler: (event: unknown, ctx: any) => unknown) { handlers.set(eventName, handler); },
    } as never);
    assert.deepEqual(result, { mode: "native", registrations: ["session_start"] });
  });
  const notices: Array<{ message: string; level: string }> = [];
  await handlers.get("session_start")?.({}, { hasUI: true, ui: { notify: (message: string, level: string) => notices.push({ message, level }) } });
  assert.deepEqual(notices, [{ message: "Rust native registration active.", level: "info" }]);
});

test("bundled Rust registration calls pi.on and registerCommand for delegated callbacks", async (t) => {
  let register: ((request: unknown, pi: unknown, bridge?: unknown) => { ok: boolean; operation: string; registrations: string[] }) | undefined;
  try {
    register = (createRequire(import.meta.url)("./native/index.js") as { registerToolPermissionsCallbacks?: typeof register }).registerToolPermissionsCallbacks;
  } catch {
    t.skip("native artifact is not built; run npm run build:native");
    return;
  }
  assert.ok(register);
  const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: unknown) => unknown }>();
  const handledSessionStarts: Array<{ event: unknown; ctx: unknown }> = [];
  const handledToolCalls: Array<{ event: unknown; ctx: unknown }> = [];
  const handledToolResults: Array<{ event: unknown; ctx: unknown }> = [];
  const handledSessionShutdowns: Array<{ event: unknown; ctx: unknown }> = [];
  const handledCommands: Array<{ args: unknown; ctx: unknown }> = [];
  const response = register({ version: NATIVE_CONTRACT_VERSION, operation: "register_callbacks", nonce: "registration-parity" }, {
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown) { handlers.set(eventName, handler); },
    registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: unknown) => unknown }) { commands.set(name, options); },
  }, {
    handleSessionStart(event: unknown, ctx: unknown) {
      handledSessionStarts.push({ event, ctx });
    },
    handleToolCall(event: unknown, ctx: unknown) {
      handledToolCalls.push({ event, ctx });
      return { block: true, reason: "delegated" };
    },
    handleToolResult(event: unknown, ctx: unknown) {
      handledToolResults.push({ event, ctx });
      return { content: [{ type: "text", text: "delegated" }] };
    },
    handleSessionShutdown(event: unknown, ctx: unknown) {
      handledSessionShutdowns.push({ event, ctx });
    },
    handlePermissionsCommand(args: unknown, ctx: unknown) {
      handledCommands.push({ args, ctx });
      return Promise.resolve();
    },
  });
  assert.equal(response.ok, true);
  assert.equal(response.operation, "register_callbacks");
  assert.deepEqual(response.registrations, ["session_start", "tool_call", "tool_result", "session_shutdown", "command:permissions"]);
  assert.equal(commands.get("permissions")?.description, "Edit user or local tool permissions");

  const notices: Array<{ message: string; level: string }> = [];
  const sessionStartEvent = {};
  const sessionStartContext = { hasUI: true, ui: { notify: (message: string, level: string) => notices.push({ message, level }) } };
  await handlers.get("session_start")?.(sessionStartEvent, sessionStartContext);
  assert.deepEqual(notices, [{ message: "Rust native registration active.", level: "info" }]);
  assert.deepEqual(handledSessionStarts, [{ event: sessionStartEvent, ctx: sessionStartContext }]);
  const toolCallEvent = { toolName: "read", toolCallId: "native-tool-call", input: { path: "README.md" } };
  const toolCallContext = { cwd: "/tmp", hasUI: false, ui: {} };
  assert.deepEqual(await handlers.get("tool_call")?.(toolCallEvent, toolCallContext), { block: true, reason: "delegated" });
  assert.deepEqual(handledToolCalls, [{ event: toolCallEvent, ctx: toolCallContext }]);
  const toolResultEvent = { toolCallId: "native-tool-call", content: [] };
  const toolResultContext = { cwd: "/tmp" };
  assert.deepEqual(await handlers.get("tool_result")?.(toolResultEvent, toolResultContext), { content: [{ type: "text", text: "delegated" }] });
  assert.deepEqual(handledToolResults, [{ event: toolResultEvent, ctx: toolResultContext }]);
  const shutdownEvent = {};
  const shutdownContext = { sessionId: "native-session" };
  await handlers.get("session_shutdown")?.(shutdownEvent, shutdownContext);
  assert.deepEqual(handledSessionShutdowns, [{ event: shutdownEvent, ctx: shutdownContext }]);
  const commandContext = { cwd: "/tmp" };
  await commands.get("permissions")?.handler("local", commandContext);
  assert.deepEqual(handledCommands, [{ args: "local", ctx: commandContext }]);
});

test("native registration falls back without installing duplicate callbacks", () => {
  const handlers: Array<string> = [];
  withNativeRegistrationModule(compatibleProbe, () => {
    const result = registerNativeToolPermissionsCallbacks({
      on(eventName: string) { handlers.push(eventName); },
    } as never);
    assert.equal(result.mode, "typescript");
  });
  assert.deepEqual(handlers, []);
});
