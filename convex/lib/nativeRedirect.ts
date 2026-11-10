/**
 * Where Convex Auth may send the browser after Google's OAuth code exchange (dcm-gdzi.5).
 *
 * Convex Auth calls this from `callbacks.redirect` (`@convex-dev/auth` redirects.ts) and appends `?code=<code>` to the
 * answer. The allowlist is explicit:
 * - a relative path or query, resolved on `SITE_URL` (the website's own `next`);
 * - `SITE_URL` itself or a path under it (the website, and the phone app's return address `NATIVE_RETURN_PATH`).
 *
 * Every other target is refused, custom app schemes (`dualityheart://`) included. A custom scheme can be claimed by
 * any app on the phone (RFC 8252 §8.1), and a phishing link that starts the attacker's own Google flow would hand the
 * victim's code to that app, whose verifier matches. The phone therefore returns to `https://<SITE_URL>/auth`, which
 * only the app proven by the site's `apple-app-site-association` / `assetlinks.json` (universal link, Android app link)
 * or the website itself can receive. On top of that, Convex Auth binds each code to the verifier of the client that
 * started the flow, so a code intercepted from the app's own flow cannot be exchanged by anyone else.
 */
const NATIVE_RETURN_PATH = "/auth";

function nativeRedirectTarget(redirectTo: string, siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/+$/, "");
  if (base.length === 0) throw new Error("Missing environment variable `SITE_URL`");
  if (!isRedirectShape(redirectTo)) throw invalidRedirect(redirectTo, base);
  if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) return `${base}${redirectTo}`;
  if (redirectTo.startsWith(base)) {
    const after = redirectTo[base.length];
    if (after === undefined || after === "?" || after === "/") return redirectTo;
  }
  throw invalidRedirect(redirectTo, base);
}

function invalidRedirect(redirectTo: string, base: string): Error {
  return new Error(`Invalid \`redirectTo\` ${redirectTo} for configured SITE_URL: ${base}`);
}

function isRedirectShape(redirectTo: string): boolean {
  if (redirectTo.length === 0 || redirectTo.length > 2048) return false;
  if (redirectTo.startsWith("//")) return false;
  for (let i = 0; i < redirectTo.length; i++) {
    const code = redirectTo.charCodeAt(i);
    if (code <= 32 || code === 127 || redirectTo[i] === "\\") return false;
  }
  return true;
}

export { NATIVE_RETURN_PATH, nativeRedirectTarget };
