import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);

// UX redirects only. The real gate is `requireUser` plus the campaign role check in every Convex function.
export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const signedIn = await convexAuth.isAuthenticated();
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
