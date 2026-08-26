// story: e03s01
import { CONFIG_DIR_NAME, generateDiffString, getAgentDir, isToolCallEventType, renderDiff, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, matchesKey, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import ignore from "ignore";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, constants as fsConstants, existsSync, fchmodSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createAuditLogger } from "./audit.ts";
import { preflightEdit, type EditPair } from "./edit-preflight.ts";
import { attachChildRuntimeSelection, resolveChildRuntimeSelection } from "../subagent/account-runtime.ts";
import {
  parsePermissionRuleJson,
  permissionKeyForTool,
  saveAllowedRule,
  type PermissionRule,
} from "./config.ts";
import { createPersistedTrustResolver, resolveCurrentProjectPolicyPath, resolveScopedPermissionDecision, type ScopedPermissionDecision } from "./scope.ts";
import type { PermissionDecision, ToolPermissionBoundary, ToolRequest } from "./permission-boundary.ts";
import { isPermissionPromptCancellation } from "./prompt-input.ts";
import { SteeringEditor } from "./steering-editor.ts";
import {
  closePermissionPromptQueue,
  createPermissionPromptIdentity,
  permissionPromptQueueFor,
} from "./prompt-queue.ts";

type ToolCallEventResult = { block: true; reason: string } | undefined;

export type PermissionContext = {
  cwd: string;
  /** The pi tool-call identity for the invocation currently being authorized. */
  toolCallId?: string;
  hasUI: boolean;
  mode: string;
  ui: {
    confirm(title: string, body: string, options?: { signal?: AbortSignal }): Promise<boolean>;
    custom?<T>(
      factory: (tui: { requestRender(force?: boolean): void; stop(): void; start(): void }, theme: unknown, keybindings: unknown, done: (value: T) => void) => unknown,
    ): Promise<T>;
    getEditorText?(): string;
    setEditorText?(text: string): void;
    notify?(message: string, level: "info" | "warning" | "error"): void;
  };
  signal?: AbortSignal;
  sessionId?: string;
  sessionManager?: { getSessionId(): string };
  model?: { provider: string; id: string };
};

type ReadInput = { path?: unknown };
type PathToolInput = { path?: unknown };
type FileEditInput = { path?: unknown; edits?: unknown };

function isEditPair(value: unknown): value is EditPair {
  if (!value || typeof value !== "object") return false;
  const edit = value as Record<string, unknown>;
  return typeof edit.oldText === "string" && typeof edit.newText === "string";
}
type BashInput = { command?: unknown };
type SubagentInput = {
  agent?: unknown;
  task?: unknown;
  tasks?: unknown;
  chain?: unknown;
  agentScope?: unknown;
  cwd?: unknown;
  timeout?: unknown;
  instructions?: unknown;
  abortOnFailure?: unknown;
  account?: unknown;
  model?: unknown;
};

/** Whether a child launch can select credentials or a model outside the default runtime. */
export function requiresSubagentRuntimeApproval(input: SubagentInput, environment: NodeJS.ProcessEnv = process.env): boolean {
  return typeof input.account === "string"
    || typeof input.model === "string"
    || Boolean(environment.PI_ACCOUNT_SWITCHER_NEXT_ID)
    || Boolean(environment.PI_ACCOUNT_SWITCHER_ACTIVE_ID);
}
type EditInput = { path?: unknown; edits?: Array<{ oldText?: unknown; newText?: unknown }> };
type WriteInput = { path?: unknown; content?: unknown };

type AuditEntry = {
  time: string;
  tool: string;
  actor?: ToolRequest["actor"];
  decision: string;
  cwd: string;
  path?: string;
  command?: string;
  pattern?: string;
  scope?: "project" | "user";
  reason?: string;
  steering?: string;
};

type AllowPatternOption = {
  toolName: string;
  suggestedRule: PermissionRule;
  subject: string;
};

type PermissionResult =
  | { allowed: true; decision: "allow_once"; steering?: string }
  | { allowed: true; decision: "allow_pattern"; pattern: string; scope: "project" | "user"; steering?: string }
  | { allowed: false; decision: "deny" | "cancel"; steering?: string };

function getUserPermissionsPath(): string {
  return join(getAgentDir(), "permissions.toml");
}
const auditLogger = createAuditLogger();

/** Steering text captured at allow+steer decision time, keyed by toolCallId, annotated onto the invocation-bound tool result. */
const pendingSteering = new Map<string, string>();

type PermissionEditorTarget = { scope: "user" | "local"; path: string } | { error: string };

export function resolvePermissionEditorTarget(
  args: string | undefined,
  cwd: string,
  options: { userPermissionsPath?: string; trustResolver?: Parameters<typeof resolveScopedPermissionDecision>[0]["trustResolver"] } = {},
): PermissionEditorTarget {
  const tokens = args?.trim() ? args.trim().split(/\s+/) : [];
  if (tokens.length > 1 || (tokens[0] && tokens[0] !== "user" && tokens[0] !== "local")) {
    return { error: "Usage: /permissions [user|local]" };
  }

  if (!tokens[0] || tokens[0] === "user") {
    return { scope: "user", path: options.userPermissionsPath ?? getUserPermissionsPath() };
  }

  const path = resolveCurrentProjectPolicyPath({
    cwd,
    configDirName: CONFIG_DIR_NAME,
    trustResolver: options.trustResolver ?? createPersistedTrustResolver(getAgentDir()),
  });
  return path
    ? { scope: "local", path }
    : { error: "Local permissions cannot be edited because this directory is not trusted." };
}

function ruleFromEditedBuffer(buffer: string): PermissionRule | undefined {
  const line = buffer
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !candidate.startsWith("#"));
  return line ? parsePermissionRuleJson(line) : undefined;
}

function isInsideDirectory(path: string, directory: string): boolean {
  const rel = relative(resolve(directory), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !rel.match(/^[A-Za-z]:/));
}

