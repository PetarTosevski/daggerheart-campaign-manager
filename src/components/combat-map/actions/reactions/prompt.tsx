"use client";

import "./reactions.css";

import { useMutation, useQuery } from "convex/react";
import { Component, useState, type CSSProperties, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { DOMAINS } from "@/lib/srd/domains";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  afterAnswer,
  armorCounts,
  armorQuestion,
  damageLine,
  defaultPicks,
  featureChoice,
  hitLine,
  playableCards,
  promptMode,
  reactionCard,
  situationsConfirmed,
  stepFor,
  stepText,
  type FeaturePicks,
  type FeatureView,
  type HitChoice,
  type HitView,
} from "./model";

/**
 * The incoming-hit prompt (plan combat-actions AA4), shared by the Combat Map and the character sheet. One card per
 * open hit on (or near) the character, from `adversaryActions.pending`:
 * - the hit PC: "14 damage: Major (2 HP). Mark an Armor Slot to make it Minor?" with Mark / Don't (CB p.114), a count
 *   to mark under I Am Your Shield (CB p.341), OK only for direct damage or no free slot (CB p.99); their own
 *   reaction cards (Shrug It Off, Unyielding Armor) with Use before the armor answer;
 * - an ally with an eligible reaction card: "Bandit hit Mira", the card with Use, and Pass;
 * - nothing owed: the one line "Bandit hit Mira" (Q14).
 * Plan sheet-drawer SD4: the features that may answer now (Iron Will, Increased Fortitude, Partners-in-Arms, Not This
 * Time, …) are listed with the cards, each with what its Use asks (a count, a pick, an optional step); after the armor
 * answer every card or feature that still fits (DA8, user 2026-10-30, CB p.107: Thick Skin on a hit the slot made
 * Minor, Increased Fortitude, Dark Aegis) waits with Use / Done; Stable and Celestial Wings stand for the Armor Slot;
 * before an adversary's roll (Q2) a PC with a before-roll defence gets "Bandit attacks Mira" with Use / Pass (Draining
 * Bane's "Clear a Stress" ticked by default).
 * Each tap calls `adversaryActions.respond` once, with an optimistic update on `pending` (CL4).
 */

export type PromptVariant = "map" | "sheet";

/** Waits before each quiet retry of a failed prompt load (followups-7 H3): 3 retries, then "Try again". */
export const HIT_RETRY_DELAYS_MS = [500, 1500, 4000] as const;
/** A retried prompt that stays up this long has recovered: the next failure starts the retries afresh. */
export const HIT_RETRY_STABLE_MS = 10_000;

/**
 * Keeps a failing `pending` read (rule 11) from taking the page down. A failed load (a transient error would otherwise
 * hide an owed prompt) is retried by itself a few times with backoff, showing nothing meanwhile (user answer,
 * TASK-CA-AA5 Q5); only then "Try again", which remounts it with fresh retries.
 */
export class HitBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempts: number }> {
  state = { failed: false, attempts: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("The incoming hit failed to load", error);
    this.clearTimer();
    const delay = HIT_RETRY_DELAYS_MS[this.state.attempts];
    if (delay === undefined) return;
    this.timer = setTimeout(() => {
      this.setState((s) => ({ failed: false, attempts: s.attempts + 1 }));
      // No new failure for a while: recovered, so the retries start afresh next time.
      this.timer = setTimeout(() => {
        this.timer = null;
        this.setState({ attempts: 0 });
      }, HIT_RETRY_STABLE_MS);
    }, delay);
  }

  componentWillUnmount() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Retrying quietly.
    if (this.state.attempts < HIT_RETRY_DELAYS_MS.length) return null;
    return (
      <div role="alert" className="ih-alert">
        <span>The incoming hit failed to load.</span>
        <button type="button" className="ih-btn" onClick={() => this.setState({ failed: false, attempts: 0 })}>
          Try again
        </button>
      </div>
    );
  }
}

