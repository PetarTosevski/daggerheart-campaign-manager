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
  armorQuestion,
  damageLine,
  hitLine,
  playableCards,
  promptMode,
  reactionCard,
  stepFor,
  stepText,
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
 * Each tap calls `adversaryActions.respond` once, with an optimistic update on `pending` (CL4).
 */

export type PromptVariant = "map" | "sheet";

/** Keeps a failing `pending` read (rule 11) from taking the page down; "Try again" remounts it. */
export class HitBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="ih-alert">
        <span>The incoming hit failed to load.</span>
        <button type="button" className="ih-btn" onClick={() => this.setState({ failed: false })}>
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
  const cards = playableCards(view);
  const title = target ? `${view.attackerLabel} hit ${characterName}` : hitLine(view);
  return (
    <section className="ih-card" aria-label={`Incoming hit: ${title}`} data-testid="incoming-hit" data-role={view.role}>
      <p className="ih-lbl">{target ? "You were hit" : `${characterName} can react`}</p>
      <h2 className="ih-h">{title}</h2>
      {target ? (
        <>
          <p className="ih-dmg">{damageLine(view)}</p>
          <p className="ih-q">{armorQuestion(view)}</p>
        </>
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
        {mode === "ally" ? (
          <button type="button" className="ih-btn" disabled={busy} onClick={() => onAnswer({ kind: "pass" })}>
            Pass
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
  const max = view.maxSlots ?? 0;
  const counts = Array.from({ length: max }, (_, i) => i + 1);
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
