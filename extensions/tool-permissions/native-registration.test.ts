import "../test-support/forbid-fetch.ts";
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import {
  hasNativeRegistration,
  registerNativeToolPermissionsCallbacks,
} from "./native-registration-loader.ts";

function withNativeRegistrationModule(source: string, run: () => void): void {
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const directory = mkdtempSync(
    join(tmpdir(), "tool-permissions-native-registration-"),
  );
  const packagePath = join(directory, "index.cjs");
  writeFileSync(packagePath, source, "utf8");
  process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const restorePackagePath = setNativePackagePathForTests(packagePath);
  try {
    run();
  } finally {
    restorePackagePath();
    if (previousPackage === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
    if (previousDisable === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
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
      on(eventName: string, handler: (event: unknown, ctx: any) => unknown) {
        handlers.set(eventName, handler);
      },
    } as never);
    assert.deepEqual(result, {
      mode: "native",
      registrations: ["session_start"],
    });
  });
  const notices: Array<{ message: string; level: string }> = [];
  await handlers.get("session_start")?.(
    {},
    {
      hasUI: true,
      ui: {
        notify: (message: string, level: string) =>
          notices.push({ message, level }),
      },
    },
  );
  assert.deepEqual(notices, [
    { message: "Rust native registration active.", level: "info" },
  ]);
});

test("bundled Rust registration calls pi.on and registerCommand for delegated callbacks", async (t) => {
  let register:
    | ((
        request: unknown,
        pi: unknown,
        bridge?: unknown,
      ) => { ok: boolean; operation: string; registrations: string[] })
    | undefined;
  try {
    register = (
      createRequire(import.meta.url)("./native/generated/index.js") as {
        registerToolPermissionsCallbacks?: typeof register;
      }
    ).registerToolPermissionsCallbacks;
  } catch {
    t.skip("native artifact is not built; run npm run build:native");
    return;
  }
  assert.ok(register);
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: any) => unknown>
  >();
  const commands = new Map<
    string,
    { description?: string; handler: (args: string, ctx: unknown) => unknown }
  >();
  const renderers = new Map<
    string,
    (entry: unknown, options: unknown, theme: unknown) => unknown
  >();
  const handledSessionStarts: Array<{ event: unknown; ctx: unknown }> = [];
  const handledToolCalls: Array<{ event: unknown; ctx: unknown }> = [];
  const handledToolResults: Array<{ event: unknown; ctx: unknown }> = [];
  const handledSessionShutdowns: Array<{ event: unknown; ctx: unknown }> = [];
  const handledCommands: Array<{ args: unknown; ctx: unknown }> = [];
  const response = register(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "register_callbacks",
      nonce: "registration-parity",
    },
    {
      on(eventName: string, handler: (event: unknown, ctx: any) => unknown) {
        handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
      },
      registerCommand(
        name: string,
        options: {
          description?: string;
          handler: (args: string, ctx: unknown) => unknown;
        },
      ) {
        commands.set(name, options);
      },
      registerEntryRenderer(
        type: string,
        renderer: (entry: unknown, options: unknown, theme: unknown) => unknown,
      ) {
        renderers.set(type, renderer);
      },
    },
    {
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
      renderPermissionPreview(
        entry: unknown,
        options: unknown,
        theme: unknown,
      ) {
        return { entry, options, theme };
      },
    },
  );
  assert.equal(response.ok, true);
  assert.equal(response.operation, "register_callbacks");
  assert.deepEqual(response.registrations, [
    "session_start",
    "tool_call",
    "tool_result",
    "session_shutdown",
    "command:permissions",
    "entry_renderer:permission-preview",
  ]);
  assert.deepEqual(
    [...handlers.keys()],
    ["session_shutdown", "session_start", "tool_call", "tool_result"],
    "Rust installs its session lifetime guard before Rust-owned lifecycle callbacks; tool callbacks remain bridge-delegated",
  );
  assert.equal(
    commands.get("permissions")?.description,
    "Edit user or local tool permissions",
  );
  const rendererEntry = { data: { title: "Review", body: "Body" } };
  const rendererOptions = { expanded: true };
  const rendererTheme = {};
  assert.deepEqual(
    renderers.get("permission-preview")?.(
      rendererEntry,
      rendererOptions,
      rendererTheme,
    ),
    { entry: rendererEntry, options: rendererOptions, theme: rendererTheme },
  );

  const notices: Array<{ message: string; level: string }> = [];
  const sessionStartEvent = {};
  const sessionStartContext = {
    hasUI: true,
    ui: {
      notify: (message: string, level: string) =>
        notices.push({ message, level }),
    },
  };
  await handlers.get("session_start")?.[0](
    sessionStartEvent,
    sessionStartContext,
  );
  assert.deepEqual(notices, [
    { message: "Rust native registration active.", level: "info" },
  ]);
  assert.deepEqual(handledSessionStarts, [
    { event: sessionStartEvent, ctx: sessionStartContext },
  ]);
  const toolCallEvent = {
    toolName: "read",
    toolCallId: "native-tool-call",
    input: { path: "README.md" },
  };
  const toolCallContext = { cwd: "/tmp", hasUI: false, ui: {} };
  assert.deepEqual(
    await handlers.get("tool_call")?.[0](toolCallEvent, toolCallContext),
    { block: true, reason: "delegated" },
  );
  assert.deepEqual(handledToolCalls, [
    { event: toolCallEvent, ctx: toolCallContext },
  ]);
  const toolResultEvent = { toolCallId: "native-tool-call", content: [] };
  const toolResultContext = { cwd: "/tmp" };
  assert.deepEqual(
    await handlers.get("tool_result")?.[0](toolResultEvent, toolResultContext),
    { content: [{ type: "text", text: "delegated" }] },
  );
  assert.deepEqual(handledToolResults, [
    { event: toolResultEvent, ctx: toolResultContext },
  ]);
  const shutdownEvent = {};
  const shutdownContext = { sessionId: "native-session" };
  const shutdownHandlers = handlers.get("session_shutdown") ?? [];
  assert.equal(shutdownHandlers.length, 1);
  await shutdownHandlers[0](shutdownEvent, shutdownContext);
  assert.deepEqual(handledSessionShutdowns, [
    { event: shutdownEvent, ctx: shutdownContext },
  ]);
  const commandContext = { cwd: "/tmp" };
  await commands.get("permissions")?.handler("local", commandContext);
  assert.deepEqual(handledCommands, [{ args: "local", ctx: commandContext }]);
});

