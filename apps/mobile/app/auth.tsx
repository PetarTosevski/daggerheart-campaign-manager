import { AuthCallback } from "../src/shell/auth-callback";

export { RouteErrorBoundary as ErrorBoundary } from "../src/shell/route-error";

/**
 * Google returns to `https://<site>/auth` (`googleRedirectTo` in `src/auth/google.ts`), a universal link on iOS and a
 * verified app link on Android; no custom scheme. `openAuthSessionAsync` hands that URL back to the sign-in button,
 * which exchanges the code. If the link opens this screen instead, it waits, then times out back to sign-in.
 */
export default function AuthCallbackScreen() {
  return <AuthCallback />;
}
