import { NextResponse, type NextRequest } from "next/server";

/**
 * Notes moved into the Journal (JX1, user 2026-11-03): `/notes?view=&page=&journal=` answers with a 307 to the Journal's
 * Notes sub-tab, those three params passed on as they are (NotesBody parses them and falls back on bad values); every
 * other param is dropped. A route handler, not a page: see ../sessions/route.ts. Signed-out requests never get here
 * (src/proxy.ts), and the redirect reads no data.
 */
const KEPT = ["view", "page", "journal"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const from = request.nextUrl.searchParams;
  const query = new URLSearchParams({ tab: "notes" });
  for (const name of KEPT) {
    const value = from.get(name);
    if (value) query.set(name, value);
  }
  const to = request.nextUrl.clone();
  to.pathname = `/campaigns/${encodeURIComponent(campaignId)}/journal`;
  to.search = query.toString();
  return NextResponse.redirect(to, 307);
}
