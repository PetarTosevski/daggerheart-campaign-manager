import { useGlobalSearchParams, usePathname, useSegments } from "expo-router";

import { safeNextPath } from "../../../../src/lib/safe-next";
import { CAMPAIGNS_HREF } from "./sections";

export const SIGN_IN_HREF = "/sign-in";
export const HOME_HREF = "/home";

/** `/join/<code>`: the one deep link a signed-out visitor keeps through sign-in (sign-up reads its code). */
const JOIN_LINK = /^\/join\/[^/?#]{1,64}\/?$/;

/** The route's path without groups (`["(auth)", "sign-in"]` is `["sign-in"]`). */
function pathOf(segments: readonly string[]): string[] {
  return segments.filter((segment) => segment.length > 0 && !segment.startsWith("("));
}

/**
 * The only screens a signed-out visitor may see: sign-in and the Google return page `/auth`. Everything else,
 * `/campaign` and all under it included, sends them to sign-in.
 */
export function signedOutAllowed(segments: readonly string[]): boolean {
  const path = pathOf(segments);
  return path.length === 1 && (path[0] === "sign-in" || path[0] === "auth");
}

/** Sign-in for a signed-out visitor on `pathname`: a join link rides along as `?next=/join/<code>`. */
export function signInHref(pathname: string | null | undefined): string {
  return pathname && JOIN_LINK.test(pathname) ? `${SIGN_IN_HREF}?next=${encodeURIComponent(pathname)}` : SIGN_IN_HREF;
}

/**
 * Where a newly signed-in visitor goes: `next` when it is a path inside this app (the website's `safeNextPath`
 * rejects absolute URLs, `//host` and `/\host`), home otherwise. A `next` back to sign-in or `/auth` would loop, so
 * it goes home too.
 */
export function afterSignInHref(next: string | null | undefined): string {
  const path = safeNextPath(next);
  if (path === "/") return HOME_HREF;
  const first = path.split(/[/?#]/)[1];
  return first === "sign-in" || first === "auth" ? HOME_HREF : path;
}

/**
 * Where the root layout sends the visitor, or null to stay. Signed out: sign-in unless the screen is public (a join
 * link keeps its path as `next`). Signed in: sign-in and `/auth` go to `next` or home, the root goes home; the bare
 * `/campaign` (no screen of its own) goes to the campaign list.
 */
export function sessionRedirect({
  isAuthenticated,
  isLoading,
  segments,
  pathname,
  next,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
  segments: readonly string[];
  /** The current URL path (`usePathname()`), so a join link can ride through sign-in. */
  pathname?: string | null;
  /** The current `?next=` search param, honoured after sign-in. */
  next?: string | null;
}): string | null {
  if (isLoading) return null;
  if (!isAuthenticated) return signedOutAllowed(segments) ? null : signInHref(pathname);
  const path = pathOf(segments);
  const leaf = path[path.length - 1];
  if (path.length === 0 || (path.length === 1 && leaf === "index")) return HOME_HREF;
  if (path.length === 1 && (leaf === "sign-in" || leaf === "auth")) return afterSignInHref(next);
  if (path.length === 1 && leaf === "campaign") return CAMPAIGNS_HREF;
  return null;
}

/**
 * `sessionRedirect` for the root layout: the session state (`useConvexAuth()`) plus the route segments, the URL path
 * and `?next=` from the router.
 */
export function useSessionRedirect({
  isAuthenticated,
  isLoading,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
}): string | null {
  const segments = useSegments();
  const pathname = usePathname();
  const { next } = useGlobalSearchParams<{ next?: string | string[] }>();
  return sessionRedirect({
    isAuthenticated,
    isLoading,
    segments,
    pathname,
    next: Array.isArray(next) ? next[0] : next,
  });
}
