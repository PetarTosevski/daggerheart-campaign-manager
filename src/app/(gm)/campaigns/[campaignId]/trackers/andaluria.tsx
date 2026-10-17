"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import {
  BEAT_HINTS,
  BEAT_LABELS,
  FIELD_MAX,
  HUNT_BEATS,
  SUGGESTED_CLUES,
  type Hunt,
  type HuntPatch,
  type PlayerHunt,
} from "@/lib/frames/trackers/andaluria";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { TRACKER_BTN, TrackerCard } from "./tracker-card";

const FIELD = "rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]";

type View = FunctionReturnType<typeof api.trackers.andaluria.get>;

function ErrorLine({ error }: { error: string | null }) {
  return (
    <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
      {error}
    </p>
  );
}

function CluesBadge() {
  return (
    <span className="rounded-full border border-brand px-2 py-0.5 text-[11px] font-medium tracking-[0.12em] text-brand uppercase">
      All clues revealed
    </span>
  );
}

/** Dark Heart of Andaluria: Hunts and their Liminal Clues (HF pp.154-155). */
export function AndaluriaTracker({ campaign }: { campaign: CampaignSummary }) {
  const view = useQuery(api.trackers.andaluria.get, { campaignId: campaign._id });
  if (view === undefined) return null;
  return view.role === "gm" ? <GmHunts campaignId={campaign._id} hunts={view.hunts} /> : <PlayerHunts hunts={view.hunts} />;
}

