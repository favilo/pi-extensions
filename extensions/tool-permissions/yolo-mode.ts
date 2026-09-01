/**
 * Environment-gated YOLO permission mode check.
 */

const TRUTHY_VALUES = new Set(["1", "true", "yes"]);

export function isYoloModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const val1 = env.PI_YOLO_MODE?.trim().toLowerCase();
  const val2 = env.PI_PERMISSION_YOLO?.trim().toLowerCase();
  return (val1 !== undefined && TRUTHY_VALUES.has(val1)) || (val2 !== undefined && TRUTHY_VALUES.has(val2));
}
