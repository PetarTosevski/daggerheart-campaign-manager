"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";

import { ruleNoteTag } from "@/components/combat-map/hud/feed/model";
import { errorMessage } from "@/lib/convex-errors";
import { useUiState } from "@/lib/use-ui-state";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FreeRollForm } from "./free-roll";
import { DiceFaces, DiceSettingsToggles } from "./parts";
import { TickCountdownsButton } from "./tick-countdowns";

const PAGE = 15;
/** Most rows one countedRows call asks about (the server's cap). */
const COUNTED_MAX = 100;
const BTN = "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The GM's free roll: any mix of dice plus a modifier (user 2026-11-04), hidden from players until revealed. Also the
 * Combat HUD's GM Dice (user answer 2026-11-02), which has no feed beside it: `showResult` adds the last roll's dice and
 * total under the form. The form itself is `FreeRollForm` (./free-roll); this name stays for the HUD's import.
 */
export function GmRollForm({ campaignId, showResult = false }: { campaignId: Id<"campaigns">; showResult?: boolean }) {
  return <FreeRollForm campaignId={campaignId} mode="gm" showResult={showResult} />;
}

/**
 * The GM's secret roll form behind a disclosure button (dcm-bxp.34): open by default, the choice stored on the
 * account (plan config U6e), so it follows the GM to every device. Folding it hides only the form; the feed list
 * below stays.
 */
function GmRollSection({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const [collapsed, setCollapsed] = useUiState("gmRollFormCollapsed");
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls="gm-roll-form"
        className="flex min-h-10 cursor-pointer items-center gap-2 self-start border-0 bg-transparent p-0 text-[13px] font-semibold tracking-[0.08em] text-[#c9d2cf] uppercase hover:text-[#e6ecea]"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronDown aria-hidden="true" className={`size-4 text-[#8fa3a8] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        Secret GM roll
      </button>
      {collapsed ? null : <GmRollForm campaignId={campaignId} />}
    </div>
  );
}

/**
 * A player's free roll of mixed dice (user 2026-11-04), public, behind a disclosure button: folded by default, the
 * choice stored on the account (plan config U6e).
 */
function FreeRollSection({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const [open, setOpen] = useUiState("freeRollFormOpen");
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="free-roll-form"
        className="flex min-h-11 cursor-pointer items-center gap-2 self-start border-0 bg-transparent p-0 text-[13px] font-semibold tracking-[0.08em] text-[#c9d2cf] uppercase hover:text-[#e6ecea]"
        onClick={() => setOpen(!open)}
      >
        <ChevronDown aria-hidden="true" className={`size-4 text-[#8fa3a8] transition-transform ${open ? "" : "-rotate-90"}`} />
        Roll dice
      </button>
      {open ? <FreeRollForm campaignId={campaignId} mode="public" /> : null}
    </div>
  );
}

/**
 * A Manual rule's note (kind `rule`, GM-only; plan rule-switches RU): a 'Manual' tag and the rule's title before the
 * summary. Nothing for any other row.
 */
function RuleNoteTag({ row }: { row: { kind: string; ruleId?: string } }) {
  const rule = ruleNoteTag(row);
  if (rule === null) return null;
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-[#c9a8ff]">
      <span className="rounded border border-[#6b5a9a] px-1.5 text-[11px] tracking-[0.1em] uppercase">{rule.tag}</span>
      {rule.title}
    </span>
  );
}

/**
 * The roll feed on the dashboard: every member sees player rolls live; GM
 * free rolls only reach players once revealed (the server filters them).
 * Undo where `canUndo` allows it (the GM; a player only on their own action that rolled nothing, convex/lib/actionLog.ts
 * `groupRolled`); Reveal for the GM. The GM can also delete a
 * row or clear the feed for everyone (display only: nothing is undone), and
 * apply a counted action roll to countdowns ("Tick countdowns"). Anyone can
 * fold the feed away (stored on their account, plan config U6e).
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
  const [collapsed, setCollapsed] = useUiState("rollFeedCollapsed");
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
            onClick={() => setCollapsed(!collapsed)}
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
      {isGm ? <GmRollSection campaignId={campaignId} /> : <FreeRollSection campaignId={campaignId} />}
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
                <RuleNoteTag row={row} />
                <span className={row.undone ? "line-through" : ""}>{row.summary}</span>
                {row.roll?.manual ? <span className="rounded border border-[#5b4a2a] px-1.5 text-[11px] tracking-[0.1em] text-[#f4e3bd] uppercase">manual</span> : null}
                {/* Fear colours while hidden; Hope colours once revealed (user 2026-11-04). A roll never hidden gets no tag. */}
                {row.visibility === "gm" ? <span className="rounded border border-fear/50 bg-fear-bg px-1.5 text-[11px] tracking-[0.1em] text-fear uppercase">hidden</span> : null}
                {row.visibility === "public" && row.revealed ? <span className="rounded border border-hope/50 bg-hope-bg px-1.5 text-[11px] tracking-[0.1em] text-hope uppercase">revealed</span> : null}
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
