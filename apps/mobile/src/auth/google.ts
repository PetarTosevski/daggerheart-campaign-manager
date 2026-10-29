import type { useAuthActions } from "@convex-dev/auth/react";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";

type SignIn = ReturnType<typeof useAuthActions>["signIn"];

const SCHEMES = new Set(["dualityheart", "dualityheart-dev"]);
const usedCodes = new Set<string>();

export function appScheme(): string | null {
  const scheme = Constants.expoConfig?.scheme;
  if (Array.isArray(scheme)) return scheme[0] ?? null;
  return scheme ?? null;
}

/** `dualityheart://auth` or `dualityheart-dev://auth`, the route in `app/auth.tsx`. */
export function googleRedirectTo(scheme: string | null | undefined): string {
  if (typeof scheme !== "string" || !SCHEMES.has(scheme)) throw new Error("Unsupported app scheme");
  return `${scheme}://auth`;
}

export function oauthCode(url: string): string | null {
  try {
    const code = new URL(url).searchParams.get("code");
    return code !== null && code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

/**
 * Google uses the website's OAuth redirect. `openAuthSessionAsync` is the system browser
 * session: `ASWebAuthenticationSession` on iOS, which shares Safari's cookies, and Chrome
 * Custom Tabs on Android. `preferEphemeralSession: true` would ask for a private session.
 */
export async function signInWithGoogle(signIn: SignIn): Promise<void> {
  const redirectTo = googleRedirectTo(appScheme());
  const started = await signIn("google", { redirectTo });
  if (started.redirect === undefined) return;
  const session = await WebBrowser.openAuthSessionAsync(started.redirect.toString(), redirectTo, {
    preferEphemeralSession: false,
  });
  if (session.type !== "success") return;
  const code = oauthCode(session.url);
  if (code === null || usedCodes.has(code)) return;
  usedCodes.add(code);
  await signIn("google", { code });
}
