import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const NATIVE_PACKAGE_ENV = "PI_TOOL_PERMISSIONS_NATIVE_PACKAGE" as const;
export const NATIVE_DISABLE_ENV = "PI_TOOL_PERMISSIONS_NATIVE_DISABLE" as const;
export const NAPI_NATIVE_LIBRARY_PATH_ENV = "NAPI_RS_NATIVE_LIBRARY_PATH" as const;

let testOverridePath: string | undefined;

export function bundledNativePackagePath(): string {
  return fileURLToPath(new URL("./native/index.js", import.meta.url));
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function nativeEnabled(environment: NodeJS.ProcessEnv): boolean {
  if (truthy(environment[NATIVE_DISABLE_ENV])) return false;
  const value = environment[NATIVE_PACKAGE_ENV];
  if (value === undefined) return true;
  return truthy(value);
}

export function resolveNativePackagePath(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!nativeEnabled(environment)) return undefined;
  return testOverridePath ?? bundledNativePackagePath();
}

export function requireNativePackage(packagePath: string): unknown {
  const require = createRequire(import.meta.url);
  const previous = process.env[NAPI_NATIVE_LIBRARY_PATH_ENV];
  if (packagePath === bundledNativePackagePath()) delete process.env[NAPI_NATIVE_LIBRARY_PATH_ENV];
  try {
    return require(packagePath);
  } finally {
    if (packagePath === bundledNativePackagePath()) {
      if (previous === undefined) delete process.env[NAPI_NATIVE_LIBRARY_PATH_ENV];
      else process.env[NAPI_NATIVE_LIBRARY_PATH_ENV] = previous;
    }
  }
}

export function setNativePackagePathForTests(packagePath: string | undefined): () => void {
  const previous = testOverridePath;
  testOverridePath = packagePath;
  return () => {
    testOverridePath = previous;
  };
}
