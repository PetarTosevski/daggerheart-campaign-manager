"use client";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { Hourglass } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { chaseTicks, rollTicks, tickCountdown, type ChasePair } from "@/lib/domain/countdowns/advanced";
import { OUTCOME_LABEL } from "@/lib/domain/dice";
import type { RollOutcome } from "@/lib/domain/duality";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DiceBoundary } from "./boundary";

const BTN = "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";

type CountdownList = NonNullable<ReturnType<typeof useQuery<typeof api.countdowns.listByCampaign>>>;

/**
 * The optimistic list after the GM applies a roll to countdowns: each chosen countdown ticks by the same domain rules
 * the server runs (rollTicks / chaseTicks, then tickCountdown), from the pair as it stood before the roll.
 */
function tickedList(list: CountdownList, chosen: readonly Id<"countdowns">[], outcome: RollOutcome): CountdownList {
  const byId = new Map(list.map((c) => [c._id, c]));
  // A chase side brings its partner along (one roll moves both sides, K6), as the server does.
  const ids = new Set<Id<"countdowns">>(chosen);
  for (const id of chosen) {
    const partnerId = byId.get(id)?.chase?.partnerId;
    if (partnerId !== undefined && byId.has(partnerId)) ids.add(partnerId);
  }
  const amounts = new Map<string, number>();
  for (const id of ids) {
    const c = byId.get(id);
    if (!c || c.currentValue === null || c.mode === null) continue;
    const partner = c.chase ? byId.get(c.chase.partnerId) : undefined;
    if (c.chase && partner && partner.currentValue !== null) {
      const self = { currentValue: c.currentValue, status: c.status };
      const other = { currentValue: partner.currentValue, status: partner.status };
      const pair: ChasePair = c.chase.side === "party" ? { party: self, rivals: other } : { party: other, rivals: self };
      amounts.set(id, chaseTicks(pair, outcome)[c.chase.side]);
    } else {
      amounts.set(id, rollTicks(c.mode, outcome));
    }
  }
  return list.map((c) => {
    const amount = amounts.get(c._id);
    if (amount === undefined || c.currentValue === null || c.startingValue === null) return c;
    try {
      const { next } = tickCountdown(
        { currentValue: c.currentValue, startingValue: c.startingValue, status: c.status, ...(c.repeat ? { repeat: c.repeat } : {}), triggerCount: c.triggerCount ?? 0 },
        amount,
      );
      return { ...c, ...next };
    } catch {
      return c; // the server refuses it too (a paused countdown); its error shows
    }
  });
}

function optimisticApply(campaignId: Id<"campaigns">, outcome: RollOutcome) {
  return (store: OptimisticLocalStore, { entryId, countdownIds }: { entryId: Id<"actionLog">; countdownIds: Id<"countdowns">[] }) => {
    const list = store.getQuery(api.countdowns.listByCampaign, { campaignId });
    if (list) store.setQuery(api.countdowns.listByCampaign, { campaignId }, tickedList(list, countdownIds, outcome));
    const preview = store.getQuery(api.countdownRolls.preview, { campaignId, entryId });
    if (preview) {
      store.setQuery(api.countdownRolls.preview, { campaignId, entryId }, {
        ...preview,
        countdowns: preview.countdowns.map((c) =>
          countdownIds.includes(c.countdownId) ? { ...c, ticked: true, ...(c.partner ? { partner: { ...c.partner, ticked: c.partner.amount > 0 } } : {}) } : c,
        ),
      });
    }
  };
}

function amountLabel(amount: number): string {
  return amount === 0 ? "no tick" : `−${amount}`;
}

type PreviewRow = NonNullable<ReturnType<typeof useQuery<typeof api.countdownRolls.preview>>>["countdowns"][number];

/** A chase pair is one row (K6): it counts as ticked when either side was, and moves when either side would. */
const rowTicked = (c: PreviewRow) => c.ticked || c.partner?.ticked === true;
const rowAmount = (c: PreviewRow) => c.amount + (c.partner?.amount ?? 0);

