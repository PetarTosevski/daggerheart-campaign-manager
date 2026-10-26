"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { optionsFor } from "@/lib/frames/options";

import { api } from "../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../convex/campaigns";

/** GM switches for the campaign's optional rules. */
export function FrameRulesPanel({ campaign }: { campaign: CampaignSummary }) {
  const setOption = useMutation(api.campaigns.setOption);
  const [error, setError] = useState<string | null>(null);
  const options = optionsFor(campaign.frameId);
  if (campaign.role !== "gm" || options.length === 0) return null;

  return (
    <section aria-labelledby="rules-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5">
      <h2 id="rules-h" className="m-0 font-display text-[22px] font-bold text-parchment">
        Campaign Rules
      </h2>
      {options.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-start gap-3 py-1 text-[14px] text-[#e6ecea]">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--brand)]"
            checked={campaign.options[o.id]}
            onChange={(e) => {
              setError(null);
              setOption({ campaignId: campaign._id, option: o.id, enabled: e.target.checked }).catch((err) =>
                setError(errorMessage(err)),
              );
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
