import { spawnSync } from "node:child_process";
import { existsSync, type FSWatcher, watch } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const JJ_TIMEOUT_MS = 250;
const REFRESH_DEBOUNCE_MS = 50;
const JJ_TEMPLATE =
  'if(bookmarks, bookmarks.map(|b| b.name()).join(","), change_id.shortest(8)) ++ "\\n"';
const PATCH_STATE = Symbol.for("pi.jj-status.footer-patch");

export interface CommandResult {
  status: number | null;
  stdout: string;
}

export type JjRunner = (cwd: string, args: readonly string[]) => CommandResult;

type FooterData = {
  getGitBranch(): string | null;
  [PATCH_STATE]?: FooterPatch;
};

type FooterPatch = {
  original: FooterData["getGitBranch"];
  patched: FooterData["getGitBranch"];
};

const runJj: JjRunner = (cwd, args) => {
  const result = spawnSync("jj", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: JJ_TIMEOUT_MS,
  });

  return { status: result.status, stdout: result.stdout ?? "" };
};

function jjStatusArgs(): string[] {
  return ["log", "--ignore-working-copy", "--no-graph", "-r", "@", "-T", JJ_TEMPLATE];
}

export function resolveJjStatus(cwd: string, runner: JjRunner = runJj): string | null {
  const result = runner(cwd, jjStatusArgs());
  if (result.status !== 0) return null;

  return result.stdout.trim() || null;
}

function findJjOperationsPath(cwd: string): string | null {
  let directory = cwd;
  while (true) {
    const operationsPath = join(directory, ".jj", "repo", "op_heads", "heads");
    if (existsSync(operationsPath)) return operationsPath;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function patchDetachedLabel(footerData: FooterData, getJjStatus: () => string | null): () => void {
  if (footerData[PATCH_STATE]) return () => {};

  const original = footerData.getGitBranch;
  const patched = () => {
    const gitBranch = original.call(footerData);
    if (gitBranch !== "detached") return gitBranch;

    return getJjStatus() ?? gitBranch;
  };

  footerData[PATCH_STATE] = { original, patched };
  footerData.getGitBranch = patched;

  return () => {
    const state = footerData[PATCH_STATE];
    if (!state || footerData.getGitBranch !== state.patched) return;

    footerData.getGitBranch = state.original;
    delete footerData[PATCH_STATE];
  };
}

export default function (pi: ExtensionAPI) {
  let jjStatus: string | null = null;
  let operationsWatcher: FSWatcher | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let requestRender: (() => void) | undefined;
  let restoreFooterData: (() => void) | undefined;

  async function refresh(cwd: string) {
    const result = await pi.exec("jj", jjStatusArgs(), { timeout: JJ_TIMEOUT_MS });
    jjStatus = result.code === 0 ? result.stdout.trim() || null : null;
    requestRender?.();
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    await refresh(ctx.cwd);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      requestRender = () => tui.requestRender();
      restoreFooterData = patchDetachedLabel(footerData as FooterData, () => jjStatus);
      return { render: () => [], invalidate() {} };
    });
    ctx.ui.setFooter(undefined);

    const operationsPath = findJjOperationsPath(ctx.cwd);
    if (!operationsPath) return;

    operationsWatcher = watch(operationsPath, () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(ctx.cwd), REFRESH_DEBOUNCE_MS);
    });
    operationsWatcher.on("error", () => operationsWatcher?.close());
  });

  pi.on("session_shutdown", () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    operationsWatcher?.close();
    restoreFooterData?.();
    refreshTimer = undefined;
    operationsWatcher = undefined;
    requestRender = undefined;
    restoreFooterData = undefined;
  });
}