function PlayerHunts({ hunts }: { hunts: PlayerHunt[] }) {
  const active = hunts.filter((h) => !h.archived);
  const archived = hunts.filter((h) => h.archived);
  const card = (h: PlayerHunt) => (
    <li key={h.id} aria-label={h.title} className="flex flex-col gap-2 rounded-lg border border-[#2a3a40] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[17px] font-bold text-parchment">{h.title}</span>
        <span className="text-[12px] tracking-[0.12em] text-[#9fb2b6] uppercase">{BEAT_LABELS[h.beat]}</span>
        {h.allCluesRevealed ? <CluesBadge /> : null}
      </div>
      {h.monster ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
          {MONSTER_FIELDS.map(([k, label]) =>
            h.monster?.[k] ? (
              <div key={k} className="contents">
                <dt className="text-[#9fb2b6]">{label}</dt>
                <dd className="m-0 text-[#e6ecea]">{h.monster[k]}</dd>
              </div>
            ) : null,
          )}
        </dl>
      ) : null}
      {h.clues.length ? (
        <ul aria-label={`Clues for ${h.title}`} className="m-0 flex list-disc flex-col gap-1 pl-5 font-serif text-[15px] text-[#e6ecea]">
          {h.clues.map((c) => (
            <li key={c.id}>{c.text}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-[#9fb2b6] italic">No clues have surfaced yet.</p>
      )}
    </li>
  );
  return (
    <TrackerCard title="The Hunt" subtitle="Clues that have become solid.">
      {active.length ? (
        <ul aria-label="Hunts" className="m-0 flex list-none flex-col gap-2.5 p-0">
          {active.map(card)}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-[#9fb2b6]">No hunt is under way.</p>
      )}
      {archived.length ? (
        <details>
          <summary className="cursor-pointer text-[14px] text-[#9fb2b6]">Past hunts ({archived.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2.5 p-0">{archived.map(card)}</ul>
        </details>
      ) : null}
    </TrackerCard>
  );
}

const MONSTER_FIELDS = [
  ["monster", "Monster"],
  ["what", "What is it?"],
  ["wants", "What does it want?"],
  ["where", "Where can you find it?"],
  ["defeat", "How can you defeat it?"],
] as const;

function GmHunts({ campaignId, hunts }: { campaignId: Id<"campaigns">; hunts: Extract<View, { role: "gm" }>["hunts"] }) {
  const create = useIntent(api.trackers.andaluria.createHunt);
  const [title, setTitle] = useState("");
  const active = hunts.filter((h) => !h.archived);
  const archived = hunts.filter((h) => h.archived);
  return (
    <TrackerCard title="The Hunt" subtitle="Players see each hunt’s name, beat and revealed clues only." className="gap-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await create.fire({ campaignId, title })) setTitle("");
        }}
      >
        <input
          aria-label="New hunt name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Name a new hunt (e.g. The Drowned Bell)"
          className={cn(FIELD, "min-h-10 flex-1")}
        />
        <button type="submit" className={TRACKER_BTN} disabled={create.pending || !title.trim()}>
          New hunt
        </button>
        <ErrorLine error={create.error} />
      </form>
      {active.length ? (
        <ul aria-label="Hunts" className="m-0 flex list-none flex-col gap-3 p-0">
          {active.map((h) => (
            <GmHunt key={h.id} campaignId={campaignId} hunt={h} allRevealed={h.allCluesRevealed} />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-[#9fb2b6]">No hunt is under way.</p>
      )}
      {archived.length ? (
        <details>
          <summary className="cursor-pointer text-[14px] text-[#9fb2b6]">Archived hunts ({archived.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
            {archived.map((h) => (
              <GmHunt key={h.id} campaignId={campaignId} hunt={h} allRevealed={h.allCluesRevealed} />
            ))}
          </ul>
        </details>
      ) : null}
    </TrackerCard>
  );
}

/** A text field that saves on blur; remounts (via `key`) when the stored value changes. */
function SavedField({
  label,
  value,
  multiline = false,
  maxLength = FIELD_MAX,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  maxLength?: number;
  onSave: (next: string) => void;
}) {
  const common = {
    "aria-label": label,
    defaultValue: value,
    maxLength,
    placeholder: label,
    onBlur: (e: { target: { value: string } }) => {
      if (e.target.value.trim() !== value) onSave(e.target.value);
    },
  };
  return multiline ? (
    <textarea key={value} rows={2} {...common} className={cn(FIELD, "py-2")} />
  ) : (
    <input key={value} {...common} className={cn(FIELD, "min-h-10")} />
  );
}

const toLines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function GmHunt({ campaignId, hunt: h, allRevealed }: { campaignId: Id<"campaigns">; hunt: Hunt; allRevealed: boolean }) {
  const update = useIntent(api.trackers.andaluria.updateHunt);
  const remove = useIntent(api.trackers.andaluria.deleteHunt);
  const addClue = useIntent(api.trackers.andaluria.createClue);
  const [clue, setClue] = useState("");
  const save = (patch: HuntPatch) => update.fire({ campaignId, huntId: h.id, patch });
  const revealedCount = h.clues.filter((c) => c.revealed).length;

  return (
    <li aria-label={h.title} className="flex flex-col gap-3 rounded-lg border border-[#2a3a40] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[18px] font-bold text-parchment">{h.title}</span>
        {allRevealed ? <CluesBadge /> : null}
        {h.archived ? <span className="text-[12px] tracking-[0.12em] text-[#9fb2b6] uppercase">Archived</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
        <SavedField label="Hunt name" value={h.title} maxLength={100} onSave={(title) => save({ title })} />
        <select
          aria-label={`Beat for ${h.title}`}
          value={h.beat}
          onChange={(e) => save({ beat: e.target.value as Hunt["beat"] })}
          className={cn(FIELD, "min-h-10")}
        >
          {HUNT_BEATS.map((b) => (
            <option key={b} value={b}>
              {BEAT_LABELS[b]}
            </option>
          ))}
        </select>
      </div>
      <p className="m-0 text-[12px] text-[#9fb2b6]">{BEAT_HINTS[h.beat]}</p>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-semibold tracking-[0.08em] text-[#cfd8d6] uppercase">The monster (GM only)</legend>
        {MONSTER_FIELDS.map(([k, label]) => (
          <SavedField key={k} label={label} value={h[k]} multiline={k !== "monster"} onSave={(next) => save({ [k]: next })} />
        ))}
        <label className="flex items-center gap-2 text-[14px] text-[#cfd8d6]">
          <input type="checkbox" checked={h.monsterRevealed} onChange={(e) => save({ monsterRevealed: e.target.checked })} />
          Reveal monster to players
        </label>
      </fieldset>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SavedField
          label="Underlings (one per line)"
          value={h.underlings.join("\n")}
          multiline
          onSave={(next) => save({ underlings: toLines(next) })}
        />
        <SavedField
          label="Bystanders (one per line)"
          value={h.bystanders.join("\n")}
          multiline
          onSave={(next) => save({ bystanders: toLines(next) })}
        />
      </div>

      <section aria-label={`Liminal clues for ${h.title}`} className="flex flex-col gap-2">
        <h4 className="m-0 text-[13px] font-semibold tracking-[0.08em] text-[#cfd8d6] uppercase">
          Liminal clues {revealedCount}/{h.clues.length}
          <span className="ml-2 font-normal tracking-normal text-[#9fb2b6] normal-case">
            (prepare {SUGGESTED_CLUES.min} to {SUGGESTED_CLUES.max}; revealing one makes it solid for players)
          </span>
        </h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {h.clues.map((c, i) => (
            <ClueRow key={c.id} campaignId={campaignId} huntId={h.id} clue={c} n={i + 1} />
          ))}
        </ul>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await addClue.fire({ campaignId, huntId: h.id, text: clue })) setClue("");
          }}
        >
          <input
            aria-label={`New clue for ${h.title}`}
            value={clue}
            onChange={(e) => setClue(e.target.value)}
            maxLength={FIELD_MAX}
            placeholder="A fact, a sign, or a symptom of the monster’s nature"
            className={cn(FIELD, "min-h-10 flex-1")}
          />
          <button type="submit" className={TRACKER_BTN} disabled={addClue.pending || !clue.trim()}>
            Add clue
          </button>
        </form>
        <ErrorLine error={addClue.error} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={TRACKER_BTN} onClick={() => save({ archived: !h.archived })}>
          {h.archived ? "Restore hunt" : "Archive hunt"}
        </button>
        <button
          type="button"
          className={TRACKER_BTN}
          disabled={remove.pending}
          onClick={() => {
            if (window.confirm(`Delete “${h.title}” and its clues?`)) remove.fire({ campaignId, huntId: h.id });
          }}
        >
          Delete hunt
        </button>
        <ErrorLine error={update.error ?? remove.error} />
      </div>
    </li>
  );
}

function ClueRow({ campaignId, huntId, clue: c, n }: { campaignId: Id<"campaigns">; huntId: string; clue: Hunt["clues"][number]; n: number }) {
  const update = useIntent(api.trackers.andaluria.updateClue);
  const remove = useIntent(api.trackers.andaluria.deleteClue);
  return (
    <li className={cn("flex flex-col gap-1.5 rounded-lg border px-3 py-2", c.revealed ? "border-brand/60" : "border-dashed border-[#33444a]")}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[13px] text-[#cfd8d6]">
          <input
            type="checkbox"
            checked={c.revealed}
            aria-label={`Clue ${n} revealed`}
            onChange={(e) => update.fire({ campaignId, huntId, clueId: c.id, patch: { revealed: e.target.checked } })}
          />
          {c.revealed ? "Solid" : "Potential"}
        </label>
        <button
          type="button"
          className="ml-auto cursor-pointer text-[12px] text-[#9fb2b6] underline underline-offset-4"
          onClick={() => remove.fire({ campaignId, huntId, clueId: c.id })}
        >
          Remove
        </button>
      </div>
      <SavedField label={`Clue ${n}`} value={c.text} onSave={(text) => update.fire({ campaignId, huntId, clueId: c.id, patch: { text } })} />
      <SavedField
        label={`Clue ${n} GM note`}
        value={c.note}
        onSave={(note) => update.fire({ campaignId, huntId, clueId: c.id, patch: { note } })}
      />
      <ErrorLine error={update.error ?? remove.error} />
    </li>
  );
}
