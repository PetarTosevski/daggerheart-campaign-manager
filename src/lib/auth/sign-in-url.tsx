"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { isSignInPath, signInRedirectTarget } from "./session-ended";

/**
 * Rendered by the sign-in page: when the page shows under another URL, replace the URL with /signin?next=<that URL>.
 *
 * How it gets there (B5): when a revoked session's refresh fails, Convex Auth erases the tokens and calls its
 * `invalidateCache` server action, which posts to the current page. The proxy finds no session cookie and redirects
 * that POST to /signin, and Next renders the sign-in page without changing the URL. Signing in there would then go to
 * "/" and the page the user was on would be lost; with the URL fixed, the forms return to it (`next`). The session is
 * already gone by then (the failed refresh cleared the cookies), so nothing is signed out here. On /signin itself this
 * does nothing, so it never loops.
 */
export function SignInUrl() {
  const pathname = usePathname();
  const router = useRouter();
  const elsewhere = pathname !== null && !isSignInPath(pathname);

  useEffect(() => {
    if (!elsewhere) return;
    const target = signInRedirectTarget(window.location.pathname, window.location.search);
    if (target !== null) router.replace(target);
  }, [elsewhere, router]);

  return null;
}