function isAiIgnoredPath(path: string, cwd: string): boolean {
  if (!isInsideDirectory(path, cwd)) return false;

  let aiignore = "";
  try {
    aiignore = readFileSync(resolve(cwd, ".aiignore"), "utf8");
  } catch {
    return false;
  }

  const relativePath = relative(resolve(cwd), resolve(path)).replace(/\\/g, "/");
  return ignore().add(aiignore).ignores(relativePath);
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactPattern(value: string): string {
  return `^${escapeRegExpLiteral(value)}$`;
}

/** Prompt prefix surfacing the agent-supplied call reason, when present. */
function reasonPrefix(input: unknown): string {
  const reason = (input as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" && reason.trim() ? `Reason: ${reason.trim()}\n\n` : "";
}

/** Blocked result for a user denial; steering text is embedded so the reason stays bound to the exact invocation's result. */
function deniedResult(base: string, result: PermissionResult): ToolCallEventResult {
  return { block: true, reason: result.steering ? `${base} (reason: ${result.steering})` : base };
}

function permissionResultAudit(result: PermissionResult): Pick<AuditEntry, "pattern" | "scope" | "steering"> {
  return {
    pattern: "pattern" in result ? result.pattern : undefined,
    scope: "scope" in result ? result.scope : undefined,
    steering: result.steering,
  };
}

function audit(entry: Omit<AuditEntry, "time">): void {
  auditLogger.write(entry);
}

function compact(value: unknown, max = 2000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "(no arguments)";
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

const SAFE_DEBUG_STRING_FIELDS = new Set([
  "requestId", "childId", "cwd", "inputHash", "decision", "status",
  "eventType", "parentMode", "mode", "errorType", "customType",
]);
const SAFE_DEBUG_BOOLEAN_FIELDS = new Set(["parentHasUI", "hasUI", "hasCustomUI"]);
const SAFE_DEBUG_NUMBER_FIELDS = new Set(["attempt", "attempts"]);

function debugValueHash(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, (_key, candidate) => typeof candidate === "bigint" ? candidate.toString() : candidate) ?? "null";
  } catch {
    serialized = "[unserializable]";
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function safeDebugActor(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const actor = value as { kind?: unknown; childId?: unknown };
  if (actor.kind === "main") return { kind: "main" };
  if (actor.kind === "child" && typeof actor.childId === "string") return { kind: "child", childId: actor.childId };
  return undefined;
}

function safeDebugDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};

  for (const [key, candidate] of Object.entries(source)) {
    if (SAFE_DEBUG_STRING_FIELDS.has(key) && typeof candidate === "string") safe[key] = candidate;
    else if (SAFE_DEBUG_BOOLEAN_FIELDS.has(key) && typeof candidate === "boolean") safe[key] = candidate;
    else if (SAFE_DEBUG_NUMBER_FIELDS.has(key) && typeof candidate === "number") safe[key] = candidate;
    else if (key === "actor") safe.actor = safeDebugActor(candidate);
    else if (key === "identity") safe.identity = safeDebugDetails(candidate);
    else if (key === "request" && candidate && typeof candidate === "object") {
      const request = candidate as Record<string, unknown>;
      safe.request = {
        ...safeDebugDetails(request),
        inputHash: debugValueHash(request.input),
      };
    } else if (key === "result") {
      safe.result = safeDebugDetails(candidate);
    } else if (key === "toolName" && typeof candidate === "string") {
      safe.toolNameHash = debugValueHash(candidate);
    } else if (key === "input") {
      safe.inputHash = debugValueHash(candidate);
    } else if (key === "activeTools" && Array.isArray(candidate)) {
      safe.activeTools = candidate.filter((tool): tool is string => typeof tool === "string");
    }
  }

  return safe;
}

let subagentDebugDirectory: string | undefined;

function subagentDebugPath(): string {
  if (!subagentDebugDirectory || !existsSync(subagentDebugDirectory)) {
    subagentDebugDirectory = mkdtempSync(join(tmpdir(), "pi-subagent-debug-"));
    if (process.platform !== "win32") chmodSync(subagentDebugDirectory, 0o700);
  }
  return join(subagentDebugDirectory, "events.jsonl");
}

export function logSubagentDebug(event: string, details: unknown): void {
  if (process.env.PI_SUBAGENT_DEBUG !== "1") return;
  let descriptor: number | undefined;
  try {
    const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
    const nonBlocking = process.platform === "win32" ? 0 : fsConstants.O_NONBLOCK;
    descriptor = openSync(
      subagentDebugPath(),
      fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY | noFollow | nonBlocking,
      0o600,
    );
    if (!fstatSync(descriptor).isFile()) return;
    if (process.platform !== "win32") fchmodSync(descriptor, 0o600);
    writeSync(descriptor, `${JSON.stringify({ time: new Date().toISOString(), event, details: safeDebugDetails(details) })}\n`, undefined, "utf8");
  } catch {
    // Debug logging must never affect permission behavior.
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Ignore debug cleanup errors. */ }
    }
  }
}

function wrapWithContinuation(text: string, width: number, continuationPrefix: string): string[] {
  const availableWidth = Math.max(1, width);
  const prefixWidth = visibleWidth(continuationPrefix);
  if (availableWidth <= prefixWidth) return wrapTextWithAnsi(text, availableWidth);

  return wrapTextWithAnsi(text, availableWidth - prefixWidth).map((line, index) =>
    index === 0 ? line : `${continuationPrefix}${line}`,
  );
}

function isPrintableInput(data: string): boolean {
  return data.length > 0 && !data.startsWith("\x1b") && !data.startsWith("\x00") && !data.startsWith("\x1f") && !/[\x00-\x08\x0b-\x1f\x7f]/.test(data);
}

function readTextIfPresent(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function applyEditPreview(oldContent: string, edits: Array<{ oldText: string; newText: string }>): string {
  const replacements = edits.map((edit, index) => {
    const first = oldContent.indexOf(edit.oldText);
    if (first === -1) throw new Error(`edit ${index + 1}: oldText was not found`);

    const second = oldContent.indexOf(edit.oldText, first + edit.oldText.length);
    if (second !== -1) throw new Error(`edit ${index + 1}: oldText matches more than once`);

    return { index: first, length: edit.oldText.length, newText: edit.newText, editIndex: index };
  });

  replacements.sort((a, b) => a.index - b.index);
  for (let i = 1; i < replacements.length; i++) {
    const previous = replacements[i - 1];
    const current = replacements[i];
    if (previous.index + previous.length > current.index) {
      throw new Error(`edit ${current.editIndex + 1}: replacement overlaps another edit`);
    }
  }

  let next = oldContent;
  for (const replacement of [...replacements].reverse()) {
    next = next.slice(0, replacement.index) + replacement.newText + next.slice(replacement.index + replacement.length);
  }
  return next;
}

function truncateDiff(diff: string, maxLines = 10000): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return diff;
  return [...lines.slice(0, maxLines), `… diff truncated, ${lines.length - maxLines} more lines`].join("\n");
}

