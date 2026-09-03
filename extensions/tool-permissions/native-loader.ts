import {
  createNativeProbeRequest,
  decodeNativeProbeResponse,
  type NativeProbeResponse,
} from "./native-contract.ts";
import { requireNativePackage } from "./native-package.ts";

export type NativeModule = {
  probe(request: ReturnType<typeof createNativeProbeRequest>): unknown | Promise<unknown>;
};

export type NativeLoaderOptions = {
  load: () => NativeModule | Promise<NativeModule>;
  nonce?: string;
};

export type NativeLoadResult =
  | { engine: "native"; response: NativeProbeResponse }
  | { engine: "typescript"; reason: string };

export async function loadNativePackageProbe(packagePath: string, nonce?: string): Promise<NativeLoadResult> {
  return loadNativeProbe({
    nonce,
    load: () => requireNativePackage(packagePath) as NativeModule,
  });
}

export async function loadNativeProbe(options: NativeLoaderOptions): Promise<NativeLoadResult> {
  try {
    const module = await options.load();
    const request = createNativeProbeRequest(options.nonce ?? "tool-permissions");
    const response = decodeNativeProbeResponse(await module.probe(request));
    if (response.nonce !== request.nonce) {
      throw new Error("native contract nonce mismatch");
    }
    return { engine: "native", response };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown native initialization failure";
    return { engine: "typescript", reason: `native probe rejected: ${reason}` };
  }
}
