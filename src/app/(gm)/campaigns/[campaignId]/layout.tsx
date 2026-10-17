import type { ReactNode } from "react";

import { CampaignShell } from "./campaign-shell";

export default async function CampaignLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return <CampaignShell campaignId={campaignId}>{children}</CampaignShell>;
}