/** The preview list with a box per countdown; already-ticked ones stay checked and locked (D5). */
function TickList({ campaignId, entryId, onDone }: { campaignId: Id<"campaigns">; entryId: Id<"actionLog">; onDone: () => void }) {
  const preview = useQuery(api.countdownRolls.preview, { campaignId, entryId });
  const outcome = preview?.outcome ?? "none";
  const apply = useMutation(api.countdownRolls.applyRoll).withOptimisticUpdate(optimisticApply(campaignId, outcome));
  const [chosen, setChosen] = useState<Set<Id<"countdowns">>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (preview === undefined) {
    return (
      <p role="status" className="m-0 text-[15px] text-[#9fb2b6]">
        Loading countdowns…
      </p>
    );
  }
  const open = preview.countdowns.filter((c) => !rowTicked(c) && rowAmount(c) > 0);
  const picked = open.filter((c) => chosen.has(c.countdownId)).map((c) => c.countdownId);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || picked.length === 0) return;
        setError(null);
        setPending(true);
        apply({ campaignId, entryId, countdownIds: picked, idempotencyKey: crypto.randomUUID() })
          .then(() => {
            setChosen(new Set());
            onDone();
          })
          .catch((e: unknown) => setError(errorMessage(e)))
          .finally(() => setPending(false));
      }}
    >
      <p className="m-0 text-[15px] text-[#c9d2cf]">
        This roll: <strong className="text-parchment">{OUTCOME_LABEL[preview.outcome]}</strong>. Each roll ticks a countdown once.
      </p>
      {preview.countdowns.length === 0 ? (
        <p className="m-0 text-[15px] text-[#9fb2b6]">No active countdowns to tick.</p>
      ) : (
        <ul aria-label="Countdowns to tick" className="m-0 flex list-none flex-col gap-2 p-0">
          {preview.countdowns.map((c) => {
            const ticked = rowTicked(c);
            const locked = ticked || rowAmount(c) === 0;
            return (
              <li key={c.countdownId}>
                <label
                  data-chase={c.partner ? "true" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-[10px] border border-[#253338] bg-[#10181b] px-3 py-2 text-[15px] text-[#e6ecea] ${locked ? "opacity-70" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    className="size-5 flex-none accent-[#c9a45c]"
                    aria-label={c.partner ? `Chase: ${c.name} and ${c.partner.name}` : undefined}
                    checked={ticked || chosen.has(c.countdownId)}
                    disabled={locked}
                    onChange={(e) =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.countdownId);
                        else next.delete(c.countdownId);
                        return next;
                      })
                    }
                  />
                  {c.partner ? (
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Chase · both sides move</span>
                      {[
                        { name: c.name, left: c.currentValue, amount: c.amount },
                        { name: c.partner.name, left: c.partner.currentValue, amount: c.partner.amount },
                      ].map((side, i) => (
                        <span key={i} className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate">
                            {side.name} <span className="text-[13px] text-[#9fb2b6]">({side.left} left)</span>
                          </span>
                          <span className="flex-none text-[14px] font-semibold text-[#f4e3bd]">{ticked ? "" : amountLabel(side.amount)}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="flex-1">
                      {c.name} <span className="text-[13px] text-[#9fb2b6]">({c.currentValue} left)</span>
                    </span>
                  )}
                  {c.partner && !ticked ? null : (
                    <span className="flex-none text-[14px] font-semibold text-[#f4e3bd]">{ticked ? "ticked" : amountLabel(c.amount)}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN} disabled={pending || picked.length === 0}>
          Apply
        </button>
        <button type="button" className={BTN} onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

/**
 * The GM's "Tick countdowns" button on a counted roll row of the feed (plan countdowns-advanced K1, Q1 (c)): applies
 * the roll to the countdowns the GM picks, armed or not; the server computes every amount and trigger.
 */
export function TickCountdownsButton({ campaignId, entryId, summary }: { campaignId: Id<"campaigns">; entryId: Id<"actionLog">; summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${BTN} inline-flex items-center gap-1.5`} aria-label={`Tick countdowns: ${summary}`} onClick={() => setOpen(true)}>
        <Hourglass aria-hidden="true" className="size-4" />
        Tick countdowns
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Tick countdowns" className="max-w-[520px] border-[#33444a] bg-[#121b1f]">
        <DiceBoundary label="The countdowns">
          <TickList campaignId={campaignId} entryId={entryId} onDone={() => setOpen(false)} />
        </DiceBoundary>
      </Modal>
    </>
  );
}