/** `respond` with one idempotency key per tap and the optimistic `pending` (rule 12). */
function useRespond(campaignId: Id<"campaigns">) {
  const run = useMutation(api.adversaryActions.respond).withOptimisticUpdate((store, args) => {
    const query = { campaignId, characterId: args.characterId };
    const views = store.getQuery(api.adversaryActions.pending, query);
    if (views === undefined) return;
    store.setQuery(api.adversaryActions.pending, query, afterAnswer(views, args.requestId, args.choice));
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ requestId: string; message: string } | null>(null);

  async function answer(view: HitView, characterId: Id<"characters">, choice: HitChoice) {
    setError(null);
    setBusy(view.requestId);
    try {
      const res = await run({ campaignId, requestId: view.requestId, characterId, choice, idempotencyKey: crypto.randomUUID() });
      if (res.status === "declined") setError({ requestId: view.requestId, message: "This hit was called off." });
    } catch (e) {
      setError({ requestId: view.requestId, message: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return { answer, busy, error };
}

/**
 * The open hits of one character (its player or the GM: `pending` needs edit on it). `characterName` labels the
 * prompt for a player with several characters. Renders nothing while loading or with nothing open.
 */
export function PendingHits({
  campaignId,
  characterId,
  characterName,
  variant,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  characterName: string;
  variant: PromptVariant;
}) {
  const views = useQuery(api.adversaryActions.pending, { campaignId, characterId });
  const respond = useRespond(campaignId);
  if (views === undefined || views.length === 0) return null;
  const owed = views.filter((v) => v.awaiting);
  const waiting = views.filter((v) => !v.awaiting);
  return (
    <div className="ih-wrap" data-variant={variant}>
      {owed.length > 0 ? (
        // At phone width on the map, owed prompts dock as a bottom sheet over the actions bar (Q11).
        <div className="ih-dock" data-testid="incoming-hit-dock">
          {owed.map((view) => (
            <HitCard
              key={view.requestId}
              view={view}
              characterName={characterName}
              busy={respond.busy === view.requestId}
              error={respond.error?.requestId === view.requestId ? respond.error.message : null}
              onAnswer={(choice) => void respond.answer(view, characterId, choice)}
            />
          ))}
        </div>
      ) : null}
      {waiting.map((view) => (
        <p key={view.requestId} role="status" className="ih-line" data-testid="incoming-hit-line">
          <strong>{hitLine(view)}</strong> · waiting for the others
        </p>
      ))}
    </div>
  );
}

function HitCard({
  view,
  characterName,
  busy,
  error,
  onAnswer,
}: {
  view: HitView;
  characterName: string;
  busy: boolean;
  error: string | null;
  onAnswer: (choice: HitChoice) => void;
}) {
  const mode = promptMode(view);
  const target = view.role === "target";
  // DA8: after the armor answer the cards that still fit stay too (the server lists only those, CB p.107).
  const cards = mode === "preRoll" ? [] : playableCards(view);
  const features = view.features ?? [];
  const title = mode === "preRoll" ? `${view.attackerLabel} attacks ${view.targetName}` : target ? `${view.attackerLabel} hit ${characterName}` : hitLine(view);
  const label = mode === "preRoll" ? "Before the roll" : target ? "You were hit" : `${characterName} can react`;
  return (
    <section className="ih-card" aria-label={`${mode === "preRoll" ? "Before the roll" : "Incoming hit"}: ${title}`} data-testid="incoming-hit" data-role={view.role} data-mode={mode}>
      <p className="ih-lbl">{label}</p>
      <h2 className="ih-h">{title}</h2>
      {target && mode !== "preRoll" ? (
        <>
          <p className="ih-dmg">{damageLine(view)}</p>
          <p className="ih-q">{mode === "afterArmor" ? "Armor answered. Use another reaction that fits now, in any order, or Done." : armorQuestion(view)}</p>
        </>
      ) : null}
      {features.length > 0 ? (
        <ul className="ih-cards" aria-label="Reaction features">
          {features.map((f) => (
            <FeatureItem key={f.featureId} feature={f} disabled={busy} onUse={(picks) => onAnswer(featureChoice(f, picks))} />
          ))}
        </ul>
      ) : null}
      {cards.length > 0 ? (
        <ul className="ih-cards" aria-label="Reaction cards">
          {cards.map((cardId) => (
            <ReactionCardItem key={cardId} cardId={cardId} disabled={busy} onUse={() => onAnswer({ kind: "card", cardId })} />
          ))}
        </ul>
      ) : null}
      <div className="ih-actions">
        {mode === "armorOne" ? (
          <>
            <button type="button" className="ih-btn ih-go" disabled={busy} onClick={() => onAnswer({ kind: "armor", slots: 1 })}>
              Mark
            </button>
            <button type="button" className="ih-btn" disabled={busy} onClick={() => onAnswer({ kind: "noArmor" })}>
              Don&apos;t
            </button>
          </>
        ) : null}
        {mode === "armorMany" ? <ArmorCounts view={view} busy={busy} onAnswer={onAnswer} /> : null}
        {mode === "ok" ? (
          <button type="button" className="ih-btn ih-go" disabled={busy} onClick={() => onAnswer({ kind: "noArmor" })}>
            OK
          </button>
        ) : null}
        {mode === "ally" || mode === "preRoll" ? (
          <button type="button" className="ih-btn" disabled={busy} onClick={() => onAnswer({ kind: "pass" })}>
            Pass
          </button>
        ) : null}
        {mode === "afterArmor" ? (
          <button type="button" className="ih-btn ih-go" disabled={busy} onClick={() => onAnswer({ kind: "pass" })}>
            Done
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="ih-err">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Under I Am Your Shield: one button per count, each with what it leaves ("Mark 2 · Minor (1 HP)"). */
function ArmorCounts({ view, busy, onAnswer }: { view: HitView; busy: boolean; onAnswer: (choice: HitChoice) => void }) {
  // E2 (dcm-s77): only the counts that buy a step (the server's preview).
  const counts = armorCounts(view);
  const none = stepFor(view, 0);
  return (
    <>
      {counts.map((n) => {
        const step = stepFor(view, n);
        return (
          <button key={n} type="button" className="ih-btn ih-go"
            disabled={busy}
            aria-label={step ? `Mark ${n}: ${stepText(step)}` : `Mark ${n}`}
            onClick={() => onAnswer({ kind: "armor", slots: n })}
          >
            <span>
              Mark {n}
              {step ? <span className="ih-step"> · {stepText(step)}</span> : null}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className="ih-btn"
        disabled={busy}
        aria-label={none ? `Don't: ${stepText(none)}` : "Don't"}
        onClick={() => onAnswer({ kind: "noArmor" })}
      >
        <span>
          Don&apos;t
          {none ? <span className="ih-step"> · {stepText(none)}</span> : null}
        </span>
      </button>
    </>
  );
}

function ReactionCardItem({ cardId, disabled, onUse }: { cardId: string; disabled: boolean; onUse: () => void }) {
  const card = reactionCard(cardId);
  const domain = DOMAINS.find((d) => d.id === card.domain);
  return (
    <li className="ih-rc" style={{ "--dc": domain?.color ?? "#5b2b2b" } as CSSProperties} data-testid="incoming-hit-card">
      <div className="ih-rc-head">
        <h3 className="ih-rc-name">{card.name}</h3>
        <span className="ih-rc-meta">
          {domain?.name ?? card.domain} {card.level > 0 ? card.level : ""}
        </span>
      </div>
      {card.text ? <p className="ih-rc-text">{card.text}</p> : null}
      <button type="button" className="ih-btn ih-go" disabled={disabled} onClick={onUse} aria-label={`Use ${card.name}`}>
        Use
      </button>
    </li>
  );
}

/**
 * SD4: one feature answer: its name and text, and what its Use asks (a count such as Prayer Dice to spend, a pick such as
 * Not This Time's attack or damage, an optional step, a situation to confirm, Q13). Use sends it with those picks.
 */
function FeatureItem({ feature, disabled, onUse }: { feature: FeatureView; disabled: boolean; onUse: (picks: FeaturePicks) => void }) {
  const [picks, setPicks] = useState<FeaturePicks>(() => defaultPicks(feature));
  const ready = situationsConfirmed(feature, picks);
  return (
    <li className="ih-rc ih-feat" data-testid="incoming-hit-feature">
      <div className="ih-rc-head">
        <h3 className="ih-rc-name">{feature.name}</h3>
        <span className="ih-rc-meta">Feature</span>
      </div>
      {feature.text ? <p className="ih-rc-text">{feature.text}</p> : null}
      {feature.numbers.map((n) => (
        <label key={n.id} className="ih-pick">
          <span>{n.label}</span>
          <input
            type="number"
            min={Math.max(1, n.min)}
            value={picks.numbers[n.id] ?? Math.max(1, n.min)}
            onChange={(e) => setPicks((p) => ({ ...p, numbers: { ...p.numbers, [n.id]: Math.max(Math.max(1, n.min), Math.trunc(Number(e.target.value) || 0)) } }))}
          />
        </label>
      ))}
      {feature.options.map((o) => (
        <fieldset key={o.id} className="ih-pick">
          <legend>{o.label}</legend>
          {o.options.map((opt) => (
            <label key={opt.id}>
              <input type="radio" name={`${feature.featureId}:${o.id}`} checked={picks.options[o.id] === opt.id} onChange={() => setPicks((p) => ({ ...p, options: { ...p.options, [o.id]: opt.id } }))} />
              {opt.label}
            </label>
          ))}
        </fieldset>
      ))}
      {feature.optionals.map((o) => (
        <label key={o.id} className="ih-pick">
          <input type="checkbox" checked={picks.optionals[o.id] === true} onChange={(e) => setPicks((p) => ({ ...p, optionals: { ...p.optionals, [o.id]: e.target.checked } }))} />
          {o.label}
        </label>
      ))}
      {feature.situations.map((text) => (
        <label key={text} className="ih-pick">
          <input type="checkbox" checked={picks.situations[text] === true} onChange={(e) => setPicks((p) => ({ ...p, situations: { ...p.situations, [text]: e.target.checked } }))} />
          {text}
        </label>
      ))}
      <button type="button" className="ih-btn ih-go" disabled={disabled || !ready} onClick={() => onUse(picks)} aria-label={`Use ${feature.name}`}>
        Use
      </button>
    </li>
  );
}