function diffPromptBody(path: string, oldContent: string, newContent: string, previewError?: string): { body: string; lineCount: number } {
  if (previewError) {
    const body = `Path: ${path}\n\nDiff preview unavailable: ${previewError}\n\nReview the tool request carefully before allowing it.`;
    return { body, lineCount: body.split("\n").length };
  }

  if (oldContent === newContent) {
    const body = `Path: ${path}\n\nNo content changes detected.`;
    return { body, lineCount: body.split("\n").length };
  }

  const { diff } = generateDiffString(oldContent, newContent, 3);
  const lineCount = diff.split("\n").length;
  if (lineCount > 1000) {
    const body = `Path: ${path}\n\n[Diff exceeds 1000 lines (${lineCount} lines). Automatically denied.]`;
    return { body, lineCount };
  }

  const body = `Path: ${path}\n\n${renderDiff(truncateDiff(diff, 1000), { filePath: path })}`;
  return { body, lineCount: body.split("\n").length };
}

function buildFileEditPrompt(toolName: string, input: unknown, cwd: string): { title: string; body: string; lineCount: number } {
  if (toolName === "write") {
    const { path, content } = input as WriteInput;
    if (typeof path !== "string" || typeof content !== "string") {
      const body = `Invalid write arguments.\n\n${compact(input)}`;
      return { title: "Allow write?", body, lineCount: body.split("\n").length };
    }

    const absolutePath = resolve(cwd, path);
    const oldContent = readTextIfPresent(absolutePath);
    const prompt = diffPromptBody(path, oldContent, content);
    return { title: `Allow write to ${path}?`, body: prompt.body, lineCount: prompt.lineCount };
  }

  const { path, edits } = input as EditInput;
  if (typeof path !== "string" || !Array.isArray(edits)) {
    const body = `Invalid edit arguments.\n\n${compact(input)}`;
    return { title: "Allow edit?", body, lineCount: body.split("\n").length };
  }

  const absolutePath = resolve(cwd, path);
  const oldContent = readTextIfPresent(absolutePath);
  const normalizedEdits = edits.map((edit) => ({ oldText: String(edit.oldText ?? ""), newText: String(edit.newText ?? "") }));

  try {
    const newContent = applyEditPreview(oldContent, normalizedEdits);
    const prompt = diffPromptBody(path, oldContent, newContent);
    return { title: `Allow edit to ${path}?`, body: prompt.body, lineCount: prompt.lineCount };
  } catch (error) {
    const prompt = diffPromptBody(path, oldContent, oldContent, error instanceof Error ? error.message : String(error));
    return { title: `Allow edit to ${path}?`, body: prompt.body, lineCount: prompt.lineCount };
  }
}

function getExternalEditorCommand(): string {
  return process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "nano");
}

type TuiController = {
  requestRender(force?: boolean): void;
  stop(): void;
  start(): void;
};

async function launchExternalEditor(tui: TuiController, path: string): Promise<boolean> {
  const editorCmd = getExternalEditorCommand();

  try {
    tui.stop();
    process.stdout.write(`Launching external editor: ${editorCmd}\nPi will resume when the editor exits.\n`);
    const [editor, ...editorArgs] = editorCmd.split(" ");
    const status = await new Promise<number | null>((resolveStatus) => {
      const child = spawn(editor, [...editorArgs, path], { stdio: "inherit", shell: process.platform === "win32" });
      child.on("error", () => resolveStatus(null));
      child.on("close", (code) => resolveStatus(code));
    });
    return status === 0;
  } finally {
    tui.start();
    tui.requestRender(true);
  }
}

async function editPatternInExternalEditor(tui: TuiController, option: AllowPatternOption): Promise<PermissionRule | undefined> {
  const tmpFile = join(tmpdir(), `pi-allow-pattern-${Date.now()}.txt`);
  const buffer = [
    "# Edit the JSON rule below, save, and exit.",
    "# Fields use dot paths; values are JavaScript RegExp pattern strings.",
    "# An empty object allows every invocation of the tool.",
    `# Tool: ${option.toolName}`,
    `# Subject: ${option.subject}`,
    "",
    JSON.stringify(option.suggestedRule),
    "",
  ].join("\n");

  try {
    writeFileSync(tmpFile, buffer, "utf8");
    if (!await launchExternalEditor(tui, tmpFile)) return undefined;
    return ruleFromEditedBuffer(readFileSync(tmpFile, "utf8"));
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors.
    }
  }
}

