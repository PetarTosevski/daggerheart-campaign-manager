"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import {
  READING_DICE,
  REVELATION_EFFECTS,
  REVELATION_KINDS,
  REVELATION_LABELS,
  REVELATION_STATUSES,
  SHOWDOWN_EFFECT,
  SPREAD_ADVICE,
  TEXT_MAX,
  nightSkyEntry,
  placeClashes,
  type Revelation,
  type RevelationStatus,
} from "@/lib/frames/trackers/weredragon";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { TRACKER_BTN, TrackerCard } from "./tracker-card";

const FIELD = "rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]";
const STATUS_LABEL: Record<RevelationStatus, string> = { hidden: "Hidden", revealed: "Revealed", achieved: "Achieved" };

type Secret = { id: string; text: string; used: boolean; authorName: string | null };

function ErrorLine({ error }: { error: string | null }) {
  return (
    <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
      {error}
    </p>
  );
}

/** Reign of the Weredragon: the Astromancer's Revelations and Forlorne's secrets (HF pp.140-141). */
export function WeredragonTracker({ campaign }: { campaign: CampaignSummary }) {
  const view = useQuery(api.trackers.weredragon.get, { campaignId: campaign._id });
  if (view === undefined) return null;
  const isGm = view.role === "gm";
  return (
    <>
      <TrackerCard
        title="The Astromancer’s Revelations"
        subtitle={isGm ? "Each revelation stays hidden from players until you reveal it." : "What the stars have shown you."}
        actions={<RollNightSky campaignId={campaign._id} waiting={!isGm && view.pendingRoll !== null} />}
      >
        {view.pendingRoll ? (
          isGm ? (
            <ReadingPicker key={view.pendingRoll.join(",")} campaignId={campaign._id} roll={view.pendingRoll} />
          ) : (
            <p className="m-0 text-[14px] text-[#9fb2b6]">
              The stars show <span data-testid="night-sky-roll" className="font-display text-[#e6ecea]">{view.pendingRoll.join(" · ")}</span>. The GM
              places one die in each column.
            </p>
          )
        ) : null}
        <ol aria-label="Revelations" className="m-0 flex list-none flex-col gap-2.5 p-0">
          {view.revelations.map((r, i) =>
            isGm ? (
              <GmRevelation key={r.kind} campaignId={campaign._id} index={i} revelation={r} />
            ) : (
              <PlayerRevelation key={r.kind} index={i} revelation={r} />
            ),
          )}
        </ol>
        {view.showdownReady ? (
          <p data-testid="showdown-ready" className="m-0 rounded-lg border border-brand/60 bg-brand/10 px-3 py-2 text-[14px] text-[#e6ecea]">
            <strong className="font-display">Showdown ready.</strong> {SHOWDOWN_EFFECT}
          </p>
        ) : null}
      </TrackerCard>
      <ForlorneSecrets campaignId={campaign._id} isGm={isGm} secrets={view.secrets} />
    </>
  );
}

/** Any member rolls the 5d6 (HF p.140); a player waits until the GM has placed the last roll. */
function RollNightSky({ campaignId, waiting }: { campaignId: Id<"campaigns">; waiting: boolean }) {
  const read = useIntent(api.trackers.weredragon.readNightSky);
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className={TRACKER_BTN} disabled={read.pending || waiting} onClick={() => read.fire({ campaignId })}>
        Roll the night sky
      </button>
      <ErrorLine error={read.error} />
    </div>
  );
}

