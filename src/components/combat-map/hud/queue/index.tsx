"use client";

import "./queue.css";

import { useQueries, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useId, useMemo, useRef, type ReactNode, type RefObject } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { GmDeathConfirm } from "../death/confirm";
import { closePanel, openPanel, openPanelNow, usePanelOpen } from "../panels";
import type { HudPartProps } from "../state";
import { hudToasts } from "../toasts/store";
import { PartBoundary } from "../ui";
import { QueueCard, useQueueAnswers, type QueueAnswers } from "./items";
import { arrivalTitle, deathArrival, newArrivals, queueItems, withdrawalArrival, type Arrival, type QueueItem } from "./model";
import { HudResolutions } from "./resolutions";
import { prefersReducedMotion } from "@/lib/use-reduced-motion";

/**
 * The GM's request queue (plan combat-hud H5.1; boards GMDesktop 'Requests', CmpPromptsGM): "Waiting on you" with a
 * count and one CmpPromptsGM card per thing that waits on the GM, oldest first. A client merge of the reads the classic
 * column uses (no server change):
 *
 * - out of range, your call: `combatRequestsReads.mine` (attack sanctions), `combatCardsReads.pending`, `combatFeaturesReads.pending`
 *   — Allow / Decline (`combatRequests.sanction`, `combatCards.sanction`, `combatFeatures.sanction`);
 * - Set the Difficulty: `combatRequestsReads.difficulties` — Set and roll / Decline (`featurePrompts.answerDifficulty`);
 * - Reactions: `adversaryActionsReads.windows` — Resolve now (`adversaryActions.resolve`);
 * - Does <name>'s Cloaked end?: `cloakPromptsReads.pending` — Yes, it ends / No, it stays (`cloakPrompts.answer`);
 * - Was this hit fire?: `hitKeywordsReads.asks` — Yes / No (`hitKeywords.answer`);
 * - ally rolls: `featurePromptsReads.allyRolls` (the GM's `pending`) — Cancel the roll (`featurePrompts.cancelAllyRoll`);
 * - an adversary feature's GM prompts (summon, countdown, manual, ...): `adversaryPromptsReads.pending` — Done / Dismiss
 *   (`adversaryPrompts.answer`, dcm-bxp.99.32.27);
 * - a per-ally pick nobody answered yet (FH-AP, user 2026-11-05: the GM answers a no-show's pick): `allyPicksReads.open`
 *   — the option chips and Choose (`allyPicks.answer`, the same `AllyPickCard` the player's screen shows);
 * - the death move confirm: `deathMoves.state` per PC — H4.3's `GmDeathConfirm` (Confirm the death move / Send it back).
 *
 * Every answer is the existing keyed mutation with an optimistic update that drops the card at once. A request someone
 * else answered first (REQUEST_NOT_OPEN, DEATH_MOVE_NOT_WAITING) toasts "Already answered" (H6.3: the refusal table's
 * STALE_REQUEST row, in the HUD's toast host) and drops out as the reads refresh; one the player
 * withdraws (HD3) leaves the reads, so its card disappears live. No Momentum prompt (answer 7a: automatic; its line
 * and Undo are in Resolutions) and no Hope split (answer 14a). "End this countdown?" waits on dcm-pgfr's server.
 * The GM's classic lists stay in the Map tools drawer.
 *
 * Placement (plan combat-hud H9.2, GMDesktop / GMTablet `.wchip`, user answer Q10a): closed by default behind the
 * bottom-left "Waiting on you" button with its count (grey 0, purple otherwise); the button opens the queue above it
 * (`hud/panels.ts` entry "queue": one GM panel at a time, Escape closes it and focus goes back to the button). The
 * queue stays mounted while closed (hidden by CSS), so a death confirm's outcome and a half-set Difficulty survive
 * closing it. A new request pulses the count (not under reduced motion) and, while the queue is closed, toasts
 * "Vex: out of range · Waiting on you". Resolutions are not here: the dock's Log is their home (shell region "log").
 * Inside the GM's phone queue sheet (answer 13a, `phone/queue.tsx`) the queue shows inline, with Resolutions under it.
 */
export function HudQueue({ state }: HudPartProps): ReactNode {
  if (state.role !== "gm") return null;
  return <GmQueue campaignId={state.campaignId} />;
}

/** True inside the GM's phone queue sheet (`phone/queue.tsx`): the queue shows inline, with Resolutions under it. */
export const QueueInSheet = createContext(false);

