// story: e03s01
import { CONFIG_DIR_NAME, generateDiffString, getAgentDir, isToolCallEventType, renderDiff, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, matchesKey, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import ignore from "ignore";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createAuditLogger } from "./audit.ts";
import {
  parsePermissionRuleJson,
  permissionKeyForTool,
  saveAllowedRule,
  type PermissionRule,
} from "./config.ts";
import { createPersistedTrustResolver, resolveCurrentProjectPolicyPath, resolveScopedPermissionDecision, type ScopedPermissionDecision } from "./scope.ts";
import type { PermissionDecision, ToolPermissionBoundary, ToolRequest } from "./permission-boundary.ts";
import { isPermissionPromptCancellation } from "./prompt-input.ts";
import {
  closePermissionPromptQueue,
  createPermissionPromptIdentity,
  permissionPromptQueueFor,
} from "./prompt-queue.ts";

type ToolCallEventResult = { block: true; reason: string } | undefined;

export type PermissionContext = {
  cwd: string;
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
};

type ReadInput = { path?: unknown };
type PathToolInput = { path?: unknown };
type FileEditInput = { path?: unknown };
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
export function requiresSubagentRuntimeApproval(_input: SubagentInput, _environment: NodeJS.ProcessEnv = process.env): boolean {
  return false;
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

export function logSubagentDebug(event: string, details: unknown): void {
  if (process.env.PI_SUBAGENT_DEBUG !== "1") return;
  try {
    appendFileSync(
      join(tmpdir(), "pi-subagent-debug.jsonl"),
      `${JSON.stringify({ time: new Date().toISOString(), event, details })}\n`,
      "utf8",
    );
  } catch {
    // Debug logging must never affect permission behavior.
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

function truncateDiff(diff: string, maxLines = 240): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return diff;
  return [...lines.slice(0, maxLines), `… diff truncated, ${lines.length - maxLines} more lines`].join("\n");
}

function diffPromptBody(path: string, oldContent: string, newContent: string, previewError?: string): string {
  if (previewError) {
    return `Path: ${path}\n\nDiff preview unavailable: ${previewError}\n\nReview the tool request carefully before allowing it.`;
  }

  if (oldContent === newContent) {
    return `Path: ${path}\n\nNo content changes detected.`;
  }

  const { diff } = generateDiffString(oldContent, newContent, 3);
  return `Path: ${path}\n\n${renderDiff(truncateDiff(diff), { filePath: path })}`;
}

function buildFileEditPrompt(toolName: string, input: unknown, cwd: string): { title: string; body: string } {
  if (toolName === "write") {
    const { path, content } = input as WriteInput;
    if (typeof path !== "string" || typeof content !== "string") {
      return { title: "Allow write?", body: `Invalid write arguments.\n\n${compact(input)}` };
    }

    const absolutePath = resolve(cwd, path);
    const oldContent = readTextIfPresent(absolutePath);
    return { title: `Allow write to ${path}?`, body: diffPromptBody(path, oldContent, content) };
  }

  const { path, edits } = input as EditInput;
  if (typeof path !== "string" || !Array.isArray(edits)) {
    return { title: "Allow edit?", body: `Invalid edit arguments.\n\n${compact(input)}` };
  }

  const absolutePath = resolve(cwd, path);
  const oldContent = readTextIfPresent(absolutePath);
  const normalizedEdits = edits.map((edit) => ({ oldText: String(edit.oldText ?? ""), newText: String(edit.newText ?? "") }));

  try {
    const newContent = applyEditPreview(oldContent, normalizedEdits);
    return { title: `Allow edit to ${path}?`, body: diffPromptBody(path, oldContent, newContent) };
  } catch (error) {
    return { title: `Allow edit to ${path}?`, body: diffPromptBody(path, oldContent, oldContent, error instanceof Error ? error.message : String(error)) };
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
): Promise<PermissionResult> {
  if (ctx.mode !== "tui" || !ctx.ui.custom) {
    const bodyWithHeader = stickyHeader ? `${stickyHeader}\n\n${body}` : body;
    const allowed = await ctx.ui.confirm(title, bodyWithHeader, { signal });
    return allowed ? { allowed: true, decision: "allow_once" } : { allowed: false, decision: "deny" };
  }

  const rawLines = body.split("\n");
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

  return ctx.ui.custom<PermissionResult>((tui, theme: any, _keybindings, finish) => {
    let settled = false;
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
      pi.sendUserMessage(steering, { deliverAs: "steer" });
      done({ ...result, steering });
    };

    const component: Component & Focusable = {
      focused: false,
      render(width: number): string[] {
      const continuationPrefix = theme.fg("muted", "… ");
      const contentWidth = Math.max(1, width - 2);
      const wrappedBody = rawLines.flatMap((line) => wrapWithContinuation(line, contentWidth, continuationPrefix));
      scrollableLineCount = wrappedBody.length;

      const maxOffset = Math.max(0, scrollableLineCount - pageSize);
      offset = Math.max(0, Math.min(offset, maxOffset));
      const visible = wrappedBody.slice(offset, offset + pageSize);
      const position = scrollableLineCount > pageSize ? ` lines ${offset + 1}-${Math.min(offset + pageSize, scrollableLineCount)} of ${scrollableLineCount}` : "";
      const allowHint = allowPattern ? " • Ctrl+A allow+save project • Ctrl+Shift+A allow+save user • Ctrl+E edit pattern" : "";
      const steeringAllowHint = allowPattern ? " • Ctrl+A project-save+steer • Ctrl+Shift+A user-save+steer" : "";
      const navigationHint = steeringMode
        ? `↑/↓ or j/k scroll • PgUp/PgDn page • Home/End jump • Ctrl+D deny+steer${position}`
        : `↑/↓ or j/k scroll • PgUp/PgDn page • Home/End jump • Tab steering • Ctrl+D deny • Esc cancel${position}`;
      const approvalHint = steeringMode
        ? `Ctrl+Y allow once+steer${steeringAllowHint}`
        : `Ctrl+Y allow once${allowHint}`;
      const wrap = (text: string): string[] => wrapWithContinuation(text, width, continuationPrefix);

      return [
        ...wrap(theme.fg("accent", theme.bold(title))),
        ...(stickyHeader ? wrap(theme.fg("muted", stickyHeader)) : []),
        ...(allowPattern ? wrap(theme.fg("muted", `Rule: ${JSON.stringify(allowPattern.suggestedRule)}`)) : []),
        "",
        ...visible,
        "",
        ...(steeringMode
          ? [
              ...wrap(theme.fg("warning", `Steering: ${steeringText}${component.focused ? CURSOR_MARKER : ""}\x1b[7m \x1b[27m`)),
              ...wrap(theme.fg("dim", steeringText.trim() ? "choose allow or deny" : "type a message; Esc returns")),
            ]
          : []),
        ...wrap(theme.fg("dim", navigationHint)),
        ...wrap(theme.fg("dim", approvalHint)),
      ];
    },
    handleInput(data: string): void {
      const maxOffset = Math.max(0, scrollableLineCount - pageSize);
      const steeringMessage = steeringText.trim();

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
          steeringMode = false;
          tui.requestRender();
          return;
        }
        if (matchesKey(data, "backspace")) {
          steeringText = steeringText.slice(0, -1);
          tui.requestRender();
          return;
        }
        if (isPrintableInput(data)) {
          steeringText += data;
          tui.requestRender();
        }
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
      if (matchesKey(data, "up") || data === "k") offset = Math.max(0, offset - 1);
      else if (matchesKey(data, "down") || data === "j") offset = Math.min(maxOffset, offset + 1);
      else if (matchesKey(data, "pageUp") || data === "b") offset = Math.max(0, offset - pageSize);
      else if (matchesKey(data, "pageDown") || data === "f" || data === " ") offset = Math.min(maxOffset, offset + pageSize);
      else if (matchesKey(data, "home") || data === "g") offset = 0;
      else if (matchesKey(data, "end") || data === "G") offset = maxOffset;
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
  request: Pick<ToolRequest, "actor" | "toolName" | "cwd" | "input">,
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
        const result = await presentScrollablePermission(pi, ctx, title, body, allowPattern, stickyHeader, signal);
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
    ].join("\\n"),
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

function normalizedPermissionInput(request: ToolRequest): unknown {
  if (!CONFIGURED_PATH_TOOLS.has(request.toolName) || typeof request.input !== "object" || request.input === null) {
    return request.input;
  }
  const input = request.input as Record<string, unknown>;
  const requestedPath = typeof input.path === "string" ? input.path : "";
  return { ...input, path: resolve(request.cwd, requestedPath || ".") };
}

/** Shared policy contract for equivalent main-agent and child tool requests. */
export function resolvePermissionDecisionForRequest(
  request: ToolRequest,
  options: PermissionResolverOptions = {},
): PermissionDecision {
  const input = normalizedPermissionInput(request);
  const resolved = resolveToolPermissionDecision(request.toolName, input, request.cwd, options);
  if (resolved.diagnostic) throw new Error(resolved.diagnostic);
  if (resolved.decision === "deny") return "deny";
  if (!IMPLICIT_PROJECT_PATH_TOOLS.has(request.toolName)) return resolved.decision;

  const path = (input as { path: string }).path;
  if (isAiIgnoredPath(path, request.cwd)) return "deny";
  if (resolved.decision === "allow") return "allow";
  return isInsideDirectory(path, request.cwd) ? "allow" : "ask";
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
  const absolutePath = resolve(ctx.cwd, requestedPath || ".");
  const normalizedInput = { ...input, path: absolutePath };
  const decision = configuredDecision(toolName, normalizedInput, ctx.cwd);
  const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
  if (configurationResult === "allow_once") return;
  if (configurationResult) return configurationResult;

  if (decision.decision === "deny") return configuredDeny(toolName, ctx, { path: absolutePath });
  if (isAiIgnoredPath(absolutePath, ctx.cwd)) {
    const reason = `Blocked ${toolName}: ${requestedPath || "."} is matched by ${resolve(ctx.cwd, ".aiignore")}.`;
    audit({ tool: toolName, decision: "deny_aiignore", cwd: ctx.cwd, path: absolutePath, reason });
    return { block: true, reason };
  }
  if (decision.decision === "allow" || isInsideDirectory(absolutePath, ctx.cwd)) {
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
    { actor: { kind: "main" }, toolName, input: normalizedInput, cwd: ctx.cwd },
    `Allow external ${toolName} path?`,
    `pi wants to use ${toolName} on a path outside the project directory.\n\nProject: ${ctx.cwd}\nPath: ${absolutePath}\n\nRules are stored under permissions.read in ${getUserPermissionsPath()}.`,
    { toolName, suggestedRule: { path: exactPattern(absolutePath) }, subject: absolutePath },
  );

  audit({ tool: toolName, decision: result.decision, cwd: ctx.cwd, path: absolutePath, ...permissionResultAudit(result) });
  if (!result.allowed) return { block: true, reason: `User denied external ${toolName} path.` };
}

async function handleReadPermission(input: ReadInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  return handlePathPermission("read", input, ctx, pi);
}

async function handleFileEditPermission(toolName: string, input: FileEditInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  const requestedPath = typeof input.path === "string" ? input.path : "";
  const absolutePath = resolve(ctx.cwd, requestedPath);
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
  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName, input: { ...input, path: absolutePath }, cwd: ctx.cwd },
    prompt.title,
    prompt.body,
    { toolName, suggestedRule: { path: exactPattern(absolutePath) }, subject: absolutePath },
    `Path: ${requestedPath || absolutePath}`,
  );

  audit({ tool: toolName, decision: result.decision, cwd: ctx.cwd, path: absolutePath, ...permissionResultAudit(result) });
  if (!result.allowed) return { block: true, reason: `User denied ${toolName}.` };
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
    { actor: { kind: "main" }, toolName: "bash", input, cwd: ctx.cwd },
    "Allow bash command?",
    `pi wants to run this shell command.\n\n${compact(command)}\n\nRules are stored under permissions.bash in ${getUserPermissionsPath()}.`,
    { toolName: "bash", suggestedRule: { command: exactPattern(command) }, subject: command },
  );

  audit({ tool: "bash", decision: result.decision, cwd: ctx.cwd, command, ...permissionResultAudit(result) });
  if (!result.allowed) return { block: true, reason: "User denied bash command." };
}

async function handleSubagentPermission(input: SubagentInput, ctx: PermissionContext, pi: ExtensionAPI): Promise<ToolCallEventResult> {
  const decision = configuredDecision("subagent", input, ctx.cwd);
  const configurationResult = await handleConfigurationDiagnostic(decision, ctx, pi);
  if (configurationResult === "allow_once") return;
  if (configurationResult) return configurationResult;
  if (decision.decision === "deny") return configuredDeny("subagent", ctx);
  if (decision.decision === "allow") {
    audit({ tool: "subagent", decision: "allow_pattern", cwd: ctx.cwd });
    return;
  }
  if (!ctx.hasUI) {
    const reason = "Blocked subagent: delegation requires explicit interactive permission or an allow rule.";
    audit({ tool: "subagent", decision: "deny_no_ui", cwd: ctx.cwd, reason });
    return { block: true, reason };
  }

  const result = await askScrollablePermission(
    pi,
    ctx,
    { actor: { kind: "main" }, toolName: "subagent", input, cwd: ctx.cwd },
    "Allow subagent delegation?",
    [
      "pi wants to delegate work to one or more child agents.",
      "",
      "Child agents run in isolated Pi sessions. Depending on the selected agent, they may execute shell commands and modify files. Their nested tool calls do not pass through this parent permission prompt.",
      "",
      "Requested delegation:",
      compact(input, 8000),
    ].join("\n"),
    { toolName: "subagent", suggestedRule: {}, subject: "all subagent calls" },
  );

  audit({ tool: "subagent", decision: result.decision, cwd: ctx.cwd, ...permissionResultAudit(result) });
  if (!result.allowed) return { block: true, reason: "User denied subagent delegation." };
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
    { actor: { kind: "main" }, toolName, input, cwd: ctx.cwd },
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
  if (!result.allowed) return { block: true, reason: `User denied ${toolName}.` };
}

export default function toolPermissionPolicy(pi: ExtensionAPI) {
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
    closePermissionPromptQueue(permissionParentSessionId(ctx));
  });

  pi.on("tool_call", async (event, ctx) => {
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

    return handleUnknownToolPermission(event.toolName, event.input, ctx, pi);
  });
}
