"use client";

import "./riders.css";

import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { DiceTiles } from "@/components/party/dice/parts";
import type { RollRecord } from "@/lib/domain/duality";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Stepper } from "../roll-controls";

/**
 * The Attack bar's riders (plan sheet-drawer SD5; docs/tasks/TASK-SD-SD5.md): one toggle per rider of the character's
 * loadout cards and features that rides on the chosen weapon's attack (Rage Up, Hold Them Off, Kick...), with its cost,
 * when it applies and what it asks (a number, an option, a situation to confirm, extra targets). Automatic riders (Sneak
 * Attack from positions, First Strike...) are not listed: the server applies them. And the after-roll step (Q1): the held
 * roll, Hit / Miss per target, and Use / Pass (the GM: Resolve now).
 */

export type RiderOption = FunctionReturnType<typeof api.combatActions.riders>[number];

/** What the player set for one rider. */
export type RiderPick = { on: boolean; numbers: Record<string, number>; options: Record<string, string>; situations: string[]; extra: string[] };

export type RiderPicks = Record<string, RiderPick>;

/** A rider's key in the picks: source, id and use. */
export const riderKey = (o: Pick<RiderOption, "source" | "id" | "useId">) => `${o.source}|${o.id}|${o.useId}`;

const EMPTY: RiderPick = { on: false, numbers: {}, options: {}, situations: [], extra: [] };

/** A rider's picks; a default-on rider (Rise to the Challenge, DA2) starts on. */
export function pickOf(picks: RiderPicks, o: RiderOption): RiderPick {
  return picks[riderKey(o)] ?? (o.defaultOn ? { ...EMPTY, on: true } : EMPTY);
}

/**
 * DA2 (CB p.48 Rise to the Challenge, user 2026-10-30): the d20 Hope Die is on by default while it applies; `false` when
 * the player switched a default-on rider off (fishing for a critical), else undefined (the server's default: on).
 */
export function riseToSend(options: readonly RiderOption[], picks: RiderPicks): false | undefined {
  return options.some((o) => o.defaultOn && !pickOf(picks, o).on) ? false : undefined;
}

/** The most extra targets a rider allows with these picks (Surrounded: as many as the Hope picked). */
export function extraMax(o: RiderOption, pick: RiderPick): number {
  if (o.addTargets === null) return 0;
  if (o.addTargets.max !== null) return o.addTargets.max;
  const first = o.numbers[0];
  return first ? (pick.numbers[first.id] ?? first.min) : 0;
}

/**
 * The `riders` argument of `combatActions.attack` for the toggled riders (only ready ones): numbers (`n:`), options
 * (`opt:`), confirmed situations and the extra targets (`picked`, at most `extraMax`).
 */
export function ridersToSend(options: readonly RiderOption[], picks: RiderPicks): { source: "card" | "feature"; id: string; useId: string; choices: { id: string; value: number | string | string[] }[] }[] {
  return options.flatMap((o) => {
    const pick = pickOf(picks, o);
    // A default-on rider is applied by the server; only switching it off is sent (`riseToSend`).
    if (!pick.on || !o.ready || o.defaultOn) return [];
    const choices: { id: string; value: number | string | string[] }[] = [];
    for (const n of o.numbers) choices.push({ id: n.id, value: pick.numbers[n.id] ?? n.min });
    for (const opt of o.options) {
      const value = pick.options[opt.id];
      if (value !== undefined) choices.push({ id: opt.id, value: [value] });
    }
    if (pick.situations.length > 0) choices.push({ id: "situations", value: pick.situations.filter((s) => o.situations.includes(s)) });
    if (o.addTargets !== null && pick.extra.length > 0) choices.push({ id: "picked", value: pick.extra.slice(0, extraMax(o, pick)) });
    return [{ source: o.source, id: o.id, useId: o.useId, choices }];
  });
}

/** What a toggled rider still needs before the attack (an unanswered option), or null. */
export function riderProblem(options: readonly RiderOption[], picks: RiderPicks): string | null {
  for (const o of options) {
    const pick = pickOf(picks, o);
    if (!pick.on || !o.ready) continue;
    const missing = o.options.find((opt) => pick.options[opt.id] === undefined);
    if (missing) return `${o.name}: ${missing.label}`;
  }
  return null;
}

