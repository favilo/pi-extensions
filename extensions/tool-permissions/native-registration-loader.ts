export type NativeRegistrationResult =
  | { mode: "native"; registrations: string[] }
  | { mode: "typescript"; reason: string };

export function registerNativeToolPermissionsCallbacks(_pi: { on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown): void }): NativeRegistrationResult {
  return { mode: "typescript", reason: "native registration unavailable" };
}
