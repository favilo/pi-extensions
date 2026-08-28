import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { BackgroundBashTask } from "./lifecycle.ts";

/** Compact render for a background bash launch call row. */
export function renderBackgroundBashLaunchCall(_args: { command?: string }, _theme: Theme): Text {
  return new Text("", 0, 0);
}

/** Compact render for a background bash launch result row. */
export function renderBackgroundBashLaunchResult(_details: BackgroundBashTask, _options: { expanded: boolean }, _theme: Theme): Text {
  return new Text("", 0, 0);
}

/** Compact render for a bash_task lookup or cancel call row. */
export function renderBashTaskCall(_args: { id?: string; action?: string }, _theme: Theme): Text {
  return new Text("", 0, 0);
}

/** Compact render for a bash_task lookup or cancel result row. */
export function renderBashTaskResult(_details: BackgroundBashTask | { found: false; id: string; status: string }, _options: { expanded: boolean }, _theme: Theme): Text {
  return new Text("", 0, 0);
}