test("Rust preserves product lifecycle callbacks while tool calls remain bridge-delegated", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerToolPermissionsCallbacks(
      request: unknown,
      pi: unknown,
      bridge: unknown,
    ): { registrations: string[] };
  };
  const registrations: Array<{
    name: string;
    handler: (event: unknown, ctx: unknown) => unknown;
  }> = [];
  const toolCalls: Array<{ event: unknown; ctx: unknown }> = [];
  const shutdowns: Array<{ event: unknown; ctx: unknown }> = [];
  let finishShutdown!: () => void;
  const cleanupFinished = new Promise<void>((resolve) => {
    finishShutdown = resolve;
  });

  const response = native.registerToolPermissionsCallbacks(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "register_callbacks",
      nonce: "distinct-lifecycle-shutdowns",
    },
    {
      on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
        registrations.push({ name, handler });
      },
      registerCommand() {},
      registerEntryRenderer() {},
    },
    {
      handleSessionStart() {},
      handleSessionShutdown(event: unknown, ctx: unknown) {
        shutdowns.push({ event, ctx });
        return cleanupFinished;
      },
      handleToolCall(event: unknown, ctx: unknown) {
        toolCalls.push({ event, ctx });
        return { block: true, reason: "tool bridge remains delegated" };
      },
    },
  );

  assert.deepEqual(response.registrations, [
    "session_start",
    "tool_call",
    "session_shutdown",
  ]);
  assert.deepEqual(
    registrations.map(({ name }) => name),
    ["session_shutdown", "session_start", "tool_call"],
    "one scoped shutdown guard owns product cleanup",
  );
  const scopedShutdown = registrations[0];
  const toolCallHandler = registrations[2];
  const shutdownEvent = {};
  const shutdownContext = { sessionId: "test" };
  const pendingCleanup = scopedShutdown.handler(shutdownEvent, shutdownContext);
  assert.ok(pendingCleanup instanceof Promise);
  await scopedShutdown.handler(shutdownEvent, shutdownContext);
  assert.deepEqual(shutdowns, [{ event: shutdownEvent, ctx: shutdownContext }]);
  finishShutdown();
  await pendingCleanup;
  const toolCall = { toolName: "read", toolCallId: "lifecycle-slice" };
  const context = { cwd: "/tmp", hasUI: false };
  assert.deepEqual(toolCallHandler.handler(toolCall, context), {
    block: true,
    reason: "Permission session is closed.",
  });
  assert.deepEqual(toolCalls, []);
});

