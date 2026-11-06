"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { refusalFor, type Refusal } from "@/lib/errors/refusals";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActor } from "../../actions/targets";
import type { CombatPageState } from "../../slots";
import { RefusalMessage, hudToasts } from "../blocked";
import { usePick, type PickContext } from "../pick";
import { Popup, Stepper, hudButtonClass } from "../ui";
import { bandsFrom, minionPatch, minionSession, minionTitle, targetPhrase, type MinionData, type MinionOffer } from "./model";
import { useAttackPicker } from "./use-attack";

/**
 * The attack picker's prompts on the HUD (plan combat-hud H3.2; CmpPromptsPlayer), mounted in the pop region:
 * - 'Forced attack' (`.pc.red`): a forced attack waiting on the character (Beguiled, HF p.75); "Attack Oriel" opens the
 *   picker with the target locked;
 * - 'Your hit can defeat 2 more Minions' (CB p.201): "Pick Minions" opens the panel with the candidates as rows (and
 *   rings), "Skip" defeats none;
 * The attack's result and a held roll ("Your roll waits") are H4.1's result panel (`hud/result`); the action ring's
 * Attack opens the picker through `useAttackPicker().open()`.
 * Players only; the forced attacks and Minion offers come from the server's open requests, so a reload keeps them.
 */

const SWORDS = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M2 2l8 8M14 2l-8 8M9 11l2 2M7 11l-2 2" />
  </svg>
);
const LOCK = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 0 0-4 0z" />
  </svg>
);

export function HudAttack({ state }: { state: CombatPageState }) {
  if (state.map === null) return null;
  if (state.role === "gm") return <GmMinionOffers state={state} />;
  if (state.role !== "player") return null;
  return <PlayerAttack state={state} />;
}

/**
 * Rule switches RC1, D6 variant "GM picks the extra Minions" (not in the books, Q5 a): every PC's open Minion offer waits
 * on the GM's HUD, picked with the same panel. Nothing in the Book (the attacker picks) or Manual (no offer opens).
 */
function GmMinionOffers({ state }: { state: CombatPageState }) {
  const gmPicks = useQuery(api.ruleSettings.get, { campaignId: state.campaignId })?.modes.minions === "gmPicks";
  if (!gmPicks) return null;
  return (
    <ul className="hud-atk-prompts" aria-label="Minion picks">
      <MinionOffers state={state} characterId={null} />
    </ul>
  );
}

function PlayerAttack({ state }: { state: CombatPageState }) {
  const picker = useAttackPicker(state);
  if (picker.characterId === null) return null;
  return (
    <>
      <ul className="hud-atk-prompts" aria-label="Attack prompts">
        {picker.forced.map((f) => (
          <li key={f.requestId}>
            <Popup
              icon={SWORDS}
              tone="red"
              title="Forced attack"
              sub={`${f.feature} · you must attack`}
              testId="hud-attack-forced"
              primary={{ label: `Attack ${targetPhrase(f.targets.map((t) => ({ name: t.name, side: "pc" })))}`, disabled: !picker.ready, onClick: () => picker.open({ forcedRequestId: f.requestId }) }}
            >
              <p>
                {f.instanceLabel}’s {f.feature} locks the target. Pick the weapon and roll.
              </p>
              <span className="hud-atk-lock">
                {LOCK} Target: {f.targets.map((t) => t.name).join(", ")}
              </span>
            </Popup>
          </li>
        ))}
        <MinionOffers state={state} characterId={picker.characterId} />
      </ul>
    </>
  );
}

/**
 * The character's open Minion offers (`combatRequestsReads.mine`), each a prompt card that opens the Minion pick. For the
 * GM (`characterId` null, D6 variant) every PC's offer. RC1: while the GM picks (variant), a player's offer is a "the GM
 * picks" card without buttons.
 */
