"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { openSettings } from "@/components/config/shell";
import { errorMessage } from "@/lib/convex-errors";
import { optionsFor } from "@/lib/frames/options";

import { api } from "../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../convex/campaigns";

/**
 * GM switches for the campaign's optional rules: a shortcut to Campaign settings › House rules (config SX, Q10 b). Both
 * write `campaigns.setOption` with the same optimistic update on `campaigns.get`, so the two always agree; 'All house
 * rules' opens the settings there.
 */
export function FrameRulesPanel({ campaign }: { campaign: CampaignSummary }) {
  const campaignId = campaign._id;
  const setOption = useMutation(api.campaigns.setOption).withOptimisticUpdate((store, { option, enabled }) => {
    const current = store.getQuery(api.campaigns.get, { campaignId });
    if (current) store.setQuery(api.campaigns.get, { campaignId }, { ...current, options: { ...current.options, [option]: enabled } });
  });
  const [error, setError] = useState<string | null>(null);
  const options = optionsFor(campaign.frameId);
  if (campaign.role !== "gm" || options.length === 0) return null;

  return (
    <section aria-labelledby="rules-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rules-h" className="m-0 font-display text-[22px] font-bold text-parchment">
          Campaign Rules
        </h2>
        <BrandButton variant="neutral" size="sm" onClick={() => openSettings("rules")} aria-haspopup="dialog">
          All house rules
        </BrandButton>
      </div>
      {options.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-start gap-3 py-1 text-[14px] text-[#e6ecea]">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--brand)]"
            checked={campaign.options[o.id]}
            onChange={(e) => {
              setError(null);
              setOption({ campaignId, option: o.id, enabled: e.target.checked }).catch((err: unknown) => setError(errorMessage(err)));
            }}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{o.label}</span>
            <span className="text-[13px] text-[#9fb2b6]">{o.description}</span>
          </span>
        </label>
      ))}
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