test("production registration exposes a sample command that notifies the user", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerToolPermissionsCallbacks(
      request: unknown,
      pi: unknown,
      bridge: unknown,
    ): unknown;
  };
  const commands = new Map<
    string,
    { handler(args: string, ctx: unknown): unknown }
  >();
  const shutdownHandlers: Array<() => unknown> = [];
  native.registerToolPermissionsCallbacks(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "register_callbacks",
      nonce: "sample-live",
    },
    {
      on(name: string, handler: () => unknown) {
        if (name === "session_shutdown") shutdownHandlers.push(handler);
      },
      registerCommand(
        name: string,
        options: { handler(args: string, ctx: unknown): unknown },
      ) {
        commands.set(name, options);
      },
      registerEntryRenderer() {},
    },
    { handleToolCall() {} },
  );
  const command = commands.get("registration-sample");
  assert.ok(command);
  const notices: string[] = [];
  await command.handler("", {
    hasUI: true,
    ui: {
      notify(message: string) {
        notices.push(message);
      },
    },
  });
  assert.deepEqual(notices, ["Rust sample command works."]);
  for (const shutdown of shutdownHandlers) shutdown();
  assert.throws(() =>
    command.handler("", { hasUI: true, ui: { notify() {} } }),
  );
});

test("direct registration installs a Rust-owned session callback without a bridge", () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerDirectCallbacks: (pi: unknown) => boolean;
  };
  const handlers = new Map<string, unknown>();
  const registered = native.registerDirectCallbacks({
    on(name: string, handler: unknown) {
      handlers.set(name, handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });
  assert.equal(registered, true);
  assert.equal(typeof handlers.get("session_info_changed"), "function");
});

test("direct registration installs a Rust-owned sample command without a bridge", () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerDirectCallbacks: (pi: unknown) => boolean;
  };
  const commands = new Map<string, unknown>();
  native.registerDirectCallbacks({
    on() {},
    registerCommand(name: string, options: unknown) {
      commands.set(name, options);
    },
    registerEntryRenderer() {},
  });
  assert.ok(commands.has("registration-sample"));
});

test("one shutdown revokes all direct-registration callbacks", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as { registerDirectCallbacks(pi: unknown): boolean };
  const handlers = new Map<
    string,
    Array<(event: unknown, context: unknown) => unknown>
  >();
  const commands = new Map<
    string,
    { handler(args: string, context: unknown): unknown }
  >();
  native.registerDirectCallbacks({
    on(name: string, handler: (event: unknown, context: unknown) => unknown) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(
      name: string,
      options: { handler(args: string, context: unknown): unknown },
    ) {
      commands.set(name, options);
    },
    registerEntryRenderer() {},
  });
  const shutdown = handlers.get("session_shutdown") ?? [];
  assert.equal(shutdown.length, 1);
  const event = handlers.get("session_info_changed")?.[0];
  const command = commands.get("registration-sample");
  assert.ok(event);
  assert.ok(command);
  shutdown[0]({}, {});
  await assert.rejects(
    Promise.resolve(event({ type: "session_info_changed" }, {})),
  );
  assert.throws(() =>
    command.handler("", { hasUI: true, ui: { notify() {} } }),
  );
});

test("Rust callback dispatches after tracer initialization returns", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const registered = native.registerCallbackTracer({
    on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(eventName, handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });

  assert.equal(registered, true);
  const handler = handlers.get("session_info_changed");
  assert.ok(handler);
  await Promise.resolve();
  assert.deepEqual(
    await handler(
      { type: "session_info_changed", name: "after initialization" },
      {},
    ),
    { name: "after initialization", dispatchCount: 1 },
  );
});

test("Rust tracer rejects malformed events without dispatching", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  native.registerCallbackTracer({
    on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(eventName, handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });
  const handler = handlers.get("session_info_changed");
  assert.ok(handler);
  assert.throws(() => handler({ type: "invalid", name: "ignored" }, {}));
  assert.deepEqual(
    await handler({ type: "session_info_changed", name: "valid" }, {}),
    { name: "valid", dispatchCount: 1 },
  );
});

test("session-scoped tracer installs shutdown before its event callbacks", () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as { registerCallbackTracer: (pi: unknown) => boolean };
  const registrations: string[] = [];
  native.registerCallbackTracer({
    on(eventName: string) {
      registrations.push(eventName);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });
  assert.deepEqual(registrations, ["session_shutdown", "session_info_changed"]);
});

test("Rust tracer releases session state at shutdown and rejects stale callbacks", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  native.registerCallbackTracer({
    on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(eventName, handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });
  const handler = handlers.get("session_info_changed");
  const shutdown = handlers.get("session_shutdown");
  assert.ok(handler);
  assert.ok(shutdown);
  assert.deepEqual(
    await handler(
      { type: "session_info_changed", name: "before shutdown" },
      {},
    ),
    { name: "before shutdown", dispatchCount: 1 },
  );
  assert.equal(await shutdown({}, {}), true);
  await assert.rejects(
    Promise.resolve(
      handler({ type: "session_info_changed", name: "after shutdown" }, {}),
    ),
  );
  assert.equal(await shutdown({}, {}), false);
});