async function editPermissionsInExternalEditor(ctx: PermissionContext, target: { scope: "user" | "local"; path: string }): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.ui.custom) {
    throw new Error("The permissions editor is only available in interactive TUI mode.");
  }

  try {
    mkdirSync(dirname(target.path), { recursive: true });
    appendFileSync(target.path, "", "utf8");
  } catch (error) {
    throw new Error(`Could not prepare ${target.scope} permission policy at ${target.path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  await ctx.ui.custom<void>((tui, theme: any, _keybindings, done) => {
    void launchExternalEditor(tui, target.path)
      .then((succeeded) => {
        if (!succeeded) ctx.ui.notify?.(`Editor exited without saving ${target.path}.`, "error");
        done(undefined);
      })
      .catch((error) => {
        ctx.ui.notify?.(error instanceof Error ? error.message : String(error), "error");
        done(undefined);
      });

    return {
      render(width: number): string[] {
        return wrapTextWithAnsi(theme.fg("muted", `Editing ${target.scope} permissions at ${target.path}…`), width);
      },
      invalidate(): void { },
    };
  });
}

async function presentScrollablePermission(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  ctx: PermissionContext,
  title: string,
  body: string,
  allowPattern: AllowPatternOption | undefined,
  stickyHeader: string | undefined,
  signal: AbortSignal,
  toolCallId: string | undefined,
): Promise<PermissionResult> {
  if (ctx.mode !== "tui" || !ctx.ui.custom) {
    const bodyWithHeader = stickyHeader ? `${stickyHeader}\n\n${body}` : body;
    const allowed = await ctx.ui.confirm(title, bodyWithHeader, { signal });
    return allowed ? { allowed: true, decision: "allow_once" } : { allowed: false, decision: "deny" };
  }

  const rawLines = body.split("\n");
  if (rawLines.length > 1000) {
    const steeringReason = `Tool request content is too large (${rawLines.length} lines, exceeding the 1000 line limit). Please break this request down into smaller incremental steps (e.g. write an initial stub file followed by edit operations, or split into multiple smaller bash commands).`;
    ctx.ui.notify?.(`Tool request exceeded 1000 lines (${rawLines.length} lines) and was automatically denied.`, "error");
    return {
      allowed: false,
      decision: "deny",
      steering: steeringReason,
    };
  }
  const pageSize = 28;
  let offset = 0;
  let scrollableLineCount = rawLines.length;
  let steeringMode = false;
  let steeringText = "";
  const projectPath = allowPattern
    ? resolveCurrentProjectPolicyPath({
      cwd: ctx.cwd,
      configDirName: CONFIG_DIR_NAME,
      trustResolver: createPersistedTrustResolver(getAgentDir()),
    })
    : undefined;
  const savePattern = (scope: "project" | "user"): boolean => {
    if (!allowPattern) return false;
    const target = scope === "project" ? projectPath : getUserPermissionsPath();
    if (!target) {
      ctx.ui.notify?.("Project permissions cannot be saved because this directory is not trusted.", "warning");
      return false;
    }
    try {
      saveAllowedRule(target, permissionKeyForTool(allowPattern.toolName), allowPattern.suggestedRule);
      ctx.ui.notify?.(`Saved ${scope} permission pattern to ${target}.`, "info");
      return true;
    } catch (error) {
      ctx.ui.notify?.(`Could not save ${scope} permission pattern to ${target}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  };

  return ctx.ui.custom<PermissionResult>((tui, theme: any, keybindings: any, finish) => {
    let settled = false;
    const customFactory = (ctx.ui as any)?.getEditorComponent?.();
    const isVim =
      process.env.PI_VIM_MODE === "1" ||
      Boolean(keybindings?.vimMode) ||
      (ctx as any).settings?.editorMode === "vim" ||
      Boolean(process.env.EDITOR?.includes("vim")) ||
      Boolean(process.env.VISUAL?.includes("vim"));
    const steeringEditor = new SteeringEditor({
      tui: tui as any,
      theme: theme?.editorTheme,
      keybindings,
      customEditorFactory: customFactory,
      vimMode: isVim,
    });
    const onAbort = (): void => done({ allowed: false, decision: "cancel" });
    const done = (value: PermissionResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      finish(value);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) queueMicrotask(onAbort);

    const finishWithSteering = (result: PermissionResult, steering: string): void => {
      // Denials carry the steering text inside the invocation-bound block
      // reason (see deniedResult). Allows annotate the invocation-bound tool
      // result (see the tool_result handler) — no floating steer messages.
      if (result.allowed && toolCallId) pendingSteering.set(toolCallId, steering);
      done({ ...result, steering });
    };

    const component: Component & Focusable = {
      focused: false,
      render(width: number): string[] {
      const continuationPrefix = theme.fg("muted", "… ");
      const contentWidth = Math.max(1, width - 2);

      const wrappedBody = rawLines.flatMap((line) => wrapWithContinuation(line, contentWidth, continuationPrefix));
      const allowHint = allowPattern ? " • Ctrl+A allow+save project • Ctrl+Shift+A allow+save user • Ctrl+E edit pattern" : "";
      const steeringAllowHint = allowPattern ? " • Ctrl+A project-save+steer • Ctrl+Shift+A user-save+steer" : "";
      const navigationHint = steeringMode
        ? isVim
          ? steeringEditor.getMode() === "insert"
            ? `Esc normal mode • Ctrl+D deny+steer`
            : `Esc exit steering • i/A insert mode • hjkl navigate • Ctrl+D deny+steer`
          : `Esc exit steering • Ctrl+D deny+steer`
        : `Tab steering • Ctrl+D deny • Esc cancel`;
      const approvalHint = steeringMode
        ? `Ctrl+Y allow once+steer${steeringAllowHint}`
        : `Ctrl+Y allow once${allowHint}`;
      const wrap = (text: string): string[] => wrapWithContinuation(text, width, continuationPrefix);

      const steeringBoxLines = steeringEditor.render(contentWidth);

      return [
        ...wrap(theme.fg("accent", theme.bold(title))),
        ...(stickyHeader ? wrap(theme.fg("muted", stickyHeader)) : []),
        ...(allowPattern ? wrap(theme.fg("muted", `Rule: ${JSON.stringify(allowPattern.suggestedRule)}`)) : []),
        "",
        ...wrappedBody,
        "",
        ...(steeringMode
          ? [
              ...steeringBoxLines,
              ...wrap(theme.fg("dim", steeringEditor.getValue().trim() ? "choose allow or deny" : "type a message; Esc returns")),
            ]
          : []),
        ...wrap(theme.fg("dim", navigationHint)),
        ...wrap(theme.fg("dim", approvalHint)),
      ];
    },
    handleInput(data: string): void {
      steeringEditor.focused = component.focused;
      const steeringMessage = steeringEditor.getValue().trim();

      if (steeringMode) {
        if (matchesKey(data, "ctrl+y")) {
          if (!steeringMessage) return;
          finishWithSteering({ allowed: true, decision: "allow_once" }, steeringMessage);
          return;
        }
        if (allowPattern && matchesKey(data, "ctrl+shift+a")) {
          if (!steeringMessage || !savePattern("user")) return;
          finishWithSteering(
            { allowed: true, decision: "allow_pattern", pattern: JSON.stringify(allowPattern.suggestedRule), scope: "user" },
            steeringMessage,
          );
          return;
        }
        if (allowPattern && matchesKey(data, "ctrl+a")) {
          if (!steeringMessage || !savePattern("project")) return;
          finishWithSteering(
            { allowed: true, decision: "allow_pattern", pattern: JSON.stringify(allowPattern.suggestedRule), scope: "project" },
            steeringMessage,
          );
          return;
        }
        if (matchesKey(data, "ctrl+d")) {
          if (steeringMessage) finishWithSteering({ allowed: false, decision: "deny" }, steeringMessage);
          else done({ allowed: false, decision: "deny" });
          return;
        }
        if (matchesKey(data, "escape")) {
          if (steeringEditor.getMode() === "insert" && isVim) {
            steeringEditor.handleInput(data);
          } else {
            steeringMode = false;
          }
          tui.requestRender();
          return;
        }
        steeringEditor.handleInput(data);
        tui.requestRender();
        return;
      }

      if (isPermissionPromptCancellation(data)) {
        done({ allowed: false, decision: "cancel" });
        return;
      }
      if (matchesKey(data, "tab")) {
        steeringMode = true;
        tui.requestRender();
        return;
      }
      if (matchesKey(data, "ctrl+y")) {
        done({ allowed: true, decision: "allow_once" });
        return;
      }
      if (allowPattern && matchesKey(data, "ctrl+shift+a")) {
        if (!savePattern("user")) return;
        done({ allowed: true, decision: "allow_pattern", pattern: JSON.stringify(allowPattern.suggestedRule), scope: "user" });
        return;
      }
      if (allowPattern && matchesKey(data, "ctrl+a")) {
        if (!savePattern("project")) return;
        done({ allowed: true, decision: "allow_pattern", pattern: JSON.stringify(allowPattern.suggestedRule), scope: "project" });
        return;
      }
      if (allowPattern && matchesKey(data, "ctrl+e")) {
        void editPatternInExternalEditor(tui, allowPattern).then((rule) => {
          if (rule) {
            saveAllowedRule(getUserPermissionsPath(), permissionKeyForTool(allowPattern.toolName), rule);
            done({ allowed: true, decision: "allow_pattern", pattern: JSON.stringify(rule), scope: "user" });
          }
        });
        return;
      }
      if (matchesKey(data, "ctrl+d")) {
        done({ allowed: false, decision: "deny" });
        return;
      }
      tui.requestRender();
    },
      invalidate(): void { },
    };

    return component;
  });
}

