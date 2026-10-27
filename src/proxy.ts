import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

import { withAuthErrorCode } from "@/lib/auth-errors";
import { convexSiteUrl, createJwtVerifier, type JwtVerifier } from "@/lib/auth/verify-jwt";

// The auth proxy answers a failed signIn with only `error.message`, which production Convex redacts. Wrapping `fetch`
// keeps the AppError code in that message (src/lib/auth-errors.ts, dcm-bxp.128.1).
globalThis.fetch = withAuthErrorCode(globalThis.fetch, process.env.NEXT_PUBLIC_CONVEX_URL);

const isSignInPage =createRouteMatcher(["/signin"]);

// The access token is checked locally against the deployment's JWKS (src/lib/auth/verify-jwt.ts), not with a
// Convex `auth:isAuthenticated` call per request (plan performance.yaml, PF2). One verifier, and so one JWKS cache, per
// server process. Without a site URL nothing can be verified, so every request counts as signed out.
const siteUrl = convexSiteUrl({
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
});
const verifyToken: JwtVerifier =
  siteUrl === null
    ? async () => false
    : createJwtVerifier({ issuer: siteUrl, audience: "convex", jwksUrl: `${siteUrl}/.well-known/jwks.json` });
if (siteUrl === null) {
  console.warn("proxy: cannot derive the Convex site URL from NEXT_PUBLIC_CONVEX_URL; set CONVEX_SITE_URL. Every request is treated as signed out.");
}

// UX redirects only. The real gate is `requireUser` plus the campaign role check in every Convex function.
// Prefetches are checked like any request: Next.js strips `next-router-prefetch` (and the other flight headers) before
// the proxy runs (node_modules/next/dist/server/web/adapter.js, FLIGHT_HEADERS), so they cannot be told apart here, and
// with a cached JWKS the local check costs no round trip anyway.
export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const signedIn = await verifyToken(await convexAuth.getToken());
  if (isSignInPage(request) && signedIn) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (!isSignInPage(request) && !signedIn) {
    // Come back here after signing in (for example a /join/<code> link).
    const { pathname } = request.nextUrl;
    const target = pathname === "/" ? "/signin" : `/signin?next=${encodeURIComponent(pathname)}`;
    return nextjsMiddlewareRedirect(request, target);
  }
});

export const config = {
  // Run on everything except static assets and Next.js internals. Paths with a
  // dot are skipped as assets; that only skips the redirect, since Convex
  // functions enforce sign-in themselves.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
