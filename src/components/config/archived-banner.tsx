"use client";

import { useMutation } from "convex/react";
import { Archive } from "lucide-react";
import { useState, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../convex/_generated/api";
import type { CampaignSummary } from "../../../convex/campaigns";

export const ARCHIVED_BANNER_TEXT = "This campaign is archived · read-only";

/**
 * The archived banner (plan config S3, Q9 a), mounted once in the campaign shell (`ConfigMounts`), so every campaign
 * page shows it while `campaigns.get` says `archived`. A small tab hanging from the top centre (`role="status"`), so no
 * page's layout moves; the creator gets Restore (`campaignSettings.unarchive`), everyone else only the notice. The
 * banner goes away by itself once the campaign is restored: `archived` flips for every member at once.
 */
export function ArchivedBanner({ campaign }: { campaign: Pick<CampaignSummary, "_id" | "archived" | "isCreator"> }): ReactNode {
  const unarchive = useMutation(api.campaignSettings.unarchive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!campaign.archived) return null;

  const restore = () => {
    setError(null);
    setBusy(true);
    unarchive({ campaignId: campaign._id }).then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <div
      role="status"
      data-testid="archived-banner"
      className="fixed top-0 left-1/2 z-[60] flex max-w-[calc(100vw-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-b-xl border border-t-0 border-[#4a2a28] bg-[#1d1414]/95 px-4 py-1 text-[13px] text-[#f3c9bf] shadow-lg"
    >
      <Archive className="size-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
      <span>{ARCHIVED_BANNER_TEXT}</span>
      {campaign.isCreator ? (
        <BrandButton variant="confirm" size="sm" disabled={busy} onClick={restore}>
          Restore
        </BrandButton>
      ) : null}
      {error ? (
        <span role="alert" className="w-full text-center text-[13px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
