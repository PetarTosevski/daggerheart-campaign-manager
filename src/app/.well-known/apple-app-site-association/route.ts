import { appLinkResponse, appleAppSiteAssociation } from "@/lib/app-links";

/**
 * iOS universal links for the phone app's Google sign-in return (`src/lib/app-links.ts`, dcm-gdzi.41). Apple fetches
 * this path without an extension and wants JSON with no redirect; src/proxy.ts skips paths with a dot, so signed-out
 * requests are answered here. The env is read per request, so setting a Vercel variable needs no code change.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return appLinkResponse(appleAppSiteAssociation(process.env));
}
