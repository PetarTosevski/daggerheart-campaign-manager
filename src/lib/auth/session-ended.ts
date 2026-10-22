// A session that ends mid-use goes to sign-in and back (plan d12-bugs, B5; user answer 2026-10-22).
//
// When the Convex client loses its identity (the refresh token was revoked or expired), every signed-in query throws
// `ConvexError({ code: "UNAUTHENTICATED" })` into the nearest route error boundary. Instead of the error screen, the
// boundary signs out locally (so the proxy's JWT cookie is gone and /signin does not bounce back to "/") and replaces
// the URL with /signin?next=<path + search>; the sign-in forms already return to `next` (src/lib/safe-next.ts).
// Only UNAUTHENTICATED does this; FORBIDDEN, NOT_FOUND and the rest keep the error screen. Nothing here grants access:
// it only sends a signed-out browser to the sign-in page, and every Convex function still checks the caller itself.

import { ConvexError } from "convex/values";

import { safeNextPath } from "@/lib/safe-next";

export const SIGN_IN_PATH = "/signin";

/** True for a Convex function's `ConvexError<AppError>` with code UNAUTHENTICATED (CF13), and nothing else. */
export function isUnauthenticated(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return typeof data === "object" && data !== null && (data as { code?: unknown }).code === "UNAUTHENTICATED";
}

/** The sign-in page itself (with or without a trailing slash). A boundary there never redirects: no loop. */
export function isSignInPath(pathname: string): boolean {
  return pathname === SIGN_IN_PATH || pathname === `${SIGN_IN_PATH}/`;
}

/**
 * Where to send a browser whose session ended on `pathname` + `search`: /signin?next=<path + search>, plain /signin
 * for the main menu (as the proxy does), or null on the sign-in page itself. A path that `safeNextPath` would refuse
 * (`//host`, `/\host`) is dropped rather than carried along.
 */
export function signInRedirectTarget(pathname: string, search: string): string | null {
  if (isSignInPath(pathname)) return null;
  const query = search === "" || search === "?" ? "" : search.startsWith("?") ? search : `?${search}`;
  const back = `${pathname}${query}`;
  if (back === "/" || safeNextPath(back) !== back) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(back)}`;
}

/** The whole decision: the sign-in URL to replace the current one with, or null to keep the error screen. */
export function sessionEndedRedirect(error: unknown, location: { pathname: string; search: string }): string | null {
  if (!isUnauthenticated(error)) return null;
  return signInRedirectTarget(location.pathname, location.search);
}
