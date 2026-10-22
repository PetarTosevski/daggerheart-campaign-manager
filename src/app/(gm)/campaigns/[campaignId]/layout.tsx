import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { preloadQuery } from "convex/nextjs";
import { Suspense, type ReactNode } from "react";

import { LorekeeperDrawer } from "@/components/lorekeeper/drawer";

import { api } from "../../../../../convex/_generated/api";
import { CampaignShell, CampaignShellLoading, type PreloadedCampaign } from "./campaign-shell";

/**
 * The campaign summary for the shell, read on the server with the caller's token (CL5, PF4). The page then hydrates
 * with the campaign in hand, so the shell and the page mount at once and every query goes out in the first Convex
 * flight instead of one round trip after `campaigns.get`.
 *
 * A failed read (Convex unreachable, a token the server rejects) returns null: the shell then reads the campaign on the
 * client as before, where the error boundaries and the ended-session redirect (B5) handle it. Signed-out requests never
 * get here (src/proxy.ts redirects them).
 */
async function preloadCampaign(campaignId: string): Promise<PreloadedCampaign | null> {
  try {
    return await preloadQuery(api.campaigns.get, { campaignId }, { token: await convexAuthNextjsToken() });
  } catch (error) {
    console.error("campaign layout: preloading campaigns.get failed; the shell reads it on the client", error);
    return null;
  }
}

async function PreloadedShell({ campaignId, children }: { campaignId: string; children: ReactNode }) {
  const preloaded = await preloadCampaign(campaignId);
  return (
    <CampaignShell campaignId={campaignId} preloaded={preloaded}>
      {children}
    </CampaignShell>
  );
}

export default async function CampaignLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return (
    // While the server reads the campaign, a hard load streams the shell's own skeleton (not Load Campaign's).
    <Suspense fallback={<CampaignShellLoading />}>
      <PreloadedShell campaignId={campaignId}>
        {children}
        {/* D13 L7: the Lorekeeper pill and drawer on every campaign page (its panel loads on first open). */}
        <LorekeeperDrawer />
      </PreloadedShell>
    </Suspense>
  );
}
