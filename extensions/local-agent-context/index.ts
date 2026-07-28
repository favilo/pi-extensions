import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const LOCAL_CONTEXT_FILES = ["AGENTS.local.md", "AGENTS.override.md"];

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function findContextDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let current = resolve(cwd);

  while (true) {
    dirs.push(current);

    // Treat the nearest Git checkout boundary as the project boundary.
    if (isDirectory(join(current, ".git"))) break;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Match normal context-file intuition: broad parent guidance first, nearest
  // directory last, so local overrides have final say.
  return dirs.reverse();
}

function loadLocalContextFiles(cwd: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  for (const dir of findContextDirs(cwd)) {
    for (const fileName of LOCAL_CONTEXT_FILES) {
      const path = join(dir, fileName);
      if (!existsSync(path)) continue;

      const content = readFileSync(path, "utf8").trim();
      if (content) files.push({ path, content });
    }
  }

  return files;
}

export default function localAgentContext(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    const files = loadLocalContextFiles(ctx.cwd);
    if (files.length === 0) return;

    const appended = files
      .map(({ path, content }) => `# Additional local context: ${path}\n\n${content}`)
      .join("\n\n---\n\n");

    return {
      systemPrompt: `${event.systemPrompt}\n\n${appended}`,
    };
  });
}