function permissionParentSessionId(ctx: PermissionContext): string {
  const sessionId = ctx.sessionId ?? ctx.sessionManager?.getSessionId();
  if (!sessionId) throw new Error("Permission prompt session identity is unavailable.");
  return sessionId;
}

async function askScrollablePermission(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  ctx: PermissionContext,
  request: Pick<ToolRequest, "actor" | "toolName" | "cwd" | "input" | "toolCallId">,
  title: string,
  body: string,
  allowPattern?: AllowPatternOption,
  stickyHeader?: string,
): Promise<PermissionResult> {
  const identity = createPermissionPromptIdentity(request);
  logSubagentDebug("permission-queue-enqueue", { identity });
  return permissionPromptQueueFor(permissionParentSessionId(ctx)).enqueue({
    identity,
    cancel: { allowed: false, decision: "cancel" },
    signal: ctx.signal,
    present: async (signal) => {
      logSubagentDebug("permission-queue-present", { identity });
      try {
        const result = await presentScrollablePermission(pi, ctx, title, body, allowPattern, stickyHeader, signal, request.toolCallId);
        logSubagentDebug("permission-queue-settle", { identity, decision: result.decision });
        return result;
      } catch (error) {
        logSubagentDebug("permission-queue-error", { identity, errorType: error instanceof Error ? error.name : typeof error });
        throw error;
      }
    },
  });
}

export async function promptToolPermissionRequest(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  ctx: PermissionContext,
  request: ToolRequest,
): Promise<"allow" | "deny" | "cancel"> {
  logSubagentDebug("permission-prompt-enter", {
    request,
    mode: ctx.mode,
    hasUI: ctx.hasUI,
    hasCustomUI: typeof ctx.ui.custom === "function",
  });
  const actor = request.actor.kind === "child" ? `subagent \"${request.actor.childId}\"` : "the main agent";
  const result = await askScrollablePermission(
    pi,
    ctx,
    request,
    `Allow ${actor} to use ${request.toolName}?`,
    [
      `${actor} requested a tool through the shared permission boundary.`,
      "",
      `Tool: ${request.toolName}`,
      `Working directory: ${request.cwd}`,
      ...(request.steering ? [`Steering: ${request.steering}`] : []),
      "",
      "Arguments:",
      compact(request.input, 8000),
    ].join("\n"),
  );
  const decision = result.allowed ? "allow" : result.decision;
  logSubagentDebug("permission-prompt-result", { request, decision, result });
  return decision;
}

async function handleConfigurationDiagnostic(
  result: ScopedPermissionDecision,
  ctx: PermissionContext,
  pi: ExtensionAPI,
): Promise<ToolCallEventResult | "allow_once" | undefined> {
  if (!result.diagnostic) return undefined;
  const reason = `${result.diagnostic}${result.path ? `\n\nPath: ${result.path}` : ""}`;
  if (!ctx.hasUI) {
    const blocked = `Blocked tool call: ${reason}`;
    audit({ tool: "permissions", decision: "deny_policy_error", cwd: ctx.cwd, reason: blocked });
    return { block: true, reason: blocked };
  }
  const warning = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName: "permissions", input: { diagnostic: result.diagnostic, path: result.path }, cwd: ctx.cwd },
    "Permission policy warning",
    reason,
  );
  if (warning.allowed) {
    audit({ tool: "permissions", decision: "allow_once_policy_warning", cwd: ctx.cwd, path: result.path });
    return "allow_once";
  }
  const blocked = "Tool call blocked because the permission policy could not be read.";
  audit({ tool: "permissions", decision: "deny_policy_error", cwd: ctx.cwd, path: result.path, reason: blocked });
  return { block: true, reason: blocked };
}

export function resolveToolPermissionDecision(
  toolName: string,
  input: unknown,
  cwd: string,
  options: { userPermissionsPath?: string; trustResolver?: Parameters<typeof resolveScopedPermissionDecision>[0]["trustResolver"] } = {},
): ScopedPermissionDecision {
  return resolveScopedPermissionDecision({
    cwd,
    toolName,
    input,
    userPermissionsPath: options.userPermissionsPath ?? getUserPermissionsPath(),
    configDirName: CONFIG_DIR_NAME,
    trustResolver: options.trustResolver ?? createPersistedTrustResolver(getAgentDir()),
  });
}

type PermissionResolverOptions = Parameters<typeof resolveToolPermissionDecision>[3];

const IMPLICIT_PROJECT_PATH_TOOLS = new Set(["read", "grep", "find", "ls"]);
const CONFIGURED_PATH_TOOLS = new Set(["read", "grep", "find", "ls", "write", "edit"]);
const NONEXISTENT_PATH_TOOLS = new Set(["write", "edit", "subagent_result"]);

type CanonicalPermissionPath = { path: string; cwd: string };

