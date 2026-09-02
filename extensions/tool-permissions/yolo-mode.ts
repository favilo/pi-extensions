/**
 * Environment-gated YOLO permission mode check and session state manager.
 */

const TRUTHY_VALUES = new Set(["1", "true", "yes"]);

let sessionYoloState = false;

export function isYoloEnvironmentAdmitted(env: Record<string, string | undefined> = process.env): boolean {
  const val1 = env.PI_YOLO_MODE?.trim().toLowerCase();
  const val2 = env.PI_PERMISSION_YOLO?.trim().toLowerCase();
  return (val1 !== undefined && TRUTHY_VALUES.has(val1)) || (val2 !== undefined && TRUTHY_VALUES.has(val2));
}

export function setYoloSessionState(active: boolean): void {
  sessionYoloState = active;
}

export function isYoloModeActive(env: Record<string, string | undefined> = process.env): boolean {
  if (!isYoloEnvironmentAdmitted(env)) return false;
  return sessionYoloState;
}

/** Legacy alias for compatibility */
export function isYoloModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isYoloModeActive(env);
}
