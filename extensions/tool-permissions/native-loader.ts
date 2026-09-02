import {
  createNativeProbeRequest,
  decodeNativeProbeResponse,
  type NativeProbeResponse,
} from "./native-contract.ts";

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

export async function loadNativeProbe(options: NativeLoaderOptions): Promise<NativeLoadResult> {
  void options;
  return { engine: "typescript", reason: "native probe unavailable" };
}