function canonicalPermissionPath(toolName: string, requestedPath: string, cwd: string): CanonicalPermissionPath {
  try {
    const canonicalCwd = realpathSync(cwd);
    const absolutePath = resolve(canonicalCwd, requestedPath || ".");
    try {
      return { path: realpathSync(absolutePath), cwd: canonicalCwd };
    } catch (error) {
      if (!NONEXISTENT_PATH_TOOLS.has(toolName) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const canonicalParent = realpathSync(dirname(absolutePath));
      return { path: join(canonicalParent, basename(absolutePath)), cwd: canonicalCwd };
    }
  } catch (error) {
    throw new Error(`Could not canonicalize ${toolName} path: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizedPermissionInput(request: ToolRequest): { input: unknown; canonicalCwd?: string } {
  if (!CONFIGURED_PATH_TOOLS.has(request.toolName) || typeof request.input !== "object" || request.input === null) {
    return { input: request.input };
  }
  const input = request.input as Record<string, unknown>;
  const requestedPath = typeof input.path === "string" ? input.path : "";
  const canonical = canonicalPermissionPath(request.toolName, requestedPath, request.cwd);
  const normalizedInput = { ...input, path: canonical.path };
  request.input = normalizedInput;
  return { input: normalizedInput, canonicalCwd: canonical.cwd };
}

/** Shared policy contract for equivalent main-agent and child tool requests. */
export function resolvePermissionDecisionForRequest(
  request: ToolRequest,
  options: PermissionResolverOptions = {},
): PermissionDecision {
  const { input, canonicalCwd } = normalizedPermissionInput(request);
  const resolved = resolveToolPermissionDecision(request.toolName, input, request.cwd, options);
  if (resolved.diagnostic) throw new Error(resolved.diagnostic);
  if (resolved.decision === "deny") return "deny";
  if (!IMPLICIT_PROJECT_PATH_TOOLS.has(request.toolName)) return resolved.decision;

  const path = (input as { path: string }).path;
  const projectCwd = canonicalCwd ?? request.cwd;
  if (isAiIgnoredPath(path, projectCwd)) return "deny";
  if (resolved.decision === "allow") return "allow";
  return isInsideDirectory(path, projectCwd) ? "allow" : "ask";
}

export function createToolPermissionBoundary(
  options: {
    prompt?: ToolPermissionBoundary["prompt"];
    execute: ToolPermissionBoundary["execute"];
    validate?: ToolPermissionBoundary["validate"];
    audit?: ToolPermissionBoundary["audit"];
  },
): ToolPermissionBoundary {
  return {
    evaluate: async (request) => resolvePermissionDecisionForRequest(request),
    prompt: options.prompt,
    execute: options.execute,
    validate: options.validate,
    audit: options.audit ?? ((entry) => audit({ tool: entry.toolName, actor: entry.actor, decision: entry.decision, cwd: entry.cwd, reason: entry.reason })), 
  };
}

function configuredDecision(toolName: string, input: unknown, cwd: string): ScopedPermissionDecision {
  return resolveToolPermissionDecision(toolName, input, cwd);
}

function configuredDeny(toolName: string, ctx: PermissionContext, details: Pick<AuditEntry, "path" | "command"> = {}): ToolCallEventResult {
  const reason = `Blocked ${toolName}: arguments match a configured deny rule.`;
  audit({ tool: toolName, decision: "deny_pattern", cwd: ctx.cwd, ...details, reason });
  return { block: true, reason };
}

async function handlePathPermission(toolName: string, input: PathToolInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  const requestedPath = typeof input.path === "string" ? input.path : "";
  let canonical: CanonicalPermissionPath;
  try {
    canonical = canonicalPermissionPath(toolName, requestedPath, ctx.cwd);
    input.path = canonical.path;
  } catch (error) {
    const reason = `Blocked ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
    audit({ tool: toolName, decision: "deny_path_resolution", cwd: ctx.cwd, reason });
    return { block: true, reason };
  }
  const absolutePath = canonical.path;
  const normalizedInput = { ...input, path: absolutePath };
  const decision = configuredDecision(toolName, normalizedInput, ctx.cwd);
  const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
  if (configurationResult === "allow_once") return;
  if (configurationResult) return configurationResult;

  if (decision.decision === "deny") return configuredDeny(toolName, ctx, { path: absolutePath });
  if (isAiIgnoredPath(absolutePath, canonical.cwd)) {
    const reason = `Blocked ${toolName}: ${requestedPath || "."} is matched by ${resolve(canonical.cwd, ".aiignore")}.`;
    audit({ tool: toolName, decision: "deny_aiignore", cwd: ctx.cwd, path: absolutePath, reason });
    return { block: true, reason };
  }
  if (decision.decision === "allow" || isInsideDirectory(absolutePath, canonical.cwd)) {
    if (decision.decision === "allow") audit({ tool: toolName, decision: "allow_pattern", cwd: ctx.cwd, path: absolutePath, reason: decision.source });
    return;
  }
  if (!ctx.hasUI) {
    const reason = `Blocked ${toolName}: accessing paths outside the project requires explicit interactive permission or an allow rule.`;
    audit({ tool: toolName, decision: "deny_no_ui", cwd: ctx.cwd, path: absolutePath, reason });
    return { block: true, reason };
  }

  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName, input: normalizedInput, cwd: ctx.cwd, toolCallId: ctx.toolCallId },
    `Allow external ${toolName} path?`,
    `pi wants to use ${toolName} on a path outside the project directory.\n\nProject: ${canonical.cwd}\nPath: ${absolutePath}\n\nRules are stored under permissions.read in ${getUserPermissionsPath()}.`,
    { toolName, suggestedRule: { path: exactPattern(absolutePath) }, subject: absolutePath },
  );

  audit({ tool: toolName, decision: result.decision, cwd: ctx.cwd, path: absolutePath, ...permissionResultAudit(result) });
  if (!result.allowed) return deniedResult(`User denied external ${toolName} path.`, result);
}

async function handleReadPermission(input: ReadInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  return handlePathPermission("read", input, ctx, pi);
}

type SubagentResultExportInput = { id?: unknown; full_context?: unknown; overwrite?: unknown };

