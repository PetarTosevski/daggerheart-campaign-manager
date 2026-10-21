"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ChevronDown, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { play3d } from "./dice3d";
import { DiceFaces, DiceSettingsToggles } from "./parts";
import { canAnimate3d, useDiceSettings } from "./settings";
import { playRollSound } from "./sound";
import { TickCountdownsButton } from "./tick-countdowns";

const PAGE = 15;
/** Most rows one countedRows call asks about (the server's cap). */
const COUNTED_MAX = 100;
const SIDES = [4, 6, 8, 10, 12, 20] as const;
const BTN = "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const INPUT = "min-h-10 rounded-[9px] border border-[#33444a] bg-[#10181b] px-3 text-[14px] text-[#e6ecea]";

/** Whether the feed is folded away, remembered per device (browser storage is for conveniences only). */
const COLLAPSED_KEY = "dcm:roll-feed-collapsed";
const COLLAPSED_EVENT = "dcm-roll-feed-collapsed";
/** The last choice, for when storage throws (private windows, blocked site data). */
let collapsedFallback = false;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return collapsedFallback;
  }
}

function writeCollapsed(collapsed: boolean): void {
  collapsedFallback = collapsed;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage blocked: the fallback above keeps the choice for this page.
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener(COLLAPSED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The GM's free roll: any dice plus a modifier, hidden from players until revealed. */
function GmRollForm({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const [count, setCount] = useState("1");
  const [sides, setSides] = useState<number>(20);
  const [modifier, setModifier] = useState("0");
  const [label, setLabel] = useState("");
  const roll = useIntent(api.rolls.gmRoll);
  const n = Number.parseInt(count, 10);
  const stage = useRef<HTMLDivElement>(null);
  const [settings] = useDiceSettings();

  // The same 3D dice and sound as the character dice box, per this device's settings.
  async function submit() {
    const result = await roll.fire({ campaignId, dice: [{ count: n, sides }], modifier: Number.parseInt(modifier, 10) || 0, ...(label.trim() ? { label: label.trim() } : {}) });
    if (!result) return;
    const shown = canAnimate3d(settings) && stage.current !== null && (await play3d(stage.current, { dice: result.roll.dice, sound: settings.sound }));
    if (!shown && settings.sound) playRollSound();
  }

  return (
    <form
      aria-label="GM roll"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-[#8fa3a8] uppercase">
        Dice
        <input className={`${INPUT} w-16 text-center`} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#8fa3a8] uppercase">
        Die
        <select className={INPUT} value={sides} onChange={(e) => setSides(Number(e.target.value))}>
          {SIDES.map((s) => (
            <option key={s} value={s}>
              d{s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#8fa3a8] uppercase">
        Modifier
        <input className={`${INPUT} w-16 text-center`} inputMode="numeric" value={modifier} onChange={(e) => setModifier(e.target.value.replace(/[^0-9-]/g, "").slice(0, 3))} />
      </label>
      <label className="flex min-w-32 flex-1 flex-col gap-1 text-[12px] text-[#8fa3a8] uppercase">
        For
        <input className={INPUT} placeholder="Optional label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button type="submit" className={BTN} disabled={roll.pending || !(n > 0)}>
        Roll in secret
      </button>
      <p aria-live="polite" className="m-0 w-full text-[13px] text-danger empty:hidden">
        {roll.error}
      </p>
      <div ref={stage} className="w-full empty:hidden" />
    </form>
  );
}

/**
 * The roll feed on the dashboard: every member sees player rolls live; GM
 * free rolls only reach players once revealed (the server filters them).
 * Undo for the roller and the GM; Reveal for the GM. The GM can also delete a
 * row or clear the feed for everyone (display only: nothing is undone), and
 * apply a counted action roll to countdowns ("Tick countdowns"). Anyone can
 * fold the feed away on their device.
 */
export function RollFeedPanel({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const { results, status, loadMore } = usePaginatedQuery(api.feed.list, { campaignId }, { initialNumItems: PAGE });
  const undo = useIntent(api.actionLog.undo);
  const reveal = useMutation(api.rolls.reveal);
  const remove = useMutation(api.feed.remove);
  const clear = useMutation(api.feed.clear);
  const [clearing, setClearing] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  // GM only: which loaded rows are counted action rolls, so they carry "Tick countdowns" (countdowns-advanced K1).
  const candidates = isGm ? results.filter((r) => r.kind === "roll" && r.roll?.kind === "action" && !r.undone).slice(0, COUNTED_MAX).map((r) => r._id) : [];
  const counted = useQuery(api.countdownRolls.countedRows, isGm && candidates.length > 0 ? { campaignId, entryIds: candidates } : "skip");
  const countedIds = new Set<string>(counted ?? []);

  return (
    <section aria-labelledby="feed-h" className="flex flex-col gap-3 rounded-2xl border border-[#2a3a40] bg-[#141e22] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="feed-h" className="m-0 font-display text-[24px] font-bold text-parchment">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls="feed-body"
            className="flex min-h-10 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-[inherit] text-inherit"
            onClick={() => writeCollapsed(!collapsed)}
          >
            Roll Feed
            <ChevronDown aria-hidden="true" className={`size-5 text-[#8fa3a8] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          </button>
        </h2>
        {collapsed ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <DiceSettingsToggles className="text-[#c9d2cf]" />
            {isGm && results.length > 0 ? (
              confirmClear ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`${BTN} border-[#7a3a3a] text-[#ffd9d6]`}
                    disabled={clearing}
                    onClick={() => {
                      setClearing(true);
                      setFeedError(null);
                      clear({ campaignId })
                        .then(() => setConfirmClear(false))
                        .catch((e: unknown) => setFeedError(errorMessage(e)))
                        .finally(() => setClearing(false));
                    }}
                  >
                    Clear for everyone
                  </button>
                  <button type="button" className={BTN} onClick={() => setConfirmClear(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className={BTN} onClick={() => setConfirmClear(true)}>
                  Clear feed
                </button>
              )
            ) : null}
          </div>
        )}
      </div>
      {collapsed ? null : (
      <div id="feed-body" className="flex flex-col gap-3">
      {isGm ? <GmRollForm campaignId={campaignId} /> : null}
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {undo.error ?? feedError}
      </p>
      {status === "LoadingFirstPage" ? (
        <p role="status" className="m-0 text-[15px] text-[#9fb2b6]">
          Loading rolls…
        </p>
      ) : results.length === 0 ? (
        <p className="m-0 text-[15px] text-[#9fb2b6]">No rolls yet. Roll from a character sheet and it shows up here for everyone.</p>
      ) : (
        <ol aria-label="Rolls" className="m-0 flex list-none flex-col gap-2 p-0">
          {results.map((row) => (
            <li
              key={row._id}
              aria-label={row.summary}
              className={`flex flex-col gap-1.5 rounded-[10px] border border-[#253338] bg-[#10181b] px-3 py-2 ${row.undone ? "opacity-50" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-[15px] text-[#e6ecea]">
                <span className={row.undone ? "line-through" : ""}>{row.summary}</span>
                {row.roll?.manual ? <span className="rounded border border-[#5b4a2a] px-1.5 text-[11px] tracking-[0.1em] text-[#f4e3bd] uppercase">manual</span> : null}
                {row.visibility === "gm" ? <span className="rounded border border-[#3b2f5c] px-1.5 text-[11px] tracking-[0.1em] text-[#c9b3ff] uppercase">hidden</span> : null}
                {row.undone ? <span className="text-[12px] text-[#9fb2b6]">undone</span> : null}
                <span className="ml-auto text-[12px] text-[#8fa3a8]">{time(row.at)}</span>
                {isGm ? (
                  // Removes the line only; the roll or action itself stays (Undo is the button that reverts it).
                  <button
                    type="button"
                    aria-label={`Delete from the feed: ${row.summary}`}
                    title="Delete from the feed"
                    className="-my-1 -mr-1 flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-[#8fa3a8] hover:bg-white/5 hover:text-[#e6ecea]"
                    onClick={() => {
                      setFeedError(null);
                      remove({ campaignId, entryId: row._id }).catch((e: unknown) => setFeedError(errorMessage(e)));
                    }}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
              {row.roll ? <DiceFaces dice={row.roll.dice} /> : null}
              {/* A rest is undone from the rest panel (rests.undo reopens it); actionLog.undo refuses it. */}
              {(row.canUndo && row.kind !== "rest") || ("revealable" in row && row.revealable) || countedIds.has(row._id) ? (
                <div className="flex flex-wrap gap-2">
                  {"revealable" in row && row.revealable ? (
                    <button
                      type="button"
                      className={BTN}
                      onClick={() => {
                        setFeedError(null);
                        reveal({ campaignId, entryId: row._id }).catch((e: unknown) => setFeedError(errorMessage(e)));
                      }}
                    >
                      Reveal
                    </button>
                  ) : null}
                  {row.canUndo && row.kind !== "rest" ? (
                    <button type="button" className={BTN} disabled={undo.pending} onClick={() => void undo.fire({ entryId: row._id })}>
                      Undo
                    </button>
                  ) : null}
                  {countedIds.has(row._id) ? <TickCountdownsButton campaignId={campaignId} entryId={row._id} summary={row.summary} /> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {status === "CanLoadMore" ? (
        <button type="button" className={`${BTN} self-start`} onClick={() => loadMore(PAGE)}>
          Show older rolls
        </button>
      ) : null}
      </div>
      )}
    </section>
  );
}
