"use client";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";

import { refusalFor, refusalForCode, type Refusal } from "@/lib/errors/refusals";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { RefusalMessage, hudToasts } from "../blocked";
import { Popup, Stepper, WaitingDots, hudButtonClass, type HudButtonRole } from "../ui";
import {
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  DIFFICULTY_START,
  cloakSub,
  difficultyReason,
  difficultyRoll,
  gmPromptSub,
  isAlreadyAnswered,
  itemLabel,
  outOfRangeReason,
  sanctionUse,
  targetsText,
  windowHit,
  windowSub,
  windowWaiting,
  type QueueItem,
} from "./model";

/**
 * One CmpPromptsGM card per queue item (plan combat-hud H5.1; `.pc.gm`): the HUD's `Popup` on the GM tone, the board's
 * titles and button words, and the existing keyed mutation behind each answer (with an optimistic update that drops the
 * card). `useQueueAnswers` keeps what the queue shows around the cards: which card is busy, a card's own refusal and the
 * last answer's result line.
 *
 * Refusals (H6.3, H6.1's table): a request someone else answered first (REQUEST_NOT_OPEN, or DEATH_MOVE_NOT_WAITING)
 * is CmpBlocked's STALE_REQUEST: the neutral toast "Already answered · Someone already answered this." near the hand,
 * and the card drops out (its optimistic update, then the live reads refresh). Any other refusal shows under its card
 * in the table's words (`RefusalMessage`), or as a toast when the table places it there.
 */

type CampaignId = Id<"campaigns">;
type RequestId = Id<"combatRequests">;

/** A card's own message: the queue's note (a string) or a refusal from the table. */
export type CardNote = string | Refusal;

/** What an answer reports: a result line for the queue, or a note that keeps the card (a card that needs a choice). */
type AnswerOutcome = { line?: string; keep?: string } | null;

export type QueueAnswers = ReturnType<typeof useQueueAnswers>;

const NEEDS_CHOICE = "This use needs a choice the player makes: decline it and ask them to use it again.";