async function handleSubagentResultExportPermission(input: SubagentResultExportInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  let requestedPath = typeof input.full_context === "string" ? input.full_context : "";
  if (requestedPath.startsWith("@")) requestedPath = requestedPath.slice(1);
  let absolutePath: string;
  try {
    absolutePath = canonicalPermissionPath("write", requestedPath, ctx.cwd).path;
    input.full_context = absolutePath;
  } catch (error) {
    const reason = `Blocked write: ${error instanceof Error ? error.message : String(error)}`;
    audit({ tool: "write", decision: "deny_path_resolution", cwd: ctx.cwd, reason });
    return { block: true, reason };
  }

  const decision = configuredDecision("write", { path: absolutePath }, ctx.cwd);
  const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
  if (configurationResult === "allow_once") return;
  if (configurationResult) return configurationResult;

  if (decision.decision === "deny") return configuredDeny("write", ctx, { path: absolutePath });
  if (decision.decision === "allow") {
    audit({ tool: "write", decision: "allow_pattern", cwd: ctx.cwd, path: absolutePath });
    return;
  }
  if (!ctx.hasUI) {
    const reason = "Blocked write: file edits require explicit interactive permission or an allow rule.";
    audit({ tool: "write", decision: "deny_no_ui", cwd: ctx.cwd, path: absolutePath, reason });
    return { block: true, reason };
  }

  const childId = typeof input.id === "string" ? input.id : "unknown";
  const overwriteStr = input.overwrite ? "true" : "false";

  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName: "write", input: { path: absolutePath }, cwd: ctx.cwd, toolCallId: ctx.toolCallId },
    "Export subagent result?",
    [
      "Export full versioned child context to a local file.",
      "",
      `Child ID: ${childId}`,
      `Target: ${absolutePath}`,
      `Overwrite: ${overwriteStr}`,
    ].join("\n"),
    { toolName: "write", suggestedRule: { path: exactPattern(absolutePath) }, subject: absolutePath },
    `Path: ${requestedPath || absolutePath}`,
  );

  audit({ tool: "write", decision: result.decision, cwd: ctx.cwd, path: absolutePath, ...permissionResultAudit(result) });
  if (!result.allowed) return deniedResult("User denied write.", result);
}

