"use client";

import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSlot } from "../slots";

// NB3: its own module, so the Party roster takes the button without ./index's tier history, its pickers, the full
// sheet schema (zod) and the domain card list.

/** The GM's "Party levels up" button on the roster (CB 109: all party members level up together). */
export const PartyLevelUpButton: CampaignSlot = ({ campaignId, isGm }) => {
  const { fire, error, pending } = useIntent(api.levelUp.partyLevelUp);
  const [notice, setNotice] = useState<string | null>(null);
  if (!isGm) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <BrandButton
        variant="neutral"
        size="lg"
        disabled={pending}
        onClick={async () => {
          const result = await fire({ campaignId });
          if (result) setNotice(result.flagged === 1 ? "1 character can level up." : `${result.flagged} characters can level up.`);
        }}
      >
        Party levels up
      </BrandButton>
      <span role="status" className="text-[14px] text-[#c9d2cf] empty:hidden">
        {error ?? notice}
      </span>
    </div>
  );
};
