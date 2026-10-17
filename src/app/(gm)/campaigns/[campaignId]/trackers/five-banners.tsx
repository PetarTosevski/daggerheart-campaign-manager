"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { canAdvanceCountdown, canCancelCountdown, canReverseCountdown } from "@/lib/domain/countdowns";
import {
  defaultPicks,
  formatRating,
  MAJOR_STEPS,
  MAX_RELATIONSHIP,
  MIN_RELATIONSHIP,
  MINOR_STEPS,
  NATION_IDS,
  NATION_NAMES,
  OBJECTIVE_KIND_LABEL,
  objectiveLimitError,
  pairKey,
  planWeekAdvance,
  relationshipLabel,
  SUGGESTED_OBJECTIVES,
  type NationId,
  type ObjectiveKind,
  type WeekPick,
} from "@/lib/frames/trackers/five-banners";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { TRACKER_BTN, TrackerCard } from "./tracker-card";

const fb = api.trackers.fiveBanners;
type View = NonNullable<FunctionReturnType<typeof fb.state>>;
type Nation = View["nations"][number];
type Objective = Nation["objectives"][number];
type Relationship = View["relationships"][number];

const INPUT = "min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]";
const DIALOG = "max-w-[560px] border-[#33444a] bg-[#121b1f]";

function ratingTone(value: number) {
  if (value <= -2) return "border-[#7a2a2a] bg-[#3a1414] text-[#ffb4ae]";
  if (value === -1) return "border-[#5a3a2a] bg-[#2a1c16] text-[#f0c4a8]";
  if (value === 0) return "border-[#33444a] bg-[#10181b] text-[#c9d2cf]";
  if (value === 1) return "border-[#2f5a4a] bg-[#14271f] text-[#bfe6d2]";
  return "border-[#2f6a5a] bg-[#123028] text-[#a8f0d0]";
}

function Errors({ messages }: { messages: (string | null)[] }) {
  return (
    <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
      {messages.filter(Boolean).join(" ")}
    </p>
  );
}

/** GM toggle: shows or hides one item from players. */
function RevealToggle({
  campaignId,
  label,
  revealed,
  target,
}: {
  campaignId: Id<"campaigns">;
  label: string;
  revealed: boolean;
  target:
    | { type: "relationship"; a: NationId; b: NationId }
    | { type: "sheet"; nation: NationId }
    | { type: "objective"; countdownId: Id<"countdowns"> };
}) {
  const toggle = useIntent(fb.toggleReveal);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        aria-pressed={revealed}
        aria-label={`Reveal ${label} to players`}
        disabled={toggle.pending}
        onClick={() => void toggle.fire({ campaignId, target, revealed: !revealed })}
        className={cn(TRACKER_BTN, "inline-flex items-center gap-1.5 text-[13px]", revealed ? "border-brand text-brand" : "text-[#8fa3a8]")}
      >
        {revealed ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
        {revealed ? "Shown" : "Hidden"}
      </button>
      <Errors messages={[toggle.error]} />
    </span>
  );
}