async function handleFileEditPermission(toolName: string, input: FileEditInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  const requestedPath = typeof input.path === "string" ? input.path : "";
  let absolutePath: string;
  try {
    absolutePath = canonicalPermissionPath(toolName, requestedPath, ctx.cwd).path;
    input.path = absolutePath;
  } catch (error) {
    const reason = `Blocked ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
    audit({ tool: toolName, decision: "deny_path_resolution", cwd: ctx.cwd, reason });
    return { block: true, reason };
  }
  if (toolName === "edit" && Array.isArray(input.edits) && input.edits.every(isEditPair)) {
    const preflight = await preflightEdit(absolutePath, input.edits);
    if (!preflight.ok) {
      audit({ tool: toolName, decision: "deny_preflight", cwd: ctx.cwd, path: absolutePath, reason: preflight.reason });
      return { block: true, reason: preflight.reason };
    }
  }
  const decision = configuredDecision(toolName, { ...input, path: absolutePath }, ctx.cwd);
  const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
  if (configurationResult === "allow_once") return;
  if (configurationResult) return configurationResult;

  if (decision.decision === "deny") return configuredDeny(toolName, ctx, { path: absolutePath });
  if (decision.decision === "allow") {
    audit({ tool: toolName, decision: "allow_pattern", cwd: ctx.cwd, path: absolutePath });
    return;
  }
  if (!ctx.hasUI) {
    const reason = `Blocked ${toolName}: file edits require explicit interactive permission or an allow rule.`;
    audit({ tool: toolName, decision: "deny_no_ui", cwd: ctx.cwd, path: absolutePath, reason });
    return { block: true, reason };
  }

  const prompt = buildFileEditPrompt(toolName, input, ctx.cwd);
  if (prompt.lineCount > 1000) {
    const reason = `Tool request content is too large (${prompt.lineCount} lines, exceeding the 1000 line limit). Please break this request down into smaller incremental steps (e.g. write an initial stub file followed by edit operations, or split into multiple smaller bash commands).`;
    ctx.ui.notify?.(`Tool request exceeded 1000 lines (${prompt.lineCount} lines) and was automatically denied.`, "error");
    audit({ tool: toolName, decision: "deny", cwd: ctx.cwd, path: absolutePath, reason });
    return { block: true, reason };
  }
  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName, input: { ...input, path: absolutePath }, cwd: ctx.cwd, toolCallId: ctx.toolCallId },
    prompt.title,
    reasonPrefix(input) + prompt.body,
    { toolName, suggestedRule: { path: exactPattern(absolutePath) }, subject: absolutePath },
    `Path: ${requestedPath || absolutePath}`,
  );

  audit({ tool: toolName, decision: result.decision, cwd: ctx.cwd, path: absolutePath, ...permissionResultAudit(result) });
  if (!result.allowed) return deniedResult(`User denied ${toolName}.`, result);
}

async function handleBashPermission(input: BashInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  const command = typeof input.command === "string" ? input.command : "";
  const decision = configuredDecision("bash", input, ctx.cwd);
  const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
  if (configurationResult === "allow_once") return;
  if (configurationResult) return configurationResult;

  if (decision.decision === "deny") return configuredDeny("bash", ctx, { command });
  if (decision.decision === "allow") {
    audit({ tool: "bash", decision: "allow_pattern", cwd: ctx.cwd, command });
    return;
  }
  if (!ctx.hasUI) {
    const reason = "Blocked bash command: command requires explicit interactive permission or an allow rule.";
    audit({ tool: "bash", decision: "deny_no_ui", cwd: ctx.cwd, command, reason });
    return { block: true, reason };
  }

  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName: "bash", input, cwd: ctx.cwd, toolCallId: ctx.toolCallId },
    "Allow bash command?",
    reasonPrefix(input) + `pi wants to run this shell command.\n\n${compact(command)}\n\nRules are stored under permissions.bash in ${getUserPermissionsPath()}.`,
    { toolName: "bash", suggestedRule: { command: exactPattern(command) }, subject: command },
  );

  audit({ tool: "bash", decision: result.decision, cwd: ctx.cwd, command, ...permissionResultAudit(result) });
  if (!result.allowed) return deniedResult("User denied bash command.", result);
}

async function handleSubagentPermission(input: SubagentInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  const decision = configuredDecision("subagent", input, ctx.cwd);
  const requestedRuntime = requiresSubagentRuntimeApproval(input);
  const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
  if (configurationResult && configurationResult !== "allow_once") return configurationResult;
  if (decision.decision === "deny") return configuredDeny("subagent", ctx);

  const selection = await resolveChildRuntimeSelection({
    ...(typeof input.account === "string" ? { account: input.account } : {}),
    ...(typeof input.model === "string" ? { model: input.model } : {}),
  }, ctx.model);
  if (requestedRuntime && !selection) {
    const reason = "Blocked subagent: selected account or model could not be resolved through account-switcher.";
    audit({ tool: "subagent", decision: "deny_runtime_unavailable", cwd: ctx.cwd, reason });
    return { block: true, reason };
  }
  if (selection) attachChildRuntimeSelection(input, selection);
  const requiresRuntimeApproval = selection !== undefined;

  if (decision.decision === "allow" && !requiresRuntimeApproval) {
    audit({ tool: "subagent", decision: "allow_pattern", cwd: ctx.cwd });
    return;
  }
  if (!ctx.hasUI) {
    const reason = requiresRuntimeApproval
      ? "Blocked subagent: selected account or model requires interactive approval."
      : "Blocked subagent: delegation requires explicit interactive permission or an allow rule.";
    audit({ tool: "subagent", decision: "deny_no_ui", cwd: ctx.cwd, reason });
    return { block: true, reason };
  }

  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName: "subagent", input, cwd: ctx.cwd, toolCallId: ctx.toolCallId },
    requiresRuntimeApproval ? "Allow subagent delegation with selected runtime?" : "Allow subagent delegation?",
    [
      "pi wants to delegate work to one or more child agents.",
      "",
      ...(selection
        ? [
            `Account: ${selection.descriptor.accountId}`,
            `Source: ${selection.descriptor.source}`,
            `Runtime: ${selection.descriptor.provider}/${selection.descriptor.modelId}`,
            "Later child tool actions require separate approval.",
            "",
          ]
        : []),
      "Child agents run in isolated Pi sessions. Depending on the selected agent, they may execute shell commands and modify files. Their nested tool calls do not pass through this parent permission prompt.",
      "",
      "Requested delegation:",
      compact(input, 8000),
    ].join("\n"),
    { toolName: "subagent", suggestedRule: {}, subject: "all subagent calls" },
  );

  audit({ tool: "subagent", decision: result.decision, cwd: ctx.cwd, ...permissionResultAudit(result) });
  if (!result.allowed) return deniedResult("User denied subagent delegation.", result);
}

function isKnownMcpTool(toolName: string, pi: ExtensionAPI): boolean {
  return toolName.startsWith("mcp__") && pi.getAllTools().some((tool) => tool.name === toolName);
}

async function handleUnknownToolPermission(toolName: string, input: unknown, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  const knownTool = pi.getAllTools().some((tool) => tool.name === toolName);
  const knownMcpTool = isKnownMcpTool(toolName, pi);
  if (knownTool) {
    const decision = configuredDecision(toolName, input, ctx.cwd);
    const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
    if (configurationResult === "allow_once") return;
    if (configurationResult) return configurationResult;
    if (decision.decision === "deny") return configuredDeny(toolName, ctx);
    if (decision.decision === "allow") {
      audit({ tool: toolName, decision: "allow_pattern", cwd: ctx.cwd });
      return;
    }
  }

  if (!ctx.hasUI) {
    const reason = `Blocked ${toolName}: tool use requires explicit interactive permission or an allow rule.`;
    audit({ tool: toolName, decision: "deny_no_ui", cwd: ctx.cwd, reason });
    return { block: true, reason };
  }

  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName, input, cwd: ctx.cwd, toolCallId: ctx.toolCallId },
    `Allow ${toolName}?`,
    [
      knownMcpTool ? "pi wants to call a known MCP tool without a matching permission rule." : "pi wants to call a tool without a specific permission rule.",
      "",
      `Tool: ${toolName}`,
      "",
      "Arguments:",
      compact(input, 8000),
    ].join("\n"),
    knownMcpTool ? { toolName, suggestedRule: {}, subject: "all calls to this MCP tool" } : undefined,
  );

  audit({ tool: toolName, decision: result.decision, cwd: ctx.cwd, ...permissionResultAudit(result) });
  if (!result.allowed) return deniedResult(`User denied ${toolName}.`, result);
}

export default function toolPermissionPolicy(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (process.env.PI_SUBAGENT_DEBUG === "1" && ctx.hasUI) {
      ctx.ui.notify(`Subagent debug log: ${subagentDebugPath()}`, "info");
    }
  });

  pi.registerCommand("permissions", {
    description: `Edit user or local tool permissions`,
    handler: async (args, ctx) => {
      const target = resolvePermissionEditorTarget(args, ctx.cwd);
      if ("error" in target) {
        ctx.ui.notify(target.error, "error");
        return;
      }
      await ctx.waitForIdle();
      try {
        await editPermissionsInExternalEditor(ctx, target);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.on("session_shutdown", (_event, ctx) => {
    pendingSteering.clear();
    closePermissionPromptQueue(permissionParentSessionId(ctx));
  });

  pi.on("tool_result", (event) => {
    const steering = pendingSteering.get(event.toolCallId);
    if (!steering) return undefined;
    pendingSteering.delete(event.toolCallId);
    return {
      content: [
        ...event.content,
        // Providers may join text blocks into one string, so the marker text
        // itself must signal this is not part of the tool's own output.
        { type: "text", text: `\n\n<user-steering source="permission-prompt">\n${steering}\n</user-steering>` },
      ],
    };
  });

  pi.on("tool_call", async (event, extensionContext) => {
    // Bind the pi tool-call identity to this invocation so prompts and
    // steering messages can reference the exact call.
    const ctx = { ...extensionContext, toolCallId: event.toolCallId };
    // Child sessions expose this bridge as their only tool. Its payload is
    // authorized by the parent boundary, so the child-side policy must not
    // intercept it as an unknown standalone tool.
    if (event.toolName === "subagent-tool-request") {
      logSubagentDebug("bridge-hook-bypass", {
        toolName: event.toolName,
        input: event.input,
        mode: ctx.mode,
        hasUI: ctx.hasUI,
        hasCustomUI: typeof ctx.ui.custom === "function",
        result: undefined,
      });
      // Undefined is the extension hook's allow/no-op result, not a denial.
      return undefined;
    }

    if (isToolCallEventType("read", event)) {
      return handleReadPermission(event.input, ctx, pi);
    }

    if (isToolCallEventType("grep", event) || isToolCallEventType("find", event) || isToolCallEventType("ls", event)) {
      return handlePathPermission(event.toolName, event.input, ctx, pi);
    }

    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      return handleFileEditPermission(event.toolName, event.input, ctx, pi);
    }

    if (isToolCallEventType("bash", event)) {
      return handleBashPermission(event.input, ctx, pi);
    }

    if (isToolCallEventType<"subagent", SubagentInput>("subagent", event)) {
      return handleSubagentPermission(event.input, ctx, pi);
    }

    if (event.toolName === "subagent_result") {
      if (typeof (event.input as Record<string, unknown>)?.full_context === "string") {
        return handleSubagentResultExportPermission(event.input as SubagentResultExportInput, ctx, pi);
      }
      return undefined;
    }

    return handleUnknownToolPermission(event.toolName, event.input, ctx, pi);
  });
}
