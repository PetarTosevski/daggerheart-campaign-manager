"use client";

import { usePaginatedQuery } from "convex/react";
import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DiceFaces, DiceSettingsToggles } from "./parts";

const PAGE = 15;
const SIDES = [4, 6, 8, 10, 12, 20] as const;
const BTN = "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const INPUT = "min-h-10 rounded-[9px] border border-[#33444a] bg-[#10181b] px-3 text-[14px] text-[#e6ecea]";

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

  return (
    <form
      aria-label="GM roll"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void roll.fire({ campaignId, dice: [{ count: n, sides }], modifier: Number.parseInt(modifier, 10) || 0, ...(label.trim() ? { label: label.trim() } : {}) });
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
    </form>
  );
}

/**
 * The roll feed on the dashboard: every member sees player rolls live; GM
 * free rolls only reach players once revealed (the server filters them).
 * Undo for the roller and the GM; Reveal for the GM.
 */
export function RollFeedPanel({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const { results, status, loadMore } = usePaginatedQuery(api.feed.list, { campaignId }, { initialNumItems: PAGE });
  const undo = useIntent(api.actionLog.undo);
  const reveal = useMutation(api.rolls.reveal);
  const [revealError, setRevealError] = useState<string | null>(null);

  return (
    <section aria-labelledby="feed-h" className="flex flex-col gap-3 rounded-2xl border border-[#2a3a40] bg-[#141e22] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="feed-h" className="m-0 font-display text-[24px] font-bold text-parchment">
          Roll Feed
        </h2>
        <DiceSettingsToggles className="text-[#c9d2cf]" />
      </div>
      {isGm ? <GmRollForm campaignId={campaignId} /> : null}
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {undo.error ?? revealError}
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
              </div>
              {row.roll ? <DiceFaces dice={row.roll.dice} /> : null}
              {row.canUndo || ("revealable" in row && row.revealable) ? (
                <div className="flex gap-2">
                  {"revealable" in row && row.revealable ? (
                    <button
                      type="button"
                      className={BTN}
                      onClick={() => {
                        setRevealError(null);
                        reveal({ campaignId, entryId: row._id }).catch((e: unknown) => setRevealError(errorMessage(e)));
                      }}
                    >
                      Reveal
                    </button>
                  ) : null}
                  {row.canUndo ? (
                    <button type="button" className={BTN} disabled={undo.pending} onClick={() => void undo.fire({ entryId: row._id })}>
                      Undo
                    </button>
                  ) : null}
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
    </section>
  );
}