function RelationshipMatrix({ view, campaignId, gm }: { view: View; campaignId: Id<"campaigns">; gm: boolean }) {
  const byPair = new Map(view.relationships.map((r) => [pairKey(r.a, r.b), r]));
  const [selected, setSelected] = useState<[NationId, NationId] | null>(null);
  const current = selected ? byPair.get(pairKey(...selected)) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <h4 className="m-0 font-display text-[16px] font-bold text-parchment">Relationships</h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[340px] border-separate border-spacing-1 text-center text-[13px]">
          <caption className="sr-only">Relationship ratings between the nations, from Nemeses (−3) to Close Allies (+3)</caption>
          <thead>
            <tr>
              <td />
              {NATION_IDS.map((n) => (
                <th key={n} scope="col" className="px-1 pb-1 font-display text-[12px] font-semibold text-[#9fb2b6]">
                  {NATION_NAMES[n]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NATION_IDS.map((row) => (
              <tr key={row}>
                <th scope="row" className="pr-1 text-right font-display text-[12px] font-semibold text-[#9fb2b6]">
                  {NATION_NAMES[row]}
                </th>
                {NATION_IDS.map((col) => {
                  if (row === col) return <td key={col} aria-hidden="true" className="rounded-md bg-[#0d1417]" />;
                  const rel = byPair.get(pairKey(row, col));
                  const name = `${NATION_NAMES[row]} and ${NATION_NAMES[col]}`;
                  if (!rel) {
                    return (
                      <td key={col} className="h-11 rounded-md border border-dashed border-[#253338] text-[#55666b]" aria-label={`${name}: unknown`}>
                        ?
                      </td>
                    );
                  }
                  const isSelected = selected !== null && pairKey(...selected) === pairKey(row, col);
                  const body = (
                    <>
                      <span className="block font-display text-[15px] font-bold leading-tight">{rel.rating}</span>
                      <span className="block text-[10px] leading-tight">{rel.label}</span>
                    </>
                  );
                  return (
                    <td key={col} className="p-0">
                      {gm ? (
                        <button
                          type="button"
                          aria-label={`${name}: ${rel.label} (${rel.rating})${rel.revealed ? ", shown to players" : ""}`}
                          aria-pressed={isSelected}
                          onClick={() => setSelected([row, col])}
                          className={cn(
                            "relative min-h-11 w-full cursor-pointer rounded-md border px-1 py-1",
                            ratingTone(rel.value),
                            isSelected && "outline-2 outline-brand",
                          )}
                        >
                          {body}
                          {rel.revealed ? <Eye className="absolute top-0.5 right-0.5 size-3 opacity-70" aria-hidden="true" /> : null}
                        </button>
                      ) : (
                        <div className={cn("min-h-11 rounded-md border px-1 py-1", ratingTone(rel.value))} aria-label={`${name}: ${rel.label} (${rel.rating})`}>
                          {body}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gm && selected && current ? (
        <RelationshipEditor key={pairKey(...selected)} campaignId={campaignId} rel={current} />
      ) : gm ? (
        <p className="m-0 text-[13px] text-[#8fa3a8]">Pick a cell to change a relationship or reveal it to players.</p>
      ) : null}
    </div>
  );
}

function RelationshipEditor({ campaignId, rel }: { campaignId: Id<"campaigns">; rel: Relationship }) {
  const set = useIntent(fb.setRelationship);
  const name = `${NATION_NAMES[rel.a]}–${NATION_NAMES[rel.b]}`;
  const change = (delta: number) => void set.fire({ campaignId, a: rel.a, b: rel.b, value: rel.value + delta });
  return (
    <div role="group" aria-label={`${name} relationship`} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#253338] bg-[#10181b] p-3">
      <span className="flex-1 font-display text-[15px] text-parchment">{name}</span>
      <button type="button" className={TRACKER_BTN} aria-label={`Worsen ${name} relationship`} disabled={set.pending || rel.value <= MIN_RELATIONSHIP} onClick={() => change(-1)}>
        −
      </button>
      <span className={cn("min-w-[120px] rounded-md border px-2 py-1.5 text-center text-[14px]", ratingTone(rel.value))} data-testid="relationship-value">
        {relationshipLabel(rel.value)} ({formatRating(rel.value)})
      </span>
      <button type="button" className={TRACKER_BTN} aria-label={`Improve ${name} relationship`} disabled={set.pending || rel.value >= MAX_RELATIONSHIP} onClick={() => change(1)}>
        +
      </button>
      <RevealToggle campaignId={campaignId} label={`${name} relationship`} revealed={rel.revealed} target={{ type: "relationship", a: rel.a, b: rel.b }} />
      <Errors messages={[set.error]} />
    </div>
  );
}

function ObjectiveRow({ objective, campaignId, gm }: { objective: Objective; campaignId: Id<"campaigns">; gm: boolean }) {
  const operate = useIntent(fb.operateObjective);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { _id: countdownId, name, currentValue: value, startingValue: start, status } = objective;
  const done = status === "completed";
  const act = (action: "advance" | "reverse" | "pause" | "resume" | "cancel" | "dismiss") => void operate.fire({ countdownId, action });

  return (
    <li aria-label={name} data-status={status} className={cn("flex flex-col gap-2 rounded-[10px] border bg-[#10181b] p-3", done ? "border-danger-line" : "border-[#253338]")}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-[#e6ecea]">{name}</span>
          <span className="text-[11px] tracking-[0.12em] text-[#8fa3a8] uppercase">
            {OBJECTIVE_KIND_LABEL[objective.kind]}
            {status === "paused" ? " · Paused" : ""}
          </span>
          {gm && objective.notes ? <span className="text-[12px] text-[#9fb2b6]">{objective.notes}</span> : null}
        </div>
        <span className="flex-none font-display text-[18px] font-black text-[#f4efe6]" aria-label={`${value} of ${start}`} data-testid="objective-value">
          {value}
          <span className="text-[11px] text-[#8fa3a8]">/{start}</span>
        </span>
      </div>
      <div className="flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: start }, (_, k) => (
          <span key={k} className={cn("h-2 flex-1 rounded-full", k < value ? (done ? "bg-[#c0423a]" : "bg-brand") : "border border-dashed border-[#5a4a2e]")} />
        ))}
      </div>
      {done ? (
        <p role="status" className="m-0 text-[13px] text-[#ffd9d6]">
          Objective complete. Pick a new objective from the fiction and start a new countdown.
        </p>
      ) : null}
      {gm ? (
        <div className="flex flex-wrap items-center gap-2">
          {done ? (
            <button type="button" className={TRACKER_BTN} disabled={operate.pending} onClick={() => act("dismiss")}>
              Dismiss
            </button>
          ) : (
            <>
              <button
                type="button"
                className={cn(TRACKER_BTN, "border-transparent bg-brand font-bold text-brand-ink hover:bg-brand")}
                aria-label={`Tick ${name} down one`}
                disabled={operate.pending || !canAdvanceCountdown(status, value)}
                onClick={() => act("advance")}
              >
                Tick −1
              </button>
              <button type="button" className={TRACKER_BTN} aria-label={`Set ${name} back one`} disabled={operate.pending || !canReverseCountdown(status, value, start)} onClick={() => act("reverse")}>
                +1
              </button>
              <button type="button" className={TRACKER_BTN} disabled={operate.pending} onClick={() => act(status === "paused" ? "resume" : "pause")}>
                {status === "paused" ? "Resume" : "Pause"}
              </button>
            </>
          )}
          {done ? (
            <button type="button" className={TRACKER_BTN} aria-label={`Set ${name} back one`} disabled={operate.pending} onClick={() => act("reverse")}>
              Reopen
            </button>
          ) : null}
          <span className="flex-1" />
          <RevealToggle campaignId={campaignId} label={name} revealed={objective.revealed} target={{ type: "objective", countdownId }} />
        </div>
      ) : null}
      {gm && canCancelCountdown(status) ? (
        confirmCancel ? (
          <div role="alertdialog" aria-label={`Cancel ${name}`} className="flex flex-wrap items-center gap-2 text-[13px] text-[#ffd9d6]">
            <span className="flex-1">Abandon this objective?</span>
            <button type="button" className={TRACKER_BTN} onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
            <button type="button" className={cn(TRACKER_BTN, "border-transparent bg-danger-solid font-semibold text-white hover:bg-danger-solid")} disabled={operate.pending} onClick={() => act("cancel")}>
              Abandon
            </button>
          </div>
        ) : (
          <button type="button" className="min-h-10 self-end text-[12px] text-[#8fa3a8] underline-offset-4 hover:underline" onClick={() => setConfirmCancel(true)}>
            Abandon objective…
          </button>
        )
      ) : null}
      <Errors messages={[operate.error]} />
    </li>
  );
}

function NewObjectiveDialog({ campaignId, nation, open, onClose }: { campaignId: Id<"campaigns">; nation: Nation; open: boolean; onClose: () => void }) {
  const create = useIntent(fb.createObjective);
  const limit = (kind: ObjectiveKind) => objectiveLimitError(nation.objectives, kind);
  const initialKind: ObjectiveKind = limit("objective-major") ? "objective-minor" : "objective-major";
  const [kind, setKind] = useState<ObjectiveKind>(initialKind);
  const [steps, setSteps] = useState<number>(initialKind === "objective-major" ? MAJOR_STEPS : MINOR_STEPS[0]);
  const close = () => {
    create.clearError();
    onClose();
  };
  const pickKind = (k: ObjectiveKind) => {
    setKind(k);
    setSteps(k === "objective-major" ? MAJOR_STEPS : MINOR_STEPS[0]);
  };
  const suggestions = SUGGESTED_OBJECTIVES[nation.id][kind === "objective-major" ? "major" : "minor"];
  const listId = `fb-suggest-${nation.id}`;

  return (
    <Modal open={open} onClose={close} title={`${nation.name} objective`} className={DIALOG}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (create.pending) return;
          const form = new FormData(event.currentTarget);
          const created = await create.fire({
            campaignId,
            nation: nation.id,
            kind,
            steps,
            name: String(form.get("name") ?? ""),
            notes: String(form.get("notes") ?? ""),
          });
          if (created) close();
        }}
      >
        <div role="radiogroup" aria-label="Objective size" className="grid grid-cols-2 gap-2">
          {(["objective-major", "objective-minor"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              disabled={limit(k) !== null}
              title={limit(k) ?? undefined}
              onClick={() => pickKind(k)}
              className={cn(TRACKER_BTN, "min-h-11", kind === k && "border-brand bg-brand font-bold text-brand-ink hover:bg-brand")}
            >
              {k === "objective-major" ? `Major (${MAJOR_STEPS} steps)` : "Minor (4–6 steps)"}
            </button>
          ))}
        </div>
        {kind === "objective-minor" ? (
          <div role="radiogroup" aria-label="Steps" className="grid grid-cols-3 gap-2">
            {MINOR_STEPS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={steps === n}
                onClick={() => setSteps(n)}
                className={cn(TRACKER_BTN, "min-h-11 font-display text-[18px]", steps === n && "border-brand bg-brand font-bold text-brand-ink hover:bg-brand")}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
        <input name="name" required maxLength={150} list={listId} aria-label="Objective" placeholder="What is the nation working toward?" className={INPUT} />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <input name="notes" maxLength={1000} aria-label="GM notes" placeholder="GM notes (never shown to players)" className={INPUT} />
        {create.error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {create.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={TRACKER_BTN} onClick={close}>
            Cancel
          </button>
          <BrandButton type="submit" variant="solid" disabled={create.pending || limit(kind) !== null}>
            Start at {steps}
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}

function SheetDialog({ campaignId, nation, open, onClose }: { campaignId: Id<"campaigns">; nation: Nation; open: boolean; onClose: () => void }) {
  const save = useIntent(fb.setNationSheet);
  const close = () => {
    save.clearError();
    onClose();
  };
  const lines = (value: FormDataEntryValue | null) => String(value ?? "").split("\n");
  return (
    <Modal open={open} onClose={close} title={`${nation.name} sheet`} className={DIALOG}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (save.pending) return;
          const form = new FormData(event.currentTarget);
          const saved = await save.fire({ campaignId, nation: nation.id, assets: lines(form.get("assets")), problems: lines(form.get("problems")) });
          if (saved) close();
        }}
      >
        <p className="m-0 text-[13px] text-[#9fb2b6]">One per line.</p>
        <label className="flex flex-col gap-1 text-[13px] text-[#9fb2b6]">
          Assets
          <textarea name="assets" rows={5} defaultValue={nation.sheet?.assets.join("\n")} className={cn(INPUT, "py-2")} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-[#9fb2b6]">
          Problems
          <textarea name="problems" rows={4} defaultValue={nation.sheet?.problems.join("\n")} className={cn(INPUT, "py-2")} />
        </label>
        {save.error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {save.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={TRACKER_BTN} onClick={close}>
            Cancel
          </button>
          <BrandButton type="submit" variant="solid" disabled={save.pending}>
            Save
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}

function NationCard({ nation, campaignId, gm }: { nation: Nation; campaignId: Id<"campaigns">; gm: boolean }) {
  const [dialog, setDialog] = useState<"objective" | "sheet" | null>(null);
  const objectivesFull = objectiveLimitError(nation.objectives, "objective-major") !== null && objectiveLimitError(nation.objectives, "objective-minor") !== null;

  return (
    <article aria-label={nation.name} className="flex flex-col gap-3 rounded-[12px] border border-[#253338] bg-[#162227] p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="m-0 font-display text-[18px] font-bold text-parchment">{nation.name}</h4>
        {gm ? <RevealToggle campaignId={campaignId} label={`${nation.name} sheet`} revealed={nation.sheetRevealed} target={{ type: "sheet", nation: nation.id }} /> : null}
      </div>
      {nation.sheet ? (
        <dl className="m-0 flex flex-col gap-2 text-[13px]">
          {(["assets", "problems"] as const).map((field) => (
            <div key={field}>
              <dt className="text-[11px] tracking-[0.14em] text-[#8fa3a8] uppercase">{field === "assets" ? "Assets" : "Problems"}</dt>
              <dd className="m-0 text-[#c9d2cf]">{nation.sheet![field].length ? nation.sheet![field].join(" · ") : "None"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {gm ? (
        <button type="button" className={cn(TRACKER_BTN, "self-start text-[13px]")} aria-label={`Edit ${nation.name} assets and problems`} onClick={() => setDialog("sheet")}>
          Edit sheet
        </button>
      ) : null}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] tracking-[0.14em] text-[#8fa3a8] uppercase">Objectives</span>
        {nation.objectives.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {nation.objectives.map((o) => (
              <ObjectiveRow key={o._id} objective={o} campaignId={campaignId} gm={gm} />
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-[#8fa3a8]">{gm ? "No objective countdowns yet." : "None revealed."}</p>
        )}
        {gm ? (
          <button
            type="button"
            className={cn(TRACKER_BTN, "text-[13px]")}
            aria-label={`New ${nation.name} objective`}
            disabled={objectivesFull}
            title={objectivesFull ? "One major and two minor objectives at a time." : undefined}
            onClick={() => setDialog("objective")}
          >
            + Objective
          </button>
        ) : null}
      </div>
      {gm && dialog === "objective" ? <NewObjectiveDialog campaignId={campaignId} nation={nation} open onClose={() => setDialog(null)} /> : null}
      {gm && dialog === "sheet" ? <SheetDialog campaignId={campaignId} nation={nation} open onClose={() => setDialog(null)} /> : null}
    </article>
  );
}

type WeekResult = FunctionReturnType<typeof fb.advanceWeek>;

function AdvanceWeekDialog({ view, campaignId, onClose, onDone }: { view: View; campaignId: Id<"campaigns">; onClose: () => void; onDone: (r: WeekResult) => void }) {
  const advance = useIntent(fb.advanceWeek);
  const objectives = view.nations.flatMap((n) =>
    n.objectives.map((o) => ({ id: o._id as string, nation: n.id, name: o.name, status: o.status, currentValue: o.currentValue })),
  );
  const [picks, setPicks] = useState<WeekPick[]>(() => defaultPicks(objectives));
  const pickFor = (nation: NationId) => picks.find((p) => p.nation === nation)?.objectiveId ?? "";
  const choose = (nation: NationId, id: string) =>
    setPicks((prev) => [...prev.filter((p) => p.nation !== nation), ...(id ? [{ nation, objectiveId: id }] : [])]);
  let warning: string | null = null;
  try {
    warning = planWeekAdvance(objectives, picks).warning;
  } catch {
    warning = null;
  }

  return (
    <Modal open onClose={onClose} title={`Advance to week ${view.week + 1}`} className={DIALOG}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (advance.pending) return;
          const result = await advance.fire({
            campaignId,
            picks: picks.map((p) => ({ nation: p.nation, objectiveId: p.objectiveId as Id<"countdowns"> })),
          });
          if (result) onDone(result);
        }}
      >
        <p className="m-0 text-[14px] text-[#9fb2b6]">Each in-game week, pick one countdown for each nation to tick down.</p>
        {view.nations.map((nation) => {
          const options = nation.objectives.filter((o) => o.status === "active" && o.currentValue > 0);
          return (
            <fieldset key={nation.id} className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 font-display text-[15px] font-bold text-parchment">{nation.name}</legend>
              {options.map((o) => (
                <label key={o._id} className="flex min-h-10 cursor-pointer items-center gap-2 text-[14px] text-[#e6ecea]">
                  <input type="radio" name={`pick-${nation.id}`} className="size-5 accent-brand" checked={pickFor(nation.id) === o._id} onChange={() => choose(nation.id, o._id)} />
                  <span className="flex-1">{o.name}</span>
                  <span className="text-[13px] text-[#9fb2b6]">
                    {o.currentValue} → {o.currentValue - 1}
                  </span>
                </label>
              ))}
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[14px] text-[#9fb2b6]">
                <input type="radio" name={`pick-${nation.id}`} className="size-5 accent-brand" checked={pickFor(nation.id) === ""} onChange={() => choose(nation.id, "")} />
                {options.length ? "Skip this week" : "No running objectives"}
              </label>
            </fieldset>
          );
        })}
        {warning ? (
          <p role="alert" className="m-0 rounded-lg border border-[#7a5a2e] bg-[#2a2014] px-3 py-2 text-[13px] text-[#ffd9a8]">
            {warning}
          </p>
        ) : null}
        {advance.error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {advance.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={TRACKER_BTN} onClick={onClose}>
            Cancel
          </button>
          <BrandButton type="submit" variant="solid" disabled={advance.pending}>
            Advance week
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}

/** Five Banners Burning (Core Book pp.268-269): faction relationships, nation sheets and objective countdowns. */
export function FiveBannersTracker({ campaign }: { campaign: CampaignSummary }) {
  const view = useQuery(fb.state, { campaignId: campaign._id });
  const [advancing, setAdvancing] = useState(false);
  const [lastWeek, setLastWeek] = useState<WeekResult | null>(null);
  if (view === undefined) return <p className="text-[#9fb2b6]">Loading the Five Banners…</p>;
  if (view === null) return null;
  const gm = view.role === "gm";
  const nations = gm ? view.nations : view.nations.filter((n) => n.sheet !== null || n.objectives.length > 0);
  const nothingRevealed = !gm && nations.length === 0 && view.relationships.length === 0;

  return (
    <TrackerCard
      title="Five Banners"
      subtitle={`Week ${view.week} · Faction relationships & objective countdowns`}
      actions={
        gm ? (
          <button type="button" className={cn(TRACKER_BTN, "min-h-11 px-4")} onClick={() => setAdvancing(true)}>
            Advance week
          </button>
        ) : null
      }
    >
      <p role="status" aria-live="polite" className="m-0 text-[14px] text-[#c9d2cf] empty:hidden" data-testid="week-result">
        {lastWeek
          ? [
              `Week ${lastWeek.week} begins.`,
              ...lastWeek.completed.map((c) => `${NATION_NAMES[c.nation]} completed “${c.name}”: pick a new objective.`),
              lastWeek.warning ?? "",
            ]
              .filter(Boolean)
              .join(" ")
          : ""}
      </p>
      {nothingRevealed ? (
        <p className="m-0 rounded-[12px] border-2 border-dashed border-[#33444a] p-5 text-center text-[14px] text-[#9fb2b6]">
          Your GM hasn’t revealed any relationships or objectives yet.
        </p>
      ) : (
        <>
          {gm || view.relationships.length ? <RelationshipMatrix view={view} campaignId={campaign._id} gm={gm} /> : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {nations.map((n) => (
              <NationCard key={n.id} nation={n} campaignId={campaign._id} gm={gm} />
            ))}
          </div>
        </>
      )}
      {gm && advancing ? (
        <AdvanceWeekDialog
          view={view}
          campaignId={campaign._id}
          onClose={() => setAdvancing(false)}
          onDone={(result) => {
            setLastWeek(result);
            setAdvancing(false);
          }}
        />
      ) : null}
    </TrackerCard>
  );
}
