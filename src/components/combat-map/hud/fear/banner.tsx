"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { MAX_FEAR } from "@/lib/domain/fear";
import { refusalFor } from "@/lib/errors/refusals";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Pips } from "../ui";
import { FEAR_HIDDEN_LABEL, fearShown } from "./hidden";

/**
 * The GM's Fear as a purple banner (plan combat-hud H1.2; CmpTokens 'GM Fear · players' / 'GM Fear · GM', the top-right
 * of Main / GMDesktop): the flame, "GM FEAR", the number and 12 diamond pips; on the GM view − / + ("Spend a Fear" /
 * "Gain a Fear"). The − spends without asking (answer 6a): every other Fear spend asks through H5.3's FearConfirm.
 */

/** Fear after one step, inside 0..MAX_FEAR (the server refuses a step past either end; the optimistic value never goes there). */
export function fearAfterStep(fear: number, direction: "increase" | "decrease"): number {
  return Math.max(0, Math.min(MAX_FEAR, fear + (direction === "increase" ? 1 : -1)));
}

/**
 * `fear.adjust` as an intent (one step, a fresh idempotency key per click) with an optimistic update of both Fear
 * reads on this page (`combatHud.scene`, the banner's; `campaigns.fear`, the drawer's classic pill), so a click shows
 * at once. A refusal is kept as the refusal table's sentence (H6.3, refusals.ts) for the banner's live region.
 */
export function useAdjustFear(campaignId: Id<"campaigns">) {
  const mutate = useMutation(api.fear.adjust).withOptimisticUpdate((store, { campaignId: id, direction }) => {
    const scene = store.getQuery(api.combatHud.scene, { campaignId: id });
    // The GM's reads always hold a number; a null (a hidden pool, R1) has nothing to step.
    if (scene !== undefined && scene.fear !== null) store.setQuery(api.combatHud.scene, { campaignId: id }, { ...scene, fear: fearAfterStep(scene.fear, direction) });
    const fear = store.getQuery(api.campaigns.fear, { campaignId: id });
    if (fear !== undefined && fear !== null) store.setQuery(api.campaigns.fear, { campaignId: id }, fearAfterStep(fear, direction));
  });
  const [error, setError] = useState<string | null>(null);
  async function step(direction: "increase" | "decrease"): Promise<void> {
    setError(null);
    try {
      await mutate({ campaignId, direction, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(refusalFor(e, { viewer: "gm" }).text);
    }
  }
  return { step, error };
}

const Flame = () => (
  <svg className="hud-fb-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
  </svg>
);

export type FearBannerProps = {
  campaignId: Id<"campaigns">;
  /** null: the GM hides the pool from players (R1): "?" and empty pips, the flame and banner kept. */
  fear: number | null;
  /** The GM view: − / + (answer 6a: no confirm). */
  gm: boolean;
};

export function FearBanner({ campaignId, fear, gm }: FearBannerProps) {
  const hidden = fear === null;
  return (
    <div className="hud-fb" role="group" aria-label="GM Fear" data-testid="hud-fear" data-hidden={hidden ? "" : undefined}>
      <div className="hud-fb-in">
        <Flame />
        <span className="hud-fb-t" aria-hidden="true">
          GM Fear
        </span>
        <b className="hud-fb-n" aria-hidden="true" data-testid="hud-fear-value">
          {fearShown(fear)}
        </b>
        <Pips kind="fear" on={fear ?? 0} max={MAX_FEAR} label={hidden ? FEAR_HIDDEN_LABEL : `${fear} of ${MAX_FEAR} Fear`} className="hud-fb-p" />
        {gm && fear !== null ? <FearSteps campaignId={campaignId} fear={fear} /> : null}
      </div>
    </div>
  );
}

function FearSteps({ campaignId, fear }: { campaignId: Id<"campaigns">; fear: number }) {
  const adjust = useAdjustFear(campaignId);
  return (
    <>
      <span className="hud-fb-ctl">
        <button type="button" aria-label="Spend a Fear" disabled={fear <= 0} onClick={() => void adjust.step("decrease")}>
          −
        </button>
        <button type="button" aria-label="Gain a Fear" disabled={fear >= MAX_FEAR} onClick={() => void adjust.step("increase")}>
          +
        </button>
      </span>
      <span role="status" className="hud-fb-err">
        {adjust.error}
      </span>
    </>
  );
}
