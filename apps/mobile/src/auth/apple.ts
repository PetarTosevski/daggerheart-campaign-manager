import type { useAuthActions } from "@convex-dev/auth/react";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

type SignIn = ReturnType<typeof useAuthActions>["signIn"];

export function appleDisplayName(fullName: AppleAuthentication.AppleAuthenticationFullName | null): string {
  if (fullName === null) return "";
  return [fullName.givenName, fullName.familyName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim()
    .slice(0, 80);
}

export function isAppleCancel(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ERR_REQUEST_CANCELED";
}

/**
 * The native Apple button. Expo copies `nonce` onto the Apple request unchanged, and Apple
 * copies that value into the identity token, so the request gets the SHA-256 hex and the
 * server gets the raw nonce. This does not open a browser and does not use Apple's OAuth provider.
 */
export async function signInWithApple(signIn: SignIn): Promise<void> {
  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (credential.identityToken === null) throw new Error("Apple did not return an identity token");
  const name = appleDisplayName(credential.fullName);
  await signIn("apple-native", {
    identityToken: credential.identityToken,
    nonce,
    ...(name.length > 0 ? { name } : {}),
    // The one-time code: the server trades it for a refresh token so Delete account can revoke Apple's grant (DEL1).
    ...(credential.authorizationCode ? { authorizationCode: credential.authorizationCode } : {}),
  });
}