test("shutdown during initialization prevents a live scoped registration", () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as { registerCallbackTracer: (pi: unknown) => boolean };
  const registrations: string[] = [];
  assert.throws(() =>
    native.registerCallbackTracer({
      on(
        eventName: string,
        handler: (event: unknown, ctx: unknown) => unknown,
      ) {
        registrations.push(eventName);
        if (eventName === "session_shutdown") handler({}, {});
      },
      registerCommand() {},
      registerEntryRenderer() {},
    }),
  );
  assert.deepEqual(registrations, ["session_shutdown"]);
});

test("failed tracer initialization leaves no live callback state", () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  let shutdown: ((event: unknown, ctx: unknown) => unknown) | undefined;
  assert.throws(() =>
    native.registerCallbackTracer({
      on(
        eventName: string,
        handler: (event: unknown, ctx: unknown) => unknown,
      ) {
        if (eventName === "session_shutdown") shutdown = handler;
        else throw new Error("registration failed");
      },
      registerCommand() {},
      registerEntryRenderer() {},
    }),
  );
  assert.ok(shutdown);
  assert.equal(shutdown({}, {}), false);
});

test("Rust tracer owns asynchronous dispatch after callback return", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  native.registerCallbackTracer({
    on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(eventName, handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });
  const handler = handlers.get("session_info_changed");
  assert.ok(handler);
  const pending = handler(
    { type: "session_info_changed", name: "asynchronous" },
    {},
  );
  assert.ok(pending instanceof Promise);
  assert.deepEqual(await pending, {
    name: "asynchronous",
    dispatchCount: 1,
  });
});

test("shutdown cancels Rust tracer work before its asynchronous dispatch", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  native.registerCallbackTracer({
    on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(eventName, handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });
  const handler = handlers.get("session_info_changed");
  const shutdown = handlers.get("session_shutdown");
  assert.ok(handler);
  assert.ok(shutdown);
  const pending = Promise.resolve(
    handler({ type: "session_info_changed", name: "pending" }, {}),
  );
  assert.equal(shutdown({}, {}), true);
  await assert.rejects(pending, /session state is unavailable/);
});

test("Rust tracer accepts the Pi session info changed event shape", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  native.registerCallbackTracer({
    on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(eventName, handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
  });
  const handler = handlers.get("session_info_changed");
  assert.ok(handler);
  assert.deepEqual(
    await handler({ type: "session_info_changed", name: "session" }, {}),
    { name: "session", dispatchCount: 1 },
  );
  assert.deepEqual(
    await handler({ type: "session_info_changed", name: undefined }, {}),
    { dispatchCount: 2 },
  );
});

test("real Pi extension runner invokes and shuts down Rust tracer", async () => {
  const native = createRequire(import.meta.url)(
    "./native/generated/index.js",
  ) as {
    registerCallbackTracer: (pi: unknown) => boolean;
  };
  const directory = mkdtempSync(join(tmpdir(), "pi-tracer-runner-"));
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        assert.equal(native.registerCallbackTracer(pi), true);
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: directory,
    noTools: "all",
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(directory),
  });
  try {
    const extension = loader
      .getExtensions()
      .extensions.find((entry) => entry.handlers.has("session_info_changed"));
    assert.ok(extension);
    const tracer = extension.handlers.get("session_info_changed")?.[0];
    assert.ok(tracer);
    const errors: string[] = [];
    session.extensionRunner.onError((error) => errors.push(error.error));
    await session.extensionRunner.emit({
      type: "session_info_changed",
      name: "runner event",
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(
      await tracer(
        { type: "session_info_changed", name: "probe" },
        {} as never,
      ),
      {
        name: "probe",
        dispatchCount: 2,
      },
    );
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    await assert.rejects(
      Promise.resolve(
        tracer({ type: "session_info_changed", name: "stale" }, {} as never),
      ),
    );
  } finally {
    session.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native registration falls back without installing duplicate callbacks", () => {
  const handlers: Array<string> = [];
  withNativeRegistrationModule(compatibleProbe, () => {
    const result = registerNativeToolPermissionsCallbacks({
      on(eventName: string) {
        handlers.push(eventName);
      },
    } as never);
    assert.equal(result.mode, "unavailable");
  });
  assert.deepEqual(handlers, []);
});

test("hasNativeRegistration identifies registered capabilities when native, false when unavailable", () => {
  assert.equal(
    hasNativeRegistration(
      { mode: "native", registrations: ["session_start", "tool_call"] },
      "session_start",
    ),
    true,
  );
  assert.equal(
    hasNativeRegistration(
      { mode: "native", registrations: ["session_start", "tool_call"] },
      "command:permissions",
    ),
    false,
  );
  assert.equal(
    hasNativeRegistration(
      { mode: "unavailable", reason: "disabled" },
      "session_start",
    ),
    false,
  );
});