export function useQueueAnswers(campaignId: CampaignId) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, CardNote>>>({});
  const [result, setResult] = useState<string | null>(null);

  const drop = <T extends { requestId: string }>(rows: readonly T[], id: string) => rows.filter((r) => r.requestId !== id);
  const attack = useMutation(api.combatRequests.sanction).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.combatRequestsReads.mine, { campaignId });
    if (rows !== undefined) store.setQuery(api.combatRequestsReads.mine, { campaignId }, drop(rows, requestId));
  });
  const card = useMutation(api.combatCards.sanction).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.combatCardsReads.pending, { campaignId });
    if (rows !== undefined) store.setQuery(api.combatCardsReads.pending, { campaignId }, drop(rows, requestId));
  });
  const feature = useMutation(api.combatFeatures.sanction).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.combatFeaturesReads.pending, { campaignId });
    if (rows !== undefined) store.setQuery(api.combatFeaturesReads.pending, { campaignId }, drop(rows, requestId));
  });
  const difficulty = useMutation(api.featurePrompts.answerDifficulty).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.combatRequestsReads.difficulties, { campaignId });
    if (rows !== undefined) store.setQuery(api.combatRequestsReads.difficulties, { campaignId }, drop(rows, requestId));
  });
  const resolve = useMutation(api.adversaryActions.resolve).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.adversaryActionsReads.windows, { campaignId });
    if (rows !== undefined) store.setQuery(api.adversaryActionsReads.windows, { campaignId }, drop(rows, requestId));
  });
  const cloak = useMutation(api.cloakPrompts.answer).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.cloakPromptsReads.pending, { campaignId });
    if (rows !== undefined) store.setQuery(api.cloakPromptsReads.pending, { campaignId }, drop(rows, requestId));
  });
  const keyword = useMutation(api.hitKeywords.answer).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.hitKeywordsReads.asks, { campaignId });
    if (rows !== undefined) store.setQuery(api.hitKeywordsReads.asks, { campaignId }, drop(rows, requestId));
  });
  const cancelAlly = useMutation(api.featurePrompts.cancelAllyRoll).withOptimisticUpdate((store, { requestId }) => {
    for (const q of store.getAllQueries(api.featurePromptsReads.allyRolls)) {
      if (q.value === undefined) continue;
      store.setQuery(api.featurePromptsReads.allyRolls, q.args, { ...q.value, asks: drop(q.value.asks, requestId), waiting: drop(q.value.waiting, requestId), pending: drop(q.value.pending, requestId) });
    }
  });

  const gmPrompt = useMutation(api.adversaryPrompts.answer).withOptimisticUpdate((store, { requestId }) => {
    const rows = store.getQuery(api.adversaryPromptsReads.pending, { campaignId });
    if (rows !== undefined) store.setQuery(api.adversaryPromptsReads.pending, { campaignId }, drop(rows, requestId));
  });

  async function run(item: QueueItem, send: (key: { campaignId: CampaignId; requestId: RequestId; idempotencyKey: string }) => Promise<AnswerOutcome>) {
    const { key } = item;
    setBusy((b) => new Set(b).add(key));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)));
    setResult(null);
    try {
      const out = await send({ campaignId, requestId: item.row.requestId as RequestId, idempotencyKey: crypto.randomUUID() });
      if (out?.keep) setErrors((e) => ({ ...e, [key]: out.keep! }));
      else if (out?.line) setResult(out.line);
    } catch (error) {
      // Both "already answered" codes read as the table's STALE_REQUEST row (the death move's has no row of its own).
      const refusal = isAlreadyAnswered(error) ? refusalForCode("REQUEST_NOT_OPEN", { viewer: "gm" }) : refusalFor(error, { viewer: "gm" });
      if (refusal.place === "toast") hudToasts.refusal(refusal);
      else setErrors((e) => ({ ...e, [key]: refusal }));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(key);
        return next;
      });
    }
  }

  return {
    busy,
    errors,
    result,
    /** Allow / Decline an out-of-range use (an attack, a card or a feature). */
    sanction: (item: Extract<QueueItem, { kind: "attack" | "card" | "feature" }>, approve: boolean) =>
      run(item, async (k) => {
        const who = itemLabel(item);
        const out = item.kind === "attack" ? await attack({ ...k, approve }) : item.kind === "card" ? await card({ ...k, approve }) : await feature({ ...k, approve });
        if (out.status === "needsChoice") return { keep: NEEDS_CHOICE };
        return { line: out.status === "declined" ? `Declined: ${who}.` : `Allowed: ${who}.` };
      }),
    difficulty: (item: Extract<QueueItem, { kind: "difficulty" }>, value: number | null) =>
      run(item, async (k) => {
        const out = await difficulty({ ...k, difficulty: value });
        const name = item.row.characterName;
        switch (out.status) {
          case "declined":
            return { line: `Declined: ${name}’s ${difficultyRoll(item.row)}.` };
          case "stale":
            return { line: "The move no longer stands: nothing rolled." };
          case "rolled":
            return { line: out.cloaked ? `${name}’s Finesse Roll succeeded: stays Cloaked.` : `${name}’s Finesse Roll failed: no longer Cloaked.` };
          case "charged":
            return { line: `${name} ${out.use.roll ? `rolled ${out.use.roll.total}` : "rolled"}: ${out.moved ? "charged into Melee." : "the Agility Roll failed, the token stays."}` };
        }
      }),
    resolve: (item: Extract<QueueItem, { kind: "reactions" }>) =>
      run(item, async (k) => {
        const out = await resolve(k);
        return { line: out.status === "declined" ? "The hit no longer stands: nothing applied." : `Resolved: ${windowSub(item.row)}.` };
      }),
    cloak: (item: Extract<QueueItem, { kind: "cloak" }>, ends: boolean) =>
      run(item, async (k) => {
        const out = await cloak({ ...k, ends });
        const name = item.row.characterName;
        return { line: out.status === "ended" ? `${name} is no longer Cloaked.` : out.status === "declined" ? `${name} stays Cloaked.` : "The use no longer stands: nothing changed." };
      }),
    keyword: (item: Extract<QueueItem, { kind: "keyword" }>, carries: boolean) =>
      run(item, async (k) => {
        await keyword({ ...k, answer: { keyword: item.row.keyword, carries } });
        return { line: carries ? `${item.row.targetName}’s ${item.row.guard} applies.` : `Not ${item.row.keyword}: the hit stands as it is.` };
      }),
    cancelAllyRoll: (item: Extract<QueueItem, { kind: "allyRoll" }>) =>
      run(item, async (k) => {
        await cancelAlly(k);
        return { line: `Cancelled: ${item.row.rollerName}’s roll for ${item.row.featureName}.` };
      }),
    /** dcm-bxp.99.32.27: an adversary feature's GM prompt, applied by hand (Done) or dismissed. */
    gmPrompt: (item: Extract<QueueItem, { kind: "gmPrompt" }>, done: boolean) =>
      run(item, async ({ requestId, idempotencyKey }) => {
        await gmPrompt({ campaignId, requestId, done, idempotencyKey });
        return { line: `${done ? "Done" : "Dismissed"}: ${item.row.instanceLabel} · ${item.row.feature}.` };
      }),
  };
}