function GmQueue({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const inSheet = useContext(QueueInSheet);
  const queue = useQueue(campaignId);
  useWithdrawToasts(campaignId);
  if (inSheet) {
    return (
      <div className="hud-q-col" data-testid="hud-queue-column">
        <Requests queue={queue} />
        <PartBoundary label="Resolutions">
          <HudResolutions campaignId={campaignId} />
        </PartBoundary>
      </div>
    );
  }
  return <WaitingOnYou queue={queue} />;
}

type Character = FunctionReturnType<typeof api.charactersReads.listByCampaign>[number];

type Queue = {
  items: QueueItem[];
  live: readonly Character[];
  count: number;
  loading: boolean;
  /** Everything waiting, for the arrival pulse and toast; null until every read has loaded. */
  arrivals: Arrival[] | null;
  answers: QueueAnswers;
};

/** The merged reads: the cards, the death confirms, the count. */
function useQueue(campaignId: Id<"campaigns">): Queue {
  const mine = useQuery(api.combatRequestsReads.mine, { campaignId });
  const cards = useQuery(api.combatCardsReads.pending, { campaignId });
  const features = useQuery(api.combatFeaturesReads.pending, { campaignId });
  const difficulties = useQuery(api.combatRequestsReads.difficulties, { campaignId });
  const windows = useQuery(api.adversaryActionsReads.windows, { campaignId });
  const cloaks = useQuery(api.cloakPromptsReads.pending, { campaignId });
  const keywords = useQuery(api.hitKeywordsReads.asks, { campaignId });
  const gmPrompts = useQuery(api.adversaryPromptsReads.pending, { campaignId });
  const allyPicks = useQuery(api.allyPicksReads.open, { campaignId });
  const characters = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const live = useMemo(() => (characters ?? []).filter((c) => !c.corrupt), [characters]);
  // `allyRolls` reads for a character the caller edits; the GM's `pending` lists every open throw of the campaign.
  const anyPc = live[0]?._id;
  const ally = useQuery(api.featurePromptsReads.allyRolls, anyPc === undefined ? "skip" : { campaignId, characterId: anyPc });
  // useQueries needs a stable request object (a new one each render loops): keyed on the PCs' ids.
  const ids = live.map((c) => c._id).join(",");
  const deathRequests = useMemo(
    () => Object.fromEntries((ids ? (ids.split(",") as Id<"characters">[]) : []).map((characterId) => [characterId, { query: api.deathMoves.state, args: { characterId } }])),
    [ids],
  );
  const deaths = useQueries(deathRequests);
  const answers = useQueueAnswers(campaignId);

  const items = queueItems({
    attacks: mine?.flatMap((r) => (r.kind === "sanction" ? [r] : [])),
    cards,
    features,
    difficulties,
    windows,
    cloaks,
    keywords,
    allyRolls: ally?.pending,
    gmPrompts,
    allyPicks,
  });
  const dying = live.flatMap((c) => {
    const s: unknown = deaths[c._id];
    if (typeof s !== "object" || s === null || s instanceof Error) return [];
    const request = (s as { request: { at?: number } | null }).request;
    return request === null ? [] : [deathArrival(c._id, c.sheet.name, String(request.at ?? ""))];
  });
  const count = items.length + dying.length;
  const loading = mine === undefined || cards === undefined || features === undefined || difficulties === undefined || windows === undefined || cloaks === undefined || keywords === undefined || gmPrompts === undefined || allyPicks === undefined;
  const settled = !loading && characters !== undefined && (anyPc === undefined || ally !== undefined) && live.every((c) => deaths[c._id] !== undefined);
  const arrivals = settled ? [...items.map((item) => ({ key: item.key, title: arrivalTitle(item) })), ...dying] : null;
  return { items, live, count, loading, arrivals, answers };
}

const TRAY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M5 5h14l2 8v6H3v-6Z" />
  </svg>
);

const CHEVRON = (
  <svg className="hud-wchip-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 15l6-6 6 6" />
  </svg>
);

/** The bottom-left button and the queue above it (GMDesktop `.wchip` / `.gq`). */
function WaitingOnYou({ queue }: { queue: Queue }) {
  const open = usePanelOpen("queue");
  const popId = useId();
  const badge = useRef<HTMLElement>(null);
  useArrivals(queue.arrivals, badge);
  return (
    <div className="hud-wait" data-open={open} data-testid="hud-waiting">
      <div id={popId} className="hud-q-col" data-testid="hud-queue-column">
        <Requests queue={queue} />
      </div>
      <button
        type="button"
        className="hud-wchip"
        aria-pressed={open}
        aria-expanded={open}
        aria-controls={popId}
        onClick={(e) => (open ? closePanel("queue") : openPanel("queue", e.currentTarget))}
      >
        {TRAY_ICON}
        <span className="hud-wchip-l">Waiting on you</span>
        <b ref={badge} className={queue.count === 0 ? "hud-wn hud-wn0" : "hud-wn"} data-testid="hud-wait-count">
          {queue.count}
        </b>
        {CHEVRON}
      </button>
    </div>
  );
}

