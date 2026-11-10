import type { useAuthActions } from "@convex-dev/auth/react";
import * as WebBrowser from "expo-web-browser";

type SignIn = ReturnType<typeof useAuthActions>["signIn"];

/** The path Google returns to on the website; the server's `NATIVE_RETURN_PATH` (convex/lib/nativeRedirect.ts). */
const RETURN_PATH = "/auth";
const usedCodes = new Set<string>();

/** The website the deployment's `SITE_URL` names, as `features/players/join-link.ts` reads it. */
export function siteUrl(): string {
  return process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "https://dualityheart.com";
}

/**
 * `https://<site>/auth`: an https address only this app (universal link on iOS, verified app link on Android) or the
 * website itself can receive. A custom scheme such as `dualityheart://` could be claimed by any app on the phone and
 * would hand it the sign-in code (RFC 8252 §8.1), so the server refuses those (dcm-gdzi.5).
 */
export function googleRedirectTo(site: string): string {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    throw new Error("Unsupported site URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new Error("Unsupported site URL");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${RETURN_PATH}`;
}

/** The code of a return URL, only when that URL is the expected return address (same origin and path). */
export function oauthCode(url: string, redirectTo: string): string | null {
  try {
    const returned = new URL(url);
    const expected = new URL(redirectTo);
    if (returned.origin !== expected.origin || returned.pathname !== expected.pathname) return null;
    const code = returned.searchParams.get("code");
    return code !== null && code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

/**
 * Google uses the website's OAuth redirect. `openAuthSessionAsync` is the system browser session:
 * `ASWebAuthenticationSession` on iOS, which with `preferUniversalLinks` (iOS 17.4+) completes only on the https
 * return address of this app's associated domain, and Chrome Custom Tabs on Android, whose return arrives through the
 * verified app link. The code is bound to the verifier `signIn` stored when it started the flow, so only this
 * install can exchange it.
 */
export async function signInWithGoogle(signIn: SignIn): Promise<void> {
  const redirectTo = googleRedirectTo(siteUrl());
  const started = await signIn("google", { redirectTo });
  if (started.redirect === undefined) return;
  const session = await WebBrowser.openAuthSessionAsync(started.redirect.toString(), redirectTo, {
    preferEphemeralSession: false,
    preferUniversalLinks: true,
  });
  if (session.type !== "success") return;
  const code = oauthCode(session.url, redirectTo);
  if (code === null || usedCodes.has(code)) return;
  usedCodes.add(code);
  await signIn("google", { code });
}
