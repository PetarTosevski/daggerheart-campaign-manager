import { getRandomValues, randomUUID } from "expo-crypto";

/**
 * expo-crypto 58 exposes `getRandomValues` and `randomUUID`. It does not install
 * them on `globalThis`. Fill those methods when the runtime has no Web Crypto
 * so Convex can use them. Existing Web Crypto is left in place.
 */
export function installExpoCrypto(): void {
  const current = globalThis.crypto;
  if (typeof current?.getRandomValues === "function" && typeof current.randomUUID === "function") {
    return;
  }
  const subtle = current && "subtle" in current ? current.subtle : undefined;
  const fill = getRandomValues as unknown as <T extends ArrayBufferView>(typedArray: T) => T;
  const next = {
    getRandomValues<T extends ArrayBufferView>(typedArray: T): T {
      return fill(typedArray);
    },
    randomUUID(): string {
      return randomUUID();
    },
    ...(subtle ? { subtle } : {}),
  };
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: next });
}
