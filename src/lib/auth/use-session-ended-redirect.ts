"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { isSignInPath, isUnauthenticated, signInRedirectTarget } from "./session-ended";

/**
 * Ends the local session. Inside the auth provider (every route segment's error.tsx) this is Convex Auth's own
 * `signOut`: it posts `auth:signOut` through the Next.js /api/auth route, which clears the JWT and refresh-token
 * cookies the proxy reads, and erases the tokens from localStorage and the client's state. global-error.tsx replaces
 * the root layout and so has no provider: it posts the same request itself and erases the stored tokens. Failures are
 * swallowed (the session is usually gone already); the caller redirects either way.
 */
export async function signOutLocally(signOut: (() => Promise<void>) | undefined): Promise<void> {
  try {
    if (signOut) {
      await signOut();
      return;
    }
    await fetch("/api/auth", { method: "POST", body: JSON.stringify({ action: "auth:signOut", args: {} }) });
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("__convexAuth")) window.localStorage.removeItem(key);
    }
  } catch {
    // Already signed out, offline or storage blocked: the sign-in page is still the right place.
  }
}

/**
 * For a route error boundary: true when `error` means the session ended and this is not the sign-in page. Then, once,
 * it signs out locally and replaces the URL with /signin?next=<path + search> (src/lib/auth/session-ended.ts).
 *
 * The effect is the only place this can run: there is no user event, the error boundary mounting is the event. It
 * reads nothing back and writes no app data, and the ref keeps StrictMode's second mount from signing out twice.
 */
export function useSessionEndedRedirect(error: unknown): boolean {
  const pathname = usePathname();
  const router = useRouter();
  // undefined outside the auth provider (global-error.tsx).
  const actions = useAuthActions() as ReturnType<typeof useAuthActions> | undefined;
  const redirecting = isUnauthenticated(error) && !isSignInPath(pathname ?? "");
  const started = useRef(false);

  useEffect(() => {
    if (!redirecting || started.current) return;
    started.current = true;
    const target = signInRedirectTarget(window.location.pathname, window.location.search);
    if (target === null) return;
    void signOutLocally(actions?.signOut).then(() => router.replace(target));
  }, [redirecting, actions, router]);

  return redirecting;
}
