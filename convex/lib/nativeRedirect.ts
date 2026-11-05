/**
 * Where Google may send the browser after the website's OAuth code exchange.
 *
 * Convex Auth calls this from `callbacks.redirect` (`@convex-dev/auth` redirects.ts).
 * The default allows a relative path or a URL under `SITE_URL`. The phone app also
 * returns to its own scheme. Anything else is refused, including a protocol-relative
 * URL and a scheme that only starts with the same letters.
 */
const APP_SCHEMES = ["dualityheart-dev://", "dualityheart://"];

function nativeRedirectTarget(redirectTo: string, siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/+$/, "");
  if (base.length === 0) throw new Error("Missing environment variable `SITE_URL`");
  if (!isRedirectShape(redirectTo)) {
    throw new Error(`Invalid \`redirectTo\` ${redirectTo} for configured SITE_URL: ${base}`);
  }
  if (APP_SCHEMES.some((scheme) => redirectTo.startsWith(scheme))) return redirectTo;
  if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) return `${base}${redirectTo}`;
  if (redirectTo.startsWith(base)) {
    const after = redirectTo[base.length];
    if (after === undefined || after === "?" || after === "/") return redirectTo;
  }
  throw new Error(`Invalid \`redirectTo\` ${redirectTo} for configured SITE_URL: ${base}`);
}

function isRedirectShape(redirectTo: string): boolean {
  if (redirectTo.length === 0 || redirectTo.length > 2048) return false;
  if (redirectTo.startsWith("//")) return false;
  const lower = redirectTo.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) return false;
  for (let i = 0; i < redirectTo.length; i++) {
    const code = redirectTo.charCodeAt(i);
    if (code <= 32 || code === 127 || redirectTo[i] === "\\") return false;
  }
  return true;
}

// A line that starts with `export` would register this helper in convex/_generated.
void 0; export { nativeRedirectTarget };