// ---------------------------------------------------------------- icons (16 px, the GM tone's lilac circle)

const ICON = {
  range: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" strokeDasharray="2.5 2" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  difficulty: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" />
      <path d="M8 5.5v5M5.5 8h5" strokeLinecap="round" />
    </svg>
  ),
  reactions: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5 13.5 4v4c0 3.2-2.4 5.6-5.5 6.5C4.9 13.6 2.5 11.2 2.5 8V4z" opacity=".9" />
    </svg>
  ),
  cloak: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <path d="M3 13 13 3" />
    </svg>
  ),
  fire: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
    </svg>
  ),
  feature: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 12h12l-1-7-3 3-2-5-2 5-3-3z" />
    </svg>
  ),
  ally: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="5" r="2.2" />
      <circle cx="11" cy="6" r="1.8" />
      <path d="M1.5 13c.4-2.6 2-4 4-4s3.6 1.4 4 4zM9.6 13c-.1-1.3-.6-2.4-1.3-3.2.8-.6 1.7-.8 2.7-.8 1.7 0 3 1.2 3.3 4z" />
    </svg>
  ),
} as const;

// ---------------------------------------------------------------- the cards

/**
 * A card's secondary button, left of the primary (CmpPromptsGM `.pc-f`). `role` per the Arcane Glass rule (user design):
 * the GM's answer to a player's request is Allow in Hope gold (primary `role: "allow"`) and Decline in Fear purple
 * (`"deny"`), Decline on the left; "Cancel the roll" is `"cancel"`; the rest stay neutral.
 */
function no(label: string, onClick: () => void, disabled: boolean, ariaLabel?: string, role: HudButtonRole = "secondary"): ReactNode {
  return (
    <button type="button" className={hudButtonClass(role)} disabled={disabled} aria-label={ariaLabel} onClick={onClick}>
      {label}
    </button>
  );
}

function CardError({ text }: { text: CardNote | undefined }) {
  if (text === undefined) return null;
  if (typeof text !== "string") return <RefusalMessage refusal={text} className="hud-q-inl" />;
  return (
    <p role="alert" className="hud-q-err">
      {text}
    </p>
  );
}

