import type { ReactNode } from "react";

import { LorekeeperDrawer } from "@/components/lorekeeper/drawer";

import { CampaignShell } from "./campaign-shell";

export default async function CampaignLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return (
    <CampaignShell campaignId={campaignId}>
      {children}
      {/* D13 L7: the Lorekeeper pill and drawer on every campaign page (its panel loads on first open). */}
      <LorekeeperDrawer />
    </CampaignShell>
  );
}
