import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundBashSpawn } from "./lifecycle.ts";

export type RegisterBackgroundBashOptions = {
  spawn?: BackgroundBashSpawn;
};

/** Registers background-mode Bash launch plus task lookup/cancel tooling. */
export function registerBackgroundBash(_pi: ExtensionAPI, _options: RegisterBackgroundBashOptions = {}): void {}