/** The GM places each of the five dice in one revelation column (HF p.140). */
function ReadingPicker({ campaignId, roll }: { campaignId: Id<"campaigns">; roll: number[] }) {
  const [assignment, setAssignment] = useState<number[]>(() => Array.from({ length: READING_DICE }, (_, i) => i));
  const assign = useIntent(api.trackers.weredragon.assignReading);
  const dice = assignment.map((i) => roll[i]);
  const clashes = placeClashes(dice);

  function pick(column: number, dieIndex: number) {
    setAssignment((prev) => {
      const next = [...prev];
      const other = next.indexOf(dieIndex);
      // Swap so every die stays in exactly one column.
      next[other] = next[column];
      next[column] = dieIndex;
      return next;
    });
  }

  return (
    <div role="group" aria-label="Night sky reading" className="flex flex-col gap-2.5 rounded-lg border border-[#33444a] p-3">
      <p className="m-0 text-[14px] text-[#9fb2b6]">
        The stars show <span data-testid="night-sky-roll" className="font-display text-[#e6ecea]">{roll.join(" · ")}</span>. Place one die in each
        column. {SPREAD_ADVICE}
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {REVELATION_KINDS.map((kind, column) => (
          <li key={kind} className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[170px_110px_1fr]">
            <span className="pt-2 text-[14px] font-semibold text-[#e6ecea]">{REVELATION_LABELS[kind]}</span>
            <select
              aria-label={`Die for ${REVELATION_LABELS[kind]}`}
              value={assignment[column]}
              onChange={(e) => pick(column, Number(e.target.value))}
              className={cn(FIELD, "min-h-10")}
            >
              {roll.map((d, i) => (
                <option key={i} value={i}>
                  Die {i + 1}: {d}
                </option>
              ))}
            </select>
            <span className="pt-2 font-serif text-[15px] text-[#cfd8d6]">{nightSkyEntry(kind, dice[column]).text}</span>
          </li>
        ))}
      </ul>
      {clashes.length ? (
        <ul role="alert" aria-label="Reading warnings" className="m-0 list-none rounded-lg border border-[#8f6a2b] bg-[#8f6a2b]/15 p-2 text-[13px] text-[#f0d9a8]">
          {clashes.map((c) => (
            <li key={c.place}>
              {c.kinds.map((k) => REVELATION_LABELS[k]).join(" and ")} both send the PCs to {c.place}.
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <button type="button" className={TRACKER_BTN} disabled={assign.pending} onClick={() => assign.fire({ campaignId, assignment })}>
          Apply reading
        </button>
        <ErrorLine error={assign.error} />
      </div>
    </div>
  );
}

function GmRevelation({ campaignId, index, revelation: r }: { campaignId: Id<"campaigns">; index: number; revelation: Revelation }) {
  const update = useIntent(api.trackers.weredragon.updateRevelation);
  const label = REVELATION_LABELS[r.kind];
  return (
    <li aria-label={label} className="flex flex-col gap-2 rounded-lg border border-[#2a3a40] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[16px] font-bold text-parchment">
          {index + 1}. {label}
        </span>
        <select
          aria-label={`${label} die`}
          value={r.die ?? ""}
          onChange={(e) => update.fire({ campaignId, kind: r.kind, die: e.target.value === "" ? null : Number(e.target.value) })}
          className={cn(FIELD, "min-h-9 text-[14px]")}
        >
          <option value="">No die</option>
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <option key={d} value={d}>
              d6: {d}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} status`}
          value={r.status}
          onChange={(e) => update.fire({ campaignId, kind: r.kind, status: e.target.value })}
          className={cn(FIELD, "min-h-9 text-[14px]")}
        >
          {REVELATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <textarea
        key={r.text}
        aria-label={`${label} text`}
        defaultValue={r.text}
        maxLength={TEXT_MAX}
        rows={2}
        placeholder="Roll the night sky, or write your own revelation."
        onBlur={(e) => {
          if (e.target.value.trim() !== r.text) update.fire({ campaignId, kind: r.kind, text: e.target.value });
        }}
        className={cn(FIELD, "py-2 font-serif")}
      />
      <p className="m-0 text-[12px] text-[#9fb2b6]">{REVELATION_EFFECTS[r.kind]}</p>
      <ErrorLine error={update.error} />
    </li>
  );
}

function PlayerRevelation({ index, revelation: r }: { index: number; revelation: Revelation }) {
  const label = REVELATION_LABELS[r.kind];
  return (
    <li aria-label={label} className="flex flex-col gap-1 rounded-lg border border-[#2a3a40] px-3 py-2">
      <span className="flex items-center gap-2 font-display text-[15px] font-bold text-parchment">
        {index + 1}. {label}
        {r.status === "achieved" ? <span className="font-sans text-[11px] tracking-[0.12em] text-brand uppercase">Achieved</span> : null}
      </span>
      {r.status === "hidden" ? (
        <span className="text-[14px] text-[#9fb2b6] italic">Not yet revealed.</span>
      ) : (
        <>
          <span className="font-serif text-[16px] text-[#e6ecea]">{r.text}</span>
          <span className="text-[12px] text-[#9fb2b6]">{REVELATION_EFFECTS[r.kind]}</span>
        </>
      )}
    </li>
  );
}

/** HF p.140: each player secretly writes one secret Forlorne is hiding. */
function ForlorneSecrets({ campaignId, isGm, secrets }: { campaignId: Id<"campaigns">; isGm: boolean; secrets: Secret[] }) {
  const submit = useIntent(api.trackers.weredragon.submitSecret);
  const setUsed = useIntent(api.trackers.weredragon.setSecretUsed);
  const [draft, setDraft] = useState("");
  return (
    <TrackerCard
      title="Forlorne’s Secrets"
      subtitle={isGm ? "Secrets your players wrote. Pick one between sessions to inspire what they uncover." : "Write a secret Forlorne is hiding. Only the GM will read it."}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await submit.fire({ campaignId, text: draft })) setDraft("");
        }}
      >
        <textarea
          aria-label="Secret Forlorne is hiding"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={TEXT_MAX}
          rows={2}
          placeholder="Forlorne is hiding…"
          className={cn(FIELD, "py-2 font-serif")}
        />
        <div className="flex items-center gap-2">
          <button type="submit" className={TRACKER_BTN} disabled={submit.pending || !draft.trim()}>
            Submit secret
          </button>
          <ErrorLine error={submit.error} />
        </div>
      </form>
      {secrets.length ? (
        <ul aria-label={isGm ? "Submitted secrets" : "Your secrets"} className="m-0 flex list-none flex-col gap-2 p-0">
          {secrets.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[#2a3a40] px-3 py-2">
              <span className={cn("font-serif text-[15px] text-[#e6ecea]", s.used && "text-[#9fb2b6] line-through")}>
                {s.text}
                {isGm && s.authorName ? <span className="ml-2 font-sans text-[12px] text-[#9fb2b6]">— {s.authorName}</span> : null}
              </span>
              {isGm ? (
                <label className="flex items-center gap-1.5 text-[13px] text-[#cfd8d6]">
                  <input type="checkbox" checked={s.used} onChange={(e) => setUsed.fire({ campaignId, secretId: s.id, used: e.target.checked })} />
                  Used
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorLine error={setUsed.error} />
    </TrackerCard>
  );
}