/**
 * Q10a: a request that arrives after the queue first loaded pulses the count (skipped under reduced motion) and, while
 * the queue is closed, toasts "<who>: <what>" · "Waiting on you". UI only: nothing is sent.
 */
function useArrivals(arrivals: Arrival[] | null, badge: RefObject<HTMLElement | null>) {
  const seen = useRef<Set<string> | null>(null);
  const sig = arrivals === null ? null : JSON.stringify(arrivals);
  useEffect(() => {
    if (sig === null) return;
    const now = JSON.parse(sig) as Arrival[];
    const fresh = newArrivals(seen.current, now);
    seen.current = new Set(now.map((a) => a.key));
    if (fresh.length === 0) return;
    pulse(badge.current);
    if (openPanelNow() === "queue") return;
    for (const a of fresh) hudToasts.push({ title: a.title, message: "Waiting on you", tone: "neutral", key: `queue|${a.key}` });
  }, [sig, badge]);
}

/**
 * dcm-bxp.99.32.40 (user 2026-11-02): besides the feed line, the GM gets a short toast "Vex withdrew Bolt Beacon" when a
 * player withdraws a request (`combatRequestsReads.withdrawn`, the latest few). Only withdrawals that arrive after the
 * read first loaded toast: the first result is the baseline (the server's clock never meets the browser's), and the ids
 * already seen are remembered. UI only: nothing is sent. Two mounted queues (desktop and phone sheet) share the toast key.
 */
function useWithdrawToasts(campaignId: Id<"campaigns">) {
  const rows = useQuery(api.combatRequestsReads.withdrawn, { campaignId });
  const seen = useRef<Set<string> | null>(null);
  const sig = rows === undefined ? null : JSON.stringify(rows.map(withdrawalArrival));
  useEffect(() => {
    if (sig === null) return;
    const now = JSON.parse(sig) as Arrival[];
    const fresh = newArrivals(seen.current, now);
    seen.current = new Set([...(seen.current ?? []), ...now.map((a) => a.key)]);
    for (const a of fresh.reverse()) hudToasts.push({ title: a.title, message: "It left Waiting on you.", tone: "neutral", key: a.key });
  }, [sig]);
}

/** The count's pulse (Web Animations; no state, no re-render). Nothing under reduced motion (device or account). */
function pulse(el: HTMLElement | null) {
  if (el === null || typeof el.animate !== "function") return;
  if (prefersReducedMotion()) return;
  el.animate(
    [
      { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(143, 123, 209, 0.75)" },
      { transform: "scale(1.3)", boxShadow: "0 0 0 8px rgba(143, 123, 209, 0)" },
      { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(143, 123, 209, 0)" },
    ],
    { duration: 700, iterations: 3, easing: "ease-out" },
  );
}

function Requests({ queue }: { queue: Queue }) {
  const titleId = useId();
  const { items, live, count, loading, answers } = queue;
  return (
    <section className="hud-q" aria-labelledby={titleId} data-testid="hud-queue">
      <h2 id={titleId} className="hud-q-h">
        Waiting on you{" "}
        <span className="hud-q-n" data-testid="hud-queue-count" aria-label={`${count} waiting`}>
          {count}
        </span>
      </h2>
      <div className="hud-q-scroll">
        {/* The death confirms stay mounted per PC: after Confirm the outcome stays until Done (H4.3). */}
        {live.map((c) => (
          <PartBoundary key={`death-${c._id}`} label={`${c.sheet.name}'s death move`}>
            <GmDeathConfirm character={c} />
          </PartBoundary>
        ))}
        {items.length > 0 ? (
          <ul className="hud-q-list" aria-label="Requests waiting on you">
            {items.map((item) => (
              <li key={item.key} data-kind={item.kind}>
                <QueueCard item={item} answers={answers} />
              </li>
            ))}
          </ul>
        ) : null}
        {loading ? (
          <p role="status" className="hud-q-note">
            Loading the requests…
          </p>
        ) : count === 0 ? (
          <p className="hud-q-note">Nothing is waiting on you.</p>
        ) : null}
      </div>
      <p role="status" className="hud-q-result" data-testid="hud-queue-result">
        {answers.result}
      </p>
    </section>
  );
}