/** The rider toggles. `enemies`: the visible enemies other than the attack's target (for extra targets). */
export function RiderToggles({ options, picks, onChange, enemies }: { options: readonly RiderOption[]; picks: RiderPicks; onChange: (next: RiderPicks) => void; enemies: readonly { _id: Id<"combatTokens">; name: string }[] }) {
  if (options.length === 0) return null;
  const set = (o: RiderOption, patch: Partial<RiderPick>) => onChange({ ...picks, [riderKey(o)]: { ...pickOf(picks, o), ...patch } });
  return (
    <fieldset className="cma-riders" data-testid="combat-riders">
      <legend className="cm-lbl">With this attack</legend>
      <ul className="cma-rider-list">
        {options.map((o) => {
          const key = riderKey(o);
          const pick = pickOf(picks, o);
          const id = `rider-${key.replace(/[^a-z0-9]/gi, "-")}`;
          const meta = [o.when, ...o.costs, ...(o.limit ? [o.limit] : [])].join(" · ");
          return (
            <li key={key} className="cma-rider" data-ready={o.ready}>
              <label className="cma-rider-toggle" htmlFor={id}>
                <input id={id} type="checkbox" checked={pick.on && o.ready} disabled={!o.ready} onChange={(e) => set(o, { on: e.target.checked })} />
                <span className="cma-rider-name">{o.name}</span>
                <span className="cm-muted cma-small">{o.ready ? (o.defaultOn ? `${meta} · On while it applies; untick to roll the usual d12` : meta) : `Used · ${o.resetLabel ?? "comes back later"}`}</span>
              </label>
              {pick.on && o.ready ? (
                <div className="cma-rider-body">
                  {o.numbers.map((n) => {
                    const value = pick.numbers[n.id] ?? n.min;
                    return <Stepper key={n.id} label={n.label} value={value} min={n.min} max={n.max ?? 12} text={String(value)} onChange={(v) => set(o, { numbers: { ...pick.numbers, [n.id]: v } })} />;
                  })}
                  {o.options.map((opt) => (
                    <label key={opt.id} className="cma-field">
                      <span className="cm-lbl">{opt.label}</span>
                      <select className="cm-in cma-select" value={pick.options[opt.id] ?? ""} onChange={(e) => set(o, { options: { ...pick.options, [opt.id]: e.target.value } })}>
                        <option value="" disabled>
                          Pick one
                        </option>
                        {opt.options.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {o.situations.map((text) => (
                    <label key={text} className="cma-rider-toggle">
                      <input type="checkbox" checked={pick.situations.includes(text)} onChange={(e) => set(o, { situations: e.target.checked ? [...pick.situations, text] : pick.situations.filter((s) => s !== text) })} />
                      <span>{text}</span>
                    </label>
                  ))}
                  {o.addTargets !== null ? (
                    <div className="cma-chips" role="group" aria-label={`${o.name}: more targets`}>
                      <span className="cm-lbl">
                        More targets (up to {extraMax(o, pick)}, {o.addTargets.range === "weapon" ? "within your weapon's range" : `within ${o.addTargets.range}`})
                      </span>
                      {enemies.length === 0 ? <span className="cm-muted cma-small">No other enemy in sight.</span> : null}
                      {enemies.map((e) => {
                        const chosen = pick.extra.includes(e._id);
                        const full = !chosen && pick.extra.length >= extraMax(o, pick);
                        return (
                          <button key={e._id} type="button" className="cm-chip" aria-pressed={chosen} disabled={full} onClick={() => set(o, { extra: chosen ? pick.extra.filter((x) => x !== e._id) : [...pick.extra, e._id] })}>
                            {e.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** A damage-phase rider prompt (DA2, Death Strike): its name, costs and the creatures it may hit, by name (U1). */
export type RiderPickView = {
  requestId: Id<"combatRequests">;
  name: string;
  costs: readonly string[];
  candidates: readonly { tokenId: Id<"combatTokens">; name: string }[];
};

/**
 * DA2 (HF p.8 Death Strike: "When you deal Severe damage to a creature, you can mark a Stress to force them to mark an
 * additional Hit Point"; user 2026-10-30): Use / Pass, and with several creatures a pick of the ONE it hits. The GM can
 * answer for the player.
 */
export function RiderPickPrompt({ campaignId, view, onDone }: { campaignId: Id<"campaigns">; view: RiderPickView; onDone?: () => void }) {
  const answer = useIntent(api.combatActions.riderPick);
  const [chosen, setChosen] = useState<Id<"combatTokens"> | null>(view.candidates.length === 1 ? view.candidates[0]!.tokenId : null);
  async function send(choice: { kind: "use"; tokenId: Id<"combatTokens"> } | { kind: "pass" }) {
    const out = await answer.fire({ campaignId, requestId: view.requestId, choice });
    if (out) onDone?.();
  }
  const several = view.candidates.length > 1;
  return (
    <section className="cma-afterroll" aria-label={view.name} data-testid="combat-rider-pick">
      <p className="m-0">
        <strong>{view.name}</strong>
        {view.costs.length > 0 ? ` · ${view.costs.join(", ")}` : ""}
        {several ? ": pick one creature" : `: ${view.candidates[0]?.name ?? "the target"}`}
      </p>
      {several ? (
        <div className="cma-chips" role="group" aria-label={`${view.name}: pick one`}>
          {view.candidates.map((c) => (
            <button key={c.tokenId} type="button" className="cm-chip cma-pick-chip" aria-pressed={chosen === c.tokenId} onClick={() => setChosen(c.tokenId)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="cma-row cma-afterroll-actions">
        <button type="button" className="cm-go" disabled={answer.pending || chosen === null} onClick={() => chosen && void send({ kind: "use", tokenId: chosen })}>
          Use {view.name}
        </button>
        <button type="button" className="cm-btn" disabled={answer.pending} onClick={() => void send({ kind: "pass" })}>
          Pass
        </button>
      </div>
      <p aria-live="polite" className="cma-error">
        {answer.error}
      </p>
    </section>
  );
}

/** A held roll as the prompt shows it: the attacker's own dice, Hit / Miss per target and the features on offer (U1). */
export type HeldRoll = {
  requestId: Id<"combatRequests">;
  roll: RollRecord;
  targets: readonly { tokenId: string; name: string; hit: boolean }[];
  options: readonly { featureId: string; useId: string; name: string; costs: readonly string[] }[];
};

export type AfterRollResult = FunctionReturnType<typeof api.combatActions.afterRoll>;

/**
 * Q1 (CB p.107, "Using Features After a Roll"): "you use it after the GM declares if the roll succeeds or fails, but before
 * the narrative consequences unfold (such as damage being rolled)". The held roll with Use per feature and Pass; the GM
 * (`gm`) answers for the player with Resolve now.
 */
export function AfterRollPrompt({ campaignId, held, gm, onDone }: { campaignId: Id<"campaigns">; held: HeldRoll; gm: boolean; onDone?: (result: AfterRollResult) => void }) {
  const answer = useIntent(api.combatActions.afterRoll);
  async function send(choice: { kind: "use"; featureId: string; useId: string; choices: [] } | { kind: "pass" }) {
    const out = await answer.fire({ campaignId, requestId: held.requestId, choice });
    if (out) onDone?.(out);
  }
  return (
    <section className="cma-afterroll" aria-label="After the roll" data-testid="combat-after-roll">
      <div className="cma-result-row">
        <DiceTiles roll={held.roll} />
        <div className="cma-result-main">
          <span className="cma-total">{held.roll.total}</span>
          <span className="cma-result-text">
            <span className="cm-muted cma-small">Your roll waits: use a feature before the damage, or pass.</span>
          </span>
        </div>
      </div>
      <ul className="cma-verdicts" aria-label="Targets">
        {held.targets.map((t) => (
          <li key={t.tokenId} className="cma-verdict" data-verdict={t.hit ? "hit" : "miss"} data-testid="combat-verdict">
            <span>{t.name}</span>
            <strong>{t.hit ? "Hit" : "Miss"}</strong>
          </li>
        ))}
      </ul>
      <div className="cma-row cma-afterroll-actions">
        {held.options.map((o) => (
          <button key={`${o.featureId}|${o.useId}`} type="button" className="cm-go" disabled={answer.pending} onClick={() => void send({ kind: "use", featureId: o.featureId, useId: o.useId, choices: [] })}>
            Use {o.name}
            {o.costs.length > 0 ? ` · ${o.costs.join(", ")}` : ""}
          </button>
        ))}
        <button type="button" className="cm-btn" disabled={answer.pending} onClick={() => void send({ kind: "pass" })}>
          {gm ? "Resolve now" : "Pass"}
        </button>
      </div>
      <p aria-live="polite" className="cma-error">
        {answer.error}
      </p>
    </section>
  );
}
