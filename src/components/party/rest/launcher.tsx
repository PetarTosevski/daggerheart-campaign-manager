"use client";

import { useQuery } from "convex/react";

import { BrandButton } from "@/components/brand/buttons";
import { MAX_SHORT_RESTS, MOVE_LABELS, mustLongRest, overShortRestLimit } from "@/lib/domain/rest/moves";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSlotProps } from "../slots";
import { LongTermAfterRest } from "./long-term";

const KIND_LABEL = { short: "Short rest", long: "Long rest" } as const;

/** The dashboard's rest panel: the GM starts, finishes, interrupts and undoes party rests; players see the open rest. */
export function Launcher({ campaignId, isGm }: CampaignSlotProps) {
  const state = useQuery(api.restsReads.current, { campaignId });
  const party = useQuery(api.charactersReads.partySummary, { campaignId });
  const start = useIntent(api.rests.start);
  const finish = useIntent(api.rests.finish);
  const interrupt = useIntent(api.rests.interrupt);
  const undo = useIntent(api.rests.undo);

  if (state === undefined || party === undefined) {
    return (
      <p role="status" className="m-0 text-[14px] text-[#9fb0ab]">
        Loading rests…
      </p>
    );
  }
  const { open, shortRestsSinceLong, last, rules } = state;
  if (!isGm && open === null) return null;
  const resting = party.filter((c) => c.status === "active");
  // T2 (House rules): Book refuses a fourth short rest; Manual warns and lets it start.
  const blocked = mustLongRest("short", shortRestsSinceLong, rules.shortRestLimit);
  const overLimit = overShortRestLimit("short", shortRestsSinceLong);
  // F2 Extended downtime (CB 181, Q7 a): an extra choice on the GM's long rest.
  const extendedOffered = rules.fearFromRests === "extendedDowntime";
  const error = start.error ?? finish.error ?? interrupt.error ?? undo.error;

  return (
    <section aria-labelledby="rest-h" className="flex flex-col gap-3 rounded-[14px] border border-[#2a3a40] bg-[#141e22] p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="rest-h" className="m-0 font-display text-[22px] font-bold text-parchment">
          Rest
        </h2>
        <span className="text-[13px] text-[#9fb0ab]" data-testid="short-rest-count">
          {shortRestsSinceLong} of {MAX_SHORT_RESTS} short rests
        </span>
      </div>

      {open === null ? (
        <>
          <div className="flex flex-wrap gap-2">
            {/* Two starts side by side: the short rest is the main one; once it is blocked the long rest takes over. */}
            <BrandButton
              variant={blocked ? "neutral" : "confirm"}
              size="sm"
              disabled={start.pending || blocked}
              aria-describedby={overLimit ? "short-rest-limit" : undefined}
              onClick={() => void start.fire({ campaignId, kind: "short" })}
            >
              Start short rest
            </BrandButton>
            <BrandButton variant={blocked ? "confirm" : "neutral"} size="sm" disabled={start.pending} onClick={() => void start.fire({ campaignId, kind: "long" })}>
              Start long rest
            </BrandButton>
            {extendedOffered ? (
              <BrandButton
                variant="neutral"
                size="sm"
                disabled={start.pending}
                aria-describedby="extended-downtime-hint"
                onClick={() => void start.fire({ campaignId, kind: "long", extended: true })}
              >
                Extended downtime (several days)
              </BrandButton>
            ) : null}
          </div>
          {extendedOffered ? (
            <p id="extended-downtime-hint" className="m-0 text-[13px] text-[#9fb0ab]">
              Extended downtime is a long rest across several days: the GM gains 1d6 Fear per PC (CB 181).
            </p>
          ) : null}
          {blocked ? (
            <p id="short-rest-limit" className="m-0 text-[14px] text-[#c9d2cf]">
              Three short rests taken: the next rest must be a long rest (CB 105).
            </p>
          ) : overLimit ? (
            <p id="short-rest-limit" role="note" className="m-0 text-[14px] text-[#c9d2cf]" data-testid="short-rest-warning">
              Three short rests taken: the book says the next rest must be a long rest (CB 105). House rules leave it to you.
            </p>
          ) : null}
          {last !== null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-[#c9d2cf]">
              <span>
                Last: {KIND_LABEL[last.kind]} {last.status === "interrupted" ? "(interrupted)" : ""}
                {last.fearGained !== null ? ` · GM gained ${last.fearGained} Fear` : ""}
                {last.fearPrompt !== null ? ` · ${last.fearPrompt} (Manual)` : ""}
              </span>
              {last.undoable ? (
                <BrandButton size="sm" variant="danger" disabled={undo.pending} onClick={() => void undo.fire({ campaignId, restId: last._id })}>
                  Undo rest
                </BrandButton>
              ) : null}
            </div>
          ) : null}
          {last !== null && last.resultsOpen ? (
            // DA5: the short rest's results while the Oasis window is open (HF 27). DA15: the party's pool (one reroll
            // per Duneborne); each holder closes their own panel on their sheet, and the group goes once all have.
            <div role="group" aria-label="Rest results" className="flex flex-col gap-2 text-[14px] text-[#c9d2cf]">
              <ul aria-label="Downtime dice" className="m-0 flex list-none flex-col gap-1 p-0">
                {last.dice.map((d, i) => {
                  const name = (id: string) => party.find((c) => c._id === id)?.sheet.name ?? "A PC";
                  return (
                    // The dice never move: the roll order is their identity.
                    <li key={i}>
                      <strong className="text-parchment">{name(d.characterId)}</strong>: {MOVE_LABELS[d.move]}
                      {d.targetId !== undefined ? ` on ${name(d.targetId)}` : ""}, d{d.sides} {d.value} + tier {d.bonus}
                      {d.rerolls.length > 0 ? ` (Oasis: first ${d.rolled})` : ""}
                    </li>
                  );
                })}
              </ul>
              <span data-testid="oasis-pool">
                Oasis (HF 27): {last.oasisLeft} {last.oasisLeft === 1 ? "reroll" : "rerolls"} left for the party. Still open:{" "}
                {last.oasisHolders
                  .filter((h) => !last.oasisClosed.includes(h))
                  .map((h) => party.find((c) => c._id === h)?.sheet.name ?? "A PC")
                  .join(", ")}
                .
              </span>
            </div>
          ) : null}
          {isGm && last !== null && last.kind === "long" && last.status === "finished" ? <LongTermAfterRest campaignId={campaignId} /> : null}
        </>
      ) : (
        <>
          <p className="m-0 text-[15px] text-[#e6ecea]" data-testid="open-rest">
            {open.extended ? "Extended downtime (long rest)" : KIND_LABEL[open.kind]} under way{open.gmOverride ? " (GM override)" : ""}. Each player picks two moves on their sheet.
          </p>
          <ul aria-label="Downtime choices" className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-[#c9d2cf]">
            {resting.map((c) => {
              const choice = open.choices.find((ch) => ch.characterId === c._id);
              return (
                <li key={c._id}>
                  <strong className="text-parchment">{c.sheet.name}</strong>:{" "}
                  {c.sheet.conditions?.includes("unconscious")
                    ? "unconscious"
                    : choice
                      ? choice.moves.map((m) => MOVE_LABELS[m.move]).join(", ")
                      : "choosing…"}
                </li>
              );
            })}
          </ul>
          {isGm ? (
            <div className="flex flex-wrap gap-2">
              <BrandButton size="sm" variant="confirm" disabled={finish.pending} onClick={() => void finish.fire({ campaignId, restId: open._id })}>
                Finish rest
              </BrandButton>
              <BrandButton size="sm" variant="danger" disabled={interrupt.pending} onClick={() => void interrupt.fire({ campaignId, restId: open._id })}>
                Interrupt
              </BrandButton>
            </div>
          ) : null}
        </>
      )}
      <p aria-live="polite" className="m-0 text-[14px] text-danger">
        {error ?? ""}
      </p>
    </section>
  );
}
