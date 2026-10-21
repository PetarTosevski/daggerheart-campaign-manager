"use client";

import { useQuery } from "convex/react";

import { BrandButton } from "@/components/brand/buttons";
import { MAX_SHORT_RESTS, MOVE_LABELS, mustLongRest } from "@/lib/domain/rest/moves";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSlotProps } from "../slots";
import { LongTermAfterRest } from "./long-term";

const KIND_LABEL = { short: "Short rest", long: "Long rest" } as const;

/** The dashboard's rest panel: the GM starts, finishes, interrupts and undoes party rests; players see the open rest. */
export function Launcher({ campaignId, isGm }: CampaignSlotProps) {
  const state = useQuery(api.rests.current, { campaignId });
  const party = useQuery(api.characters.listByCampaign, { campaignId });
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
  const { open, shortRestsSinceLong, last } = state;
  if (!isGm && open === null) return null;
  const resting = party.filter((c) => c.status === "active");
  const blocked = mustLongRest("short", shortRestsSinceLong);
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
            <BrandButton
              size="sm"
              disabled={start.pending || blocked}
              aria-describedby={blocked ? "short-rest-limit" : undefined}
              onClick={() => void start.fire({ campaignId, kind: "short" })}
            >
              Start short rest
            </BrandButton>
            <BrandButton size="sm" disabled={start.pending} onClick={() => void start.fire({ campaignId, kind: "long" })}>
              Start long rest
            </BrandButton>
          </div>
          {blocked ? (
            <p id="short-rest-limit" className="m-0 text-[14px] text-[#c9d2cf]">
              Three short rests taken: the next rest must be a long rest (CB 105).
            </p>
          ) : null}
          {last !== null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-[#c9d2cf]">
              <span>
                Last: {KIND_LABEL[last.kind]} {last.status === "interrupted" ? "(interrupted)" : ""}
                {last.fearGained !== null ? ` · GM gained ${last.fearGained} Fear` : ""}
              </span>
              {last.undoable ? (
                <BrandButton size="sm" variant="danger" disabled={undo.pending} onClick={() => void undo.fire({ campaignId, restId: last._id })}>
                  Undo rest
                </BrandButton>
              ) : null}
            </div>
          ) : null}
          {isGm && last !== null && last.kind === "long" && last.status === "finished" ? <LongTermAfterRest campaignId={campaignId} /> : null}
        </>
      ) : (
        <>
          <p className="m-0 text-[15px] text-[#e6ecea]" data-testid="open-rest">
            {KIND_LABEL[open.kind]} under way{open.gmOverride ? " (GM override)" : ""}. Each player picks two moves on their sheet.
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
              <BrandButton size="sm" variant="solid" disabled={finish.pending} onClick={() => void finish.fire({ campaignId, restId: open._id })}>
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
