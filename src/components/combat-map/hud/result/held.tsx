"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ChoiceRow, Popup, hudButtonClass } from "../ui";
import { attackResultView, heldPrimary, heldSub } from "./model";
import { DiceLine, VerdictPill } from "./parts";
import { hudResults } from "./store";

/**
 * The after-roll hold (plan combat-hud H4.1; CmpPromptsPlayer 'Your roll waits'; CB p.107 "Using Features After a
 * Roll": "you use it after the GM declares if the roll succeeds or fails, but before the narrative consequences unfold
 * (such as damage being rolled)") and the damage-phase rider pick (HF p.8 Death Strike). Both come from the server's
 * open requests (`combatRequestsReads.mine`), so a reload keeps them; both answer with one intent and drop the request
 * optimistically.
 */

type MineRow = FunctionReturnType<typeof api.combatRequestsReads.mine>[number];
export type HeldRow = Extract<MineRow, { kind: "afterRoll" }>;
export type RiderRow = Extract<MineRow, { kind: "riderPick" }>;

const HOURGLASS = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M4 1.5h8v2.2c0 1.6-1.2 2.9-2.6 4.3 1.4 1.4 2.6 2.7 2.6 4.3v2.2H4v-2.2c0-1.6 1.2-2.9 2.6-4.3C5.2 6.6 4 5.3 4 3.7z" />
  </svg>
);

/** Drops one request from `combatRequestsReads.mine` in the local store (the click's optimistic update). */
function useAnswer<M extends typeof api.combatActions.afterRoll | typeof api.combatActions.riderPick>(mutation: M, campaignId: Id<"campaigns">, requestId: Id<"combatRequests">) {
  return useMutation(mutation).withOptimisticUpdate((store) => {
    const mine = store.getQuery(api.combatRequestsReads.mine, { campaignId });
    if (mine !== undefined) store.setQuery(api.combatRequestsReads.mine, { campaignId }, mine.filter((r) => r.requestId !== requestId));
  });
}

/** Focus to the prompt when it appears (focus is not state; an effect may move it). */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

export function HeldRoll({ campaignId, row }: { campaignId: Id<"campaigns">; row: HeldRow }) {
  const answer = useAnswer(api.combatActions.afterRoll, campaignId, row.requestId);
  const [chosen, setChosen] = useState<number>(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useFocusOnMount<HTMLDivElement>();
  const option = row.options[chosen] ?? null;

  async function send(choice: { kind: "use"; featureId: string; useId: string; choices: [] } | { kind: "pass" }) {
    setPending(true);
    setError(null);
    try {
      const out = await answer({ campaignId, requestId: row.requestId, choice, idempotencyKey: crypto.randomUUID() });
      if (out.status === "resolved") {
        const meta = hudResults.heldMeta(row.requestId);
        hudResults.show(
          attackResultView({
            characterId: row.characterId,
            actorName: meta?.actorName ?? row.characterName,
            weaponName: meta?.weaponName ?? "Attack",
            damageType: meta?.damageType ?? null,
            result: out,
            names: new Map(row.targets.map((t) => [t.tokenId as string, t.name])),
          }),
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="hud-res-spot" ref={ref} tabIndex={-1} data-testid="hud-result-held">
      <Popup
        icon={HOURGLASS}
        title="Your roll waits"
        sub={heldSub(row.characterName, row.roll)}
        primary={
          row.options.length > 0
            ? {
                label: pending ? "Rolling…" : heldPrimary(row.targets),
                disabled: pending || option === null,
                onClick: () => option && void send({ kind: "use", featureId: option.featureId, useId: option.useId, choices: [] }),
              }
            : undefined
        }
        secondary={
          <button type="button" className={hudButtonClass("cancel")} disabled={pending} onClick={() => void send({ kind: "pass" })}>
            Pass
          </button>
        }
      >
        <DiceLine roll={row.roll} fear={0} />
        <ul className="hud-res-rows hud-res-rows-flat" aria-label="Targets">
          {row.targets.map((t) => (
            <li key={t.tokenId} className="hud-res-row" data-testid="hud-result-row">
              <span className="hud-res-t">{t.name}</span>
              <VerdictPill verdict={t.hit ? "Hit" : "Miss"} />
            </li>
          ))}
        </ul>
        <p>Use a feature before the damage is rolled, or pass.</p>
        {row.options.length > 0 ? (
          <div role="radiogroup" aria-label="Feature to use" className="hud-res-opts">
            {row.options.map((o, i) => (
              <ChoiceRow key={`${o.featureId}|${o.useId}`} type="radio" checked={chosen === i} onSelect={() => setChosen(i)} label={o.name} note={o.costs.length > 0 ? o.costs.join(", ") : "free"} />
            ))}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="hud-res-err">
            {error}
          </p>
        ) : null}
      </Popup>
    </div>
  );
}

/**
 * A damage-phase rider waiting for Use / Pass (DA2; HF p.8 Death Strike: "When you deal Severe damage to a creature, you
 * can mark a Stress to force them to mark an additional Hit Point"): the board's follow-up ask under the result
 * ("Spend a Hope to also Restrain the Bandit?" with Not now / the rider and its cost). Several creatures: tap the one.
 */
export function RiderAsk({ campaignId, row }: { campaignId: Id<"campaigns">; row: RiderRow }) {
  const answer = useAnswer(api.combatActions.riderPick, campaignId, row.requestId);
  const [picked, setPicked] = useState<Id<"combatTokens"> | null>(row.candidates.length === 1 ? row.candidates[0]!.tokenId : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = row.costs.join(", ");
  const several = row.candidates.length > 1;
  const target = row.candidates.find((c) => c.tokenId === picked) ?? null;

  async function send(choice: { kind: "use"; tokenId: Id<"combatTokens"> } | { kind: "pass" }) {
    setPending(true);
    setError(null);
    try {
      await answer({ campaignId, requestId: row.requestId, choice, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="hud-res-ask" data-testid="hud-result-rider">
      <p>
        {cost ? `${cost}: ` : ""}
        {row.name} {several ? "one creature" : <b>{row.candidates[0]?.name ?? "the target"}</b>}?
      </p>
      {several ? (
        <div className="hud-res-chips" role="group" aria-label={`${row.name}: pick one`}>
          {row.candidates.map((c) => (
            <button key={c.tokenId} type="button" className="hud-res-chip" aria-pressed={picked === c.tokenId} onClick={() => setPicked(c.tokenId)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="hud-res-ask-f">
        <button type="button" className={hudButtonClass("cancel")} disabled={pending} onClick={() => void send({ kind: "pass" })}>
          Not now
        </button>
        <button
          type="button"
          className={hudButtonClass("primary")}
          disabled={pending || picked === null}
          title={target ? `${row.name} on ${target.name}` : undefined}
          onClick={() => picked && void send({ kind: "use", tokenId: picked })}
        >
          {row.name}
          {cost ? ` · ${cost}` : ""}
        </button>
      </div>
      {error ? (
        <p role="alert" className="hud-res-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
