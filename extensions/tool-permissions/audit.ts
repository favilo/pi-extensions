import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, renameSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type AuditRecord = Record<string, unknown>;

type AuditLoggerOptions = {
  homeDir?: string;
  now?: () => Date;
  warn?: (message: string) => void;
};

const AUDIT_DIR = join(".pi", "tool-permissions");
const RETENTION_DAYS = 7;

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function datedPath(homeDir: string, date: string): string {
  return join(homeDir, AUDIT_DIR, `audit-${date}.log`);
}

function legacyPath(homeDir: string): string {
  return join(homeDir, ".config", "pi", "audit.log");
}

function ensureCurrentLink(linkPath: string, targetPath: string, targetName: string): void {
  try {
    if (readlinkSync(linkPath) === targetName) return;
  } catch {
    // The path is absent or is not a symlink; replace it below.
  }

  try {
    unlinkSync(linkPath);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }

  try {
    symlinkSync(targetName, linkPath);
  } catch {
    linkSync(targetPath, linkPath);
  }
}

function migrateLegacy(homeDir: string, target: string): void {
  const legacy = legacyPath(homeDir);
  if (!existsSync(legacy)) return;

  if (!existsSync(target)) {
    renameSync(legacy, target);
    return;
  }

  const legacyContent = readFileSync(legacy, "utf8");
  const currentContent = readFileSync(target, "utf8");
  if (legacyContent && !currentContent.includes(legacyContent)) appendFileSync(target, legacyContent, "utf8");
  unlinkSync(legacy);
}

function removeExpiredLogs(directory: string, currentDate: string): void {
  const current = Date.parse(`${currentDate}T00:00:00.000Z`);
  for (const name of readdirSync(directory)) {
    const match = /^audit-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (!match) continue;
    const age = Math.floor((current - Date.parse(`${match[1]}T00:00:00.000Z`)) / 86_400_000);
    if (age > RETENTION_DAYS) unlinkSync(join(directory, name));
  }
}

export function createAuditLogger(options: AuditLoggerOptions = {}): { write(record: AuditRecord): void } {
  const homeDir = options.homeDir ?? homedir();
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((message: string) => process.stderr.write(`Warning: ${message}\n`));

  return {
    write(record): void {
      const date = utcDate(now());
      const target = datedPath(homeDir, date);
      const directory = dirname(target);
      const line = `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`;

      try {
        mkdirSync(directory, { recursive: true });
        migrateLegacy(homeDir, target);
        appendFileSync(target, line, "utf8");
      } catch (error) {
        warn(`Could not write permission audit log at ${target}: ${error instanceof Error ? error.message : String(error)}`);
        try {
          const fallback = legacyPath(homeDir);
          mkdirSync(dirname(fallback), { recursive: true });
          appendFileSync(fallback, line, "utf8");
        } catch (fallbackError) {
          warn(`Could not write permission audit fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
        return;
      }

      try {
        ensureCurrentLink(join(directory, "audit.log"), target, `audit-${date}.log`);
      } catch (error) {
        warn(`Could not update current permission audit alias at ${directory}: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        removeExpiredLogs(directory, date);
      } catch (error) {
        warn(`Could not rotate permission audit logs at ${directory}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
