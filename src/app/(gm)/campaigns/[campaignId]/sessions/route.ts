import { NextResponse, type NextRequest } from "next/server";

/**
 * Sessions moved into the Journal (JX1, user 2026-11-03): `/sessions?s=<id>&stage=prep|play|wrap` answers with a 307 to
 * the Journal's Sessions sub-tab. A route handler, not a page: a page under the campaign layout streams (its Suspense
 * and loading.tsx), so `redirect()` there becomes a 200 with a client-side refresh instead of an HTTP redirect.
 *
 * `s` is passed on as it is (the Journal loads it with `loadSession`, so a bad id falls back there); the old stages map
 * to the Journal's views: prep -> Plan, play and wrap-up -> Log & recap. Any other stage and every other param is
 * dropped. Signed-out requests never get here (src/proxy.ts sends them to sign-in), and the redirect reads no data.
 */
const stageView = (stage: string | null) =>
  stage === "prep" ? "plan"
  : stage === "play" || stage === "wrap" ? "log"
  : null;

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const from = request.nextUrl.searchParams;
  const query = new URLSearchParams({ tab: "sessions" });
  const s = from.get("s");
  if (s) query.set("s", s);
  const view = stageView(from.get("stage"));
  if (view) query.set("sv", view);
  const to = request.nextUrl.clone();
  to.pathname = `/campaigns/${encodeURIComponent(campaignId)}/journal`;
  to.search = query.toString();
  return NextResponse.redirect(to, 307);
}
