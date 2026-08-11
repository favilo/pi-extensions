import { matchesKey } from "@earendil-works/pi-tui";

export function isPermissionPromptCancellation(data: string): boolean {
  return matchesKey(data, "escape");
}
