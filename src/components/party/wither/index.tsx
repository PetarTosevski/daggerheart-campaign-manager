"use client";

import "./wither.css";

import { useQuery } from "convex/react";
import { useState } from "react";

import { Label, SlotRow, Small } from "@/components/party/sheet-ui";
import { FEAR_DIE_SIDES, WITHER_POOL } from "@/lib/domain/wither";
import { frameHasMechanic } from "@/lib/frames";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import { SlotBoundary } from "../session/boundary";
import type { CharacterSlot, SlotProps } from "../slots";

// D5 Wither tokens, Witherwild only (T5). Contract: ../slots.ts. Rules: CB 261.

function Counter({ campaignId, character, isGm }: SlotProps) {
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const gain = useIntent(api.wither.gain);
  const adjust = useIntent(api.wither.adjust);
  const [report, setReport] = useState<string | null>(null);
  const tokens = character.sheet.wither ?? 0;
  if (!campaign || !frameHasMechanic(campaign.frameId, "witherTokens")) return null;
  const name = character.sheet.name;

  async function plusOne() {
    setReport(null);
    const r = await gain.fire({ campaignId, characterId: character._id });
    if (r) setReport(r.scarred ? `Fear Die ${r.fearDie}, at or below ${r.tokens}: a scar, tokens cleared.${r.journeyEnds ? " The last Hope slot is gone." : ""}` : `Fear Die ${r.fearDie}, above ${r.tokens}: no scar.`);
  }

  async function minusOne() {
    setReport(null);
    await adjust.fire({ campaignId, characterId: character._id, delta: -1 });
  }

  // One slot per Fear Die face (d12); more tokens than that add slots.
  const slots = Math.max(FEAR_DIE_SIDES, tokens);
  return (
    <section aria-label="Wither tokens" className="wither">
      <div className="wither-row">
        <Label className="wither-lbl">
          Wither{" "}
          <strong className="wither-count" data-testid="wither-tokens">
            {tokens}
          </strong>
        </Label>
        <SlotRow role="img" aria-label={`${tokens} Wither token${tokens === 1 ? "" : "s"}`} className="wither-slots">
          {Array.from({ length: slots }, (_, k) => (
            <span key={k} aria-hidden="true" className={`sh-pip wither-token${k < tokens ? " on" : ""}`} />
          ))}
        </SlotRow>
        {isGm ? (
          <span className="wither-steps">
            <button type="button" className="wither-step" disabled={tokens === 0 || adjust.pending} aria-label={`Remove a Wither token from ${name}`} onClick={() => void minusOne()}>
              −
            </button>
            <button type="button" className="wither-step" disabled={gain.pending} aria-label={`Add a Wither token to ${name} and roll the Fear Die`} onClick={() => void plusOne()}>
              +
            </button>
          </span>
        ) : null}
      </div>
      <Small as="p" role="status" className="italic">
        {gain.error ??
          adjust.error ??
          report ??
          `Severe damage from a Withered source adds a token; the Fear Die at or below the tokens leaves a scar. Pool of ${WITHER_POOL} for reference.`}
      </Small>
    </section>
  );
}

/** The Wither counter on the sheet (page one): tokens for everyone, + Wither and − for the GM. */
export const WitherCounter: CharacterSlot = (props) => (
  <SlotBoundary>
    <Counter {...props} />
  </SlotBoundary>
);

/** The Wither badge on the dashboard party card: shown while the character holds tokens. */
export const WitherCardBadge: CharacterSlot = ({ character }) => {
  const tokens = character.sheet.wither ?? 0;
  if (tokens === 0) return null;
  return (
    <span className="self-start rounded-full border border-[#5a4a2a] bg-[#2a2212] px-2.5 py-0.5 text-[13px] font-semibold text-[#e3c88a]">
      Wither {tokens}
    </span>
  );
};
