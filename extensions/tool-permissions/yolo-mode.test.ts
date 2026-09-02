import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyToml } from "smol-toml";
import { isYoloEnvironmentAdmitted, isYoloModeActive, setYoloSessionState } from "./yolo-mode.ts";
import { resolveToolPermissionDecision } from "./index.ts";

function createPolicyDir(policyObj: unknown): { tmpDir: string; userPermissionsPath: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "yolo-mode-test-"));
  const configDir = join(tmpDir, ".config", "pi");
  mkdirSync(configDir, { recursive: true });
  const userPermissionsPath = join(configDir, "permissions.toml");
  writeFileSync(userPermissionsPath, stringifyToml({ permissions: policyObj as any }));
  return { tmpDir, userPermissionsPath };
}

test("isYoloEnvironmentAdmitted checks PI_YOLO_MODE and PI_PERMISSION_YOLO truthy values", () => {
  assert.equal(isYoloEnvironmentAdmitted({ PI_YOLO_MODE: "1" }), true);
  assert.equal(isYoloEnvironmentAdmitted({ PI_YOLO_MODE: "true" }), true);
  assert.equal(isYoloEnvironmentAdmitted({ PI_YOLO_MODE: "YES" }), true);
  assert.equal(isYoloEnvironmentAdmitted({ PI_PERMISSION_YOLO: "1" }), true);

  assert.equal(isYoloEnvironmentAdmitted({ PI_YOLO_MODE: "0" }), false);
  assert.equal(isYoloEnvironmentAdmitted({ PI_YOLO_MODE: "false" }), false);
  assert.equal(isYoloEnvironmentAdmitted({}), false);
});

test("bypasses prompts and allows unlisted tools when environment is admitted and /yolo on is active", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: { allow: [], deny: [] },
  });
  const previousEnv = process.env.PI_YOLO_MODE;
  process.env.PI_YOLO_MODE = "1";
  setYoloSessionState(true);
  try {
    const decision = resolveToolPermissionDecision("bash", { command: "npm run build" }, tmpDir, { userPermissionsPath });
    assert.equal(decision.decision, "allow");
    assert.equal(decision.source, "yolo_mode");
  } finally {
    setYoloSessionState(false);
    if (previousEnv === undefined) delete process.env.PI_YOLO_MODE;
    else process.env.PI_YOLO_MODE = previousEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("requires /yolo on toggle even when environment variable is set", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: { allow: [], deny: [] },
  });
  const previousEnv = process.env.PI_YOLO_MODE;
  process.env.PI_YOLO_MODE = "1";
  setYoloSessionState(false); // Not turned on yet via /yolo on
  try {
    const decision = resolveToolPermissionDecision("bash", { command: "npm run build" }, tmpDir, { userPermissionsPath });
    assert.equal(decision.decision, "ask");
  } finally {
    if (previousEnv === undefined) delete process.env.PI_YOLO_MODE;
    else process.env.PI_YOLO_MODE = previousEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("explicit deny rules still take precedence over active YOLO mode", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: { allow: [], deny: [{ command: "^rm " }] },
  });
  const previousEnv = process.env.PI_YOLO_MODE;
  process.env.PI_YOLO_MODE = "1";
  setYoloSessionState(true);
  try {
    const decision = resolveToolPermissionDecision("bash", { command: "rm -rf /" }, tmpDir, { userPermissionsPath });
    assert.equal(decision.decision, "deny");
  } finally {
    setYoloSessionState(false);
    if (previousEnv === undefined) delete process.env.PI_YOLO_MODE;
    else process.env.PI_YOLO_MODE = previousEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
