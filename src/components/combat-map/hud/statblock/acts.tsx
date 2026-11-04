"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ActionResult, Intent, Resolved } from "../../../adversaries/tracker/actions/use-adversary-actions";
import { useSpotlightMoves } from "../spotlight";
import { FearConfirm } from "./fear-confirm";
import { fearReasons } from "./model";

/**
 * The GM's adversary intents in the HUD (plan combat-hud H5.2): the same server API as the Encounter tab and the classic
 * map column (`adversaryActions.attack` / `useFeature`), with every Fear spend asked through FearConfirm (answer 6a).
 * The server answers `confirmFear` before it rolls or pays anything (Q19); the GM's "Spend n Fear" sends the same
 * intent again with `spendFear`. A resolved action spotlighted the adversary (CB p.194), so the scene spotlight goes to
 * the GM too (`combatSpotlight.gmTake`, H1.S). Fear spent lowers `campaigns.fear` at once (optimistic, CL4).
 */

type AttackArgs = Omit<FunctionArgs<typeof api.adversaryActions.attack>, "campaignId" | "idempotencyKey" | "spendFear">;
type FeatureArgs = Omit<FunctionArgs<typeof api.adversaryActions.useFeature>, "campaignId" | "idempotencyKey" | "spendFear">;
type Answer = FunctionReturnType<typeof api.adversaryActions.attack>;

/** What FearConfirm is asked and how the asker hears back. */
type Asking = { amount: number; reasons: string[]; answer: (yes: boolean) => void };

export type FearAsk = (amount: number, reasons: string[]) => Promise<boolean>;

/**
 * One FearConfirm at a time, owned by a part that stays mounted (the shell's stat block slot), so a question asked
 * from the picking panel survives the stat block closing. Unmounting answers No.
 */
export function useFearAsk(): { ask: FearAsk; node: ReactNode } {
  const [asking, setAsking] = useState<Asking | null>(null);
  const live = useRef<Asking | null>(null);
  useEffect(() => () => live.current?.answer(false), []);
  const ask: FearAsk = (amount, reasons) =>
    new Promise<boolean>((resolve) => {
      live.current?.answer(false);
      const next: Asking = {
        amount,
        reasons,
        answer: (yes) => {
          if (live.current === next) live.current = null;
          setAsking((now) => (now === next ? null : now));
          resolve(yes);
        },
      };
      live.current = next;
      setAsking(next);
    });
  const node = asking ? <FearConfirm amount={asking.amount} reasons={asking.reasons} onConfirm={() => asking.answer(true)} onCancel={() => asking.answer(false)} /> : null;
  return { ask, node };
}

/** What a send says about itself: the result line's label and the names FearConfirm's reasons use. */
export type ActMeta = {
  label: string;
  actor: string;
  feature?: string;
  experience?: string | null;
  /** The acting adversary's token: the scene spotlight lights it (dcm-bxp.99.32.35). */
  tokenId?: Id<"combatTokens">;
};

export function useGmActs(campaignId: Id<"campaigns">, ask: FearAsk) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const { take } = useSpotlightMoves(campaignId);

  function lowerFear(store: OptimisticLocalStore, spendFear: number | undefined) {
    if (!spendFear) return;
    const fear = store.getQuery(api.campaigns.fear, { campaignId });
    if (fear === undefined || fear < spendFear) return;
    store.setQuery(api.campaigns.fear, { campaignId }, fear - spendFear);
  }
  const attack = useMutation(api.adversaryActions.attack).withOptimisticUpdate((store, args) => lowerFear(store, args.spendFear));
  const featureUse = useMutation(api.adversaryActions.useFeature).withOptimisticUpdate((store, args) => lowerFear(store, args.spendFear));

  /**
   * Sends once; on `confirmFear` asks FearConfirm and, on Yes, sends again paying it. Null when the GM said No (nothing
   * was rolled or paid). A refusal throws (the caller shows it under the pressed control).
   */
  async function run(call: (spendFear?: number) => Promise<Answer>, meta: ActMeta, instanceId: string): Promise<Resolved | null> {
    setPending(true);
    try {
      let answer = await call();
      if (answer.status === "confirmFear") {
        const yes = await ask(answer.fear, fearReasons(answer, meta.actor, meta.feature ?? null, meta.experience ?? null));
        if (!yes) return null;
        answer = await call(answer.fear);
        if (answer.status === "confirmFear") return null;
      }
      setResult({ label: meta.label, actor: meta.actor, instanceId, result: answer });
      take(meta.tokenId);
      return answer;
    } finally {
      setPending(false);
    }
  }

  const base = (spendFear?: number) => ({ campaignId, idempotencyKey: crypto.randomUUID(), ...(spendFear ? { spendFear } : {}) });
  const sendAttack = (args: AttackArgs, meta: ActMeta) => run((spendFear) => attack({ ...args, ...base(spendFear) }), meta, args.instanceId);
  const sendFeature = (args: FeatureArgs, meta: ActMeta) => run((spendFear) => featureUse({ ...args, ...base(spendFear) }), meta, args.instanceId);

  return {
    pending,
    result,
    dismiss: () => setResult(null),
    /** The scene spotlight to the GM (H1.S), after the Spotlight button. */
    take,
    attack: sendAttack,
    feature: sendFeature,
    /** A follow-up the result offers (a reaction feature): the classic `Intent`. */
    fire: (intent: Intent) =>
      intent.kind === "attack"
        ? sendAttack(intent.args, { label: intent.label, actor: intent.actor })
        : sendFeature(intent.args, { label: intent.label, actor: intent.actor, feature: intent.args.feature }),
  };
}

export type GmActs = ReturnType<typeof useGmActs>;
