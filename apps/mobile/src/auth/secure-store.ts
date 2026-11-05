import type { TokenStorage } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";

/**
 * Token storage for `ConvexAuthProvider`.
 *
 * Uses the async SecureStore methods. Keys may contain alphanumeric characters,
 * `.`, `-`, and `_` (`setItemAsync`). Convex Auth strips every other character
 * from the storage namespace before it writes. The default accessibility is
 * `WHEN_UNLOCKED`. Values are not logged.
 */
export const secureTokenStorage: TokenStorage = {
  getItem(key) {
    return SecureStore.getItemAsync(key);
  },
  setItem(key, value) {
    return SecureStore.setItemAsync(key, value);
  },
  removeItem(key) {
    return SecureStore.deleteItemAsync(key);
  },
};
