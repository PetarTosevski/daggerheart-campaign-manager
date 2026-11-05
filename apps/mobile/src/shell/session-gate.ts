import { CAMPAIGNS_HREF } from "./sections";

export const SIGN_IN_HREF = "/sign-in";
export const HOME_HREF = "/home";

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

/**
 * Where the root layout sends the visitor, or null to stay. Signed out: sign-in unless the screen is public. Signed
 * in: sign-in, `/auth` and the root go home; the bare `/campaign` (an old test screen, `app/(auth)/campaign.tsx`)
 * goes to the campaign list.
 */
export function sessionRedirect({
  isAuthenticated,
  isLoading,
  segments,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
  segments: readonly string[];
}): string | null {
  if (isLoading) return null;
  if (!isAuthenticated) return signedOutAllowed(segments) ? null : SIGN_IN_HREF;
  const path = pathOf(segments);
  const leaf = path[path.length - 1];
  if (path.length === 0 || (path.length === 1 && leaf === "index")) return HOME_HREF;
  if (path.length === 1 && (leaf === "sign-in" || leaf === "auth")) return HOME_HREF;
  if (path.length === 1 && leaf === "campaign") return CAMPAIGNS_HREF;
  return null;
}