function MinionOffers({ state, characterId }: { state: CombatPageState; characterId: Id<"characters"> | null }) {
  const { campaignId } = state;
  const pick = usePick();
  const actor = useActor(state);
  const rows = useQuery(api.combatRequestsReads.mine, { campaignId });
  const gmPicks = useQuery(api.ruleSettings.get, { campaignId })?.modes.minions === "gmPicks";
  const pickMinions = useMutation(api.combatActions.pickMinions).withOptimisticUpdate((store, args) => {
    const mine = store.getQuery(api.combatRequestsReads.mine, { campaignId });
    if (mine !== undefined) store.setQuery(api.combatRequestsReads.mine, { campaignId }, mine.filter((r) => !(r.kind === "minionOffer" && r.entryId === args.entryId)));
  });
  const [errors, setErrors] = useState<Readonly<Record<string, Refusal | null>>>({});
  const offers = (rows ?? []).flatMap((r) => (r.kind === "minionOffer" && (characterId === null || r.characterId === characterId) ? [r] : []));
  if (offers.length === 0) return null;
  if (characterId !== null && gmPicks) {
    return offers.map((offer) => (
      <li key={offer.requestId}>
        <Popup icon={SWORDS} title={minionTitle(offer.extra)} sub="The GM picks them" testId="hud-attack-minions-gm">
          <p>In this campaign the GM picks the extra Minions your hit defeats (a house rule, not in the books).</p>
        </Popup>
      </li>
    ));
  }

  const send = (offer: MinionOffer) => async (instanceIds: Id<"encounterAdversaries">[]) => {
    await pickMinions({ campaignId, entryId: offer.entryId, instanceIds, idempotencyKey: crypto.randomUUID() });
  };

  async function skip(offer: MinionOffer) {
    setErrors((e) => ({ ...e, [offer.requestId]: null }));
    try {
      await send(offer)([]);
    } catch (error) {
      // H6.2: the table's words under Skip, or a toast where the table places it (an offer already answered).
      const refusal = refusalFor(error, { subject: minionTitle(offer.extra) });
      if (refusal.place === "toast") hudToasts.refusal(refusal);
      else setErrors((e) => ({ ...e, [offer.requestId]: refusal }));
    }
  }

  function open(offer: MinionOffer) {
    const bands = actor ? bandsFrom(actor.view) : new Map();
    const render = (ctx: PickContext<MinionData>) => <MinionCounts ctx={ctx} offer={offer} pick={send(offer)} />;
    pick.open(minionSession({ offer, bands, data: { counts: {} }, pick: send(offer), render }));
  }

  return offers.map((offer) => (
    <li key={offer.requestId}>
      <Popup
        icon={SWORDS}
        title={characterId === null ? `${offer.characterName}’s hit can defeat ${offer.extra} more Minion${offer.extra === 1 ? "" : "s"}` : minionTitle(offer.extra)}
        sub={characterId === null ? "You pick them" : "After your hit"}
        testId="hud-attack-minions"
        primary={{ label: "Pick Minions", onClick: () => open(offer) }}
        secondary={
          <button type="button" className={hudButtonClass("cancel")} onClick={() => void skip(offer)}>
            Skip
          </button>
        }
      >
        <p>Only Minions within your weapon’s range can be picked: {offer.candidates.map((c) => c.name).join(", ")}.</p>
        <RefusalMessage refusal={errors[offer.requestId] ?? null} />
      </Popup>
    </li>
  ));
}

/** A picked Minion token standing for several Minions: how many of them this hit defeats. */
function MinionCounts({ ctx, offer, pick }: { ctx: PickContext<MinionData>; offer: MinionOffer; pick: (ids: Id<"encounterAdversaries">[]) => Promise<void> }) {
  const { data, selection, update } = ctx;
  const several = offer.candidates.filter((c) => c.available > 1 && selection.targetIds.includes(c.tokenId));
  if (several.length === 0) return null;
  const total = offer.candidates.filter((c) => selection.targetIds.includes(c.tokenId)).reduce((n, c) => n + Math.max(1, Math.min(c.available, data.counts[c.instanceId] ?? 1)), 0);
  return (
    <div className="hud-atk">
      {several.map((c) => {
        const n = Math.max(1, Math.min(c.available, data.counts[c.instanceId] ?? 1));
        return (
          <span key={c.instanceId} className="hud-atk-step">
            <Stepper
              label={`Minions from ${c.name}`}
              value={n}
              min={1}
              max={Math.min(c.available, n + offer.extra - total)}
              onStep={(d) => {
                const next = { counts: { ...data.counts, [c.instanceId]: n + d } };
                update(minionPatch(offer, next, pick));
              }}
            />
            <small>from {c.name}</small>
          </span>
        );
      })}
    </div>
  );
}