export function QueueCard({ item, answers }: { item: QueueItem; answers: QueueAnswers }) {
  const busy = answers.busy.has(item.key);
  const error = answers.errors[item.key];
  const label = itemLabel(item);
  switch (item.kind) {
    case "attack":
    case "card":
    case "feature": {
      const use = sanctionUse(item);
      return (
        <Popup
          icon={ICON.range}
          tone="gm"
          title="Out of range: your call"
          sub={`${item.row.characterName} · ${use} on ${targetsText(item.row.targets, item.row.outOfRange)}`}
          testId="hud-queue-range"
          primary={{ label: "Allow", ariaLabel: `Allow: ${label}`, role: "allow", disabled: busy, onClick: () => void answers.sanction(item, true) }}
          secondary={no("Decline", () => void answers.sanction(item, false), busy, `Decline: ${label}`, "deny")}
        >
          <p>{outOfRangeReason(item.row.targets, item.row.outOfRange)} Nothing is rolled or paid until you decide.</p>
          <CardError text={error} />
        </Popup>
      );
    }
    case "difficulty":
      return <DifficultyCard item={item} answers={answers} busy={busy} error={error} />;
    case "reactions": {
      const hit = windowHit(item.row);
      return (
        <Popup
          icon={ICON.reactions}
          tone="gm"
          title="Reactions"
          sub={windowSub(item.row)}
          testId="hud-queue-reactions"
          primary={{ label: "Resolve now", ariaLabel: `Resolve now: ${label}`, disabled: busy, onClick: () => void answers.resolve(item) }}
        >
          {hit ? <p>{hit}</p> : null}
          <p>
            {windowWaiting(item.row)}
            {item.row.awaiting.length > 0 ? <WaitingDots className="hud-q-dots" /> : null}
          </p>
          <CardError text={error} />
        </Popup>
      );
    }
    case "cloak":
      return (
        <Popup
          icon={ICON.cloak}
          tone="gm"
          title={`Does ${item.row.characterName}’s Cloaked end?`}
          sub={cloakSub(item.row)}
          testId="hud-queue-cloak"
          primary={{ label: "Yes, it ends", ariaLabel: `Yes, Cloaked ends: ${label}`, disabled: busy, onClick: () => void answers.cloak(item, true) }}
          secondary={no("No, it stays", () => void answers.cloak(item, false), busy, `No, stays Cloaked: ${label}`)}
        >
          <p>{item.row.characterName} made a roll against an enemy that was not an attack.</p>
          <CardError text={error} />
        </Popup>
      );
    case "keyword":
      return (
        <Popup
          icon={ICON.fire}
          tone="gm"
          title={item.row.question}
          sub={`${item.row.targetName} is ${item.row.guard} · ${item.row.damageType === "both" ? "physical and magic" : item.row.damageType} damage`}
          testId="hud-queue-keyword"
          primary={{ label: `Yes, it was ${item.row.keyword}`, ariaLabel: `Yes, ${item.row.keyword}: ${label}`, disabled: busy, onClick: () => void answers.keyword(item, true) }}
          secondary={no("No", () => void answers.keyword(item, false), busy, `Not ${item.row.keyword}: ${label}`)}
        >
          <p>
            {item.row.attackerLabel}
            {item.row.feature ? ` (${item.row.feature})` : ""} hit {item.row.targetName} for {item.row.damage}. {item.row.guard} applies only if the hit was{" "}
            {item.row.keyword}.
          </p>
          <CardError text={error} />
        </Popup>
      );
    case "allyRoll":
      return (
        <Popup
          icon={ICON.ally}
          tone="gm"
          title="Ally roll"
          sub={`${item.row.characterName} · ${item.row.featureName}`}
          testId="hud-queue-ally"
          secondary={no("Cancel the roll", () => void answers.cancelAllyRoll(item), busy, `Cancel the roll: ${label}`, "cancel")}
        >
          <p>
            Waiting on {item.row.rollerName} to roll.
            <WaitingDots className="hud-q-dots" />
          </p>
          <CardError text={error} />
        </Popup>
      );
    case "gmPrompt":
      return (
        <Popup
          icon={ICON.feature}
          tone="gm"
          title={item.row.feature}
          sub={gmPromptSub(item.row)}
          testId="hud-queue-gm-prompt"
          primary={{ label: "Done", ariaLabel: `Done: ${label}`, disabled: busy, onClick: () => void answers.gmPrompt(item, true) }}
          secondary={no("Dismiss", () => void answers.gmPrompt(item, false), busy, `Dismiss: ${label}`)}
        >
          <p>{item.row.text}</p>
          <CardError text={error} />
        </Popup>
      );
  }
}

/** "Set the Difficulty": the stepper's value is this card's own until Set and roll sends it. */
function DifficultyCard({ item, answers, busy, error }: { item: Extract<QueueItem, { kind: "difficulty" }>; answers: QueueAnswers; busy: boolean; error: CardNote | undefined }) {
  const [value, setValue] = useState(DIFFICULTY_START);
  const label = itemLabel(item);
  return (
    <Popup
      icon={ICON.difficulty}
      tone="gm"
      title="Set the Difficulty"
      sub={`${item.row.characterName} · ${difficultyRoll(item.row)}`}
      testId="hud-queue-difficulty"
      primary={{ label: "Set and roll", ariaLabel: `Set Difficulty ${value} and roll: ${label}`, role: "allow", disabled: busy, onClick: () => void answers.difficulty(item, value) }}
      secondary={no("Decline", () => void answers.difficulty(item, null), busy, `Decline: ${label}`, "deny")}
    >
      <p>{difficultyReason(item.row)}</p>
      <Stepper value={value} min={DIFFICULTY_MIN} max={DIFFICULTY_MAX} label="Difficulty" disabled={busy} onStep={(d) => setValue((v) => Math.min(DIFFICULTY_MAX, Math.max(DIFFICULTY_MIN, v + d)))} />
      <CardError text={error} />
    </Popup>
  );
}
