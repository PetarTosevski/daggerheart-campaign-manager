"use client";

import { useId, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { COUNTDOWN_CATEGORIES, COUNTDOWN_VISIBILITY_PRESETS, MAX_COUNTDOWN_START, type CountdownCategory } from "@/lib/domain/countdowns";
import {
  COUNTDOWN_DICE_SIDES,
  DYNAMIC_ADVANCEMENT,
  MAX_COUNTDOWN_DICE,
  type CountdownDiceSides,
  type CountdownRepeat,
} from "@/lib/domain/countdowns/advanced";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

import { BTN, CATEGORY_LABEL } from "./shared";
import { choiceOf, VisibilityPicker, visibilityOf } from "./visibility";

const NEW_COUNTDOWN_VISIBILITY = choiceOf(COUNTDOWN_VISIBILITY_PRESETS.public);

/** The types this dialog creates (long-term and chase have their own, K3 / K4). CB p.162. */
type DialogMode = "standard" | "progress" | "consequence";
const TYPES: { mode: DialogMode; label: string; hint: string }[] = [
  { mode: "standard", label: "Standard", hint: "Ticks down 1 on every action roll, whatever the result." },
  { mode: "progress", label: "Progress", hint: "The party works toward it: their successes tick it down." },
  { mode: "consequence", label: "Consequence", hint: "The party tries to avoid it: their failures tick it down." },
];

/** CB p.163, Randomized Starting Value, Loop, Increasing or Decreasing. */
const REPEATS: { repeat: CountdownRepeat | "none"; label: string; hint: string }[] = [
  { repeat: "none", label: "No repeat", hint: "It ends when it triggers." },
  { repeat: "loop", label: "Loop", hint: "After it triggers, it resets to its starting value and counts down again." },
  { repeat: "increasing", label: "Increasing", hint: "Like a loop, but each reset starts one higher (8, then 9, then 10…)." },
  { repeat: "decreasing", label: "Decreasing", hint: "Like a loop, but each reset starts one lower (8, then 7…). At 0, a major event triggers." },
];

/** The Dynamic Countdown Advancement table's rows (CB p.163), best result first. */
export const OUTCOME_ROWS: { outcome: keyof typeof DYNAMIC_ADVANCEMENT; label: string }[] = [
  { outcome: "critical", label: "Critical Success" },
  { outcome: "successHope", label: "Success with Hope" },
  { outcome: "successFear", label: "Success with Fear" },
  { outcome: "failHope", label: "Failure with Hope" },
  { outcome: "failFear", label: "Failure with Fear" },
];

/** "Critical Success −3, Success with Hope −2, …" for a dynamic countdown's tooltip. */
export function advancementLine(mode: "progress" | "consequence"): string {
  return OUTCOME_ROWS.map(({ outcome, label }) => {
    const n = DYNAMIC_ADVANCEMENT[outcome][mode];
    return `${label} ${n === 0 ? "0" : `−${n}`}`;
  }).join(", ");
}

/** CB p.163, the Dynamic Countdown Advancement table, highlighting the chosen column. */
function AdvancementTable({ mode }: { mode: "progress" | "consequence" }) {
  return (
    <table className="w-full border-collapse text-[13px] text-[#c9d2cf]">
      <caption className="pb-1 text-left text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Ticks per action roll</caption>
      <thead>
        <tr className="text-[#8fa3a8]">
          <th scope="col" className="py-1 text-left font-normal">
            Result
          </th>
          <th scope="col" className={cn("py-1 text-right font-normal", mode === "progress" && "text-brand")}>
            Progress
          </th>
          <th scope="col" className={cn("py-1 text-right font-normal", mode === "consequence" && "text-brand")}>
            Consequence
          </th>
        </tr>
      </thead>
      <tbody>
        {OUTCOME_ROWS.map(({ outcome, label }) => (
          <tr key={outcome} className="border-t border-[#253338]">
            <th scope="row" className="py-1 text-left font-normal">
              {label}
            </th>
            {(["progress", "consequence"] as const).map((m) => (
              <td key={m} className={cn("py-1 text-right tabular-nums", m === mode ? "font-semibold text-[#f4efe6]" : "text-[#6f8287]")}>
                {DYNAMIC_ADVANCEMENT[outcome][m] === 0 ? "—" : `−${DYNAMIC_ADVANCEMENT[outcome][m]}`}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One option of a radio group in the dashboard's card look. */
function Choice({ name, label, hint, checked, onChange }: { name: string; label: string; hint: string; checked: boolean; onChange: () => void }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer flex-col gap-1 rounded-[10px] border px-3 py-2 text-[14px] text-[#e6ecea]",
        checked ? "border-brand bg-[#1d2a2e]" : "border-[#33444a] bg-[#141e22] hover:border-brand",
      )}
    >
      <span className="flex items-center gap-2 font-semibold">
        <input type="radio" name={name} aria-label={label} checked={checked} onChange={onChange} className="size-4 flex-none accent-[var(--brand)]" />
        {label}
      </span>
      <span className="text-[12px] text-[#8fa3a8]">{hint}</span>
    </label>
  );
}

const SELECT = "min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]";

/** The GM's "New countdown" dialog: details, type, a fixed or rolled start, repeats, armed, who sees it. */
export function NewCountdownDialog({ campaignId, open, onClose }: { campaignId: Id<"campaigns">; open: boolean; onClose: () => void }) {
  const create = useIntent(api.countdowns.create);
  const ids = useId();
  const [start, setStart] = useState(6);
  const [visibility, setVisibility] = useState(NEW_COUNTDOWN_VISIBILITY);
  const [mode, setMode] = useState<DialogMode>("standard");
  const [rolled, setRolled] = useState(false);
  const [diceCount, setDiceCount] = useState(1);
  const [diceSides, setDiceSides] = useState<CountdownDiceSides>(6);
  const [repeat, setRepeat] = useState<CountdownRepeat | "none">("none");
  const [armed, setArmed] = useState(true);
  // The form unmounts on close (Modal renders children only while open); reset the pickers too.
  const close = () => {
    setStart(6);
    setVisibility(NEW_COUNTDOWN_VISIBILITY);
    setMode("standard");
    setRolled(false);
    setDiceCount(1);
    setDiceSides(6);
    setRepeat("none");
    setArmed(true);
    create.clearError();
    onClose();
  };
  const formula = `${diceCount}d${diceSides}`;

  return (
    <Modal open={open} onClose={close} title="New countdown" className="max-w-[560px] border-[#33444a] bg-[#121b1f]">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (create.pending) return;
          const form = new FormData(event.currentTarget);
          // Intents only: the server rolls the dice and keeps the formula (R5, D8).
          const created = await create.fire({
            campaignId,
            name: String(form.get("name") ?? ""),
            consequence: String(form.get("consequence") ?? ""),
            description: String(form.get("description") ?? ""),
            category: String(form.get("category")) as CountdownCategory,
            ...(rolled ? { startDice: { count: diceCount, sides: diceSides } } : { startingValue: start }),
            mode,
            ...(repeat !== "none" ? { repeat } : {}),
            armed,
            visibility: visibilityOf(visibility),
          });
          if (created) close();
        }}
      >
        <div className="flex flex-col gap-2">
          <input
            name="name"
            required
            maxLength={100}
            aria-label="Countdown name"
            placeholder="Countdown name (e.g. The Fanewraith strikes Alula)"
            className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
          />
          <input
            name="consequence"
            maxLength={1000}
            aria-label="What happens at zero"
            placeholder="What happens at zero?"
            className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr]">
            <select name="category" aria-label="Category" defaultValue="threat" className={SELECT}>
              {COUNTDOWN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              name="description"
              maxLength={1000}
              aria-label="Notes"
              placeholder="Notes (optional)"
              className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
            />
          </div>
        </div>

        <VisibilityPicker value={visibility} onChange={setVisibility} />

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">Type</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TYPES.map((t) => (
              <Choice key={t.mode} name={`${ids}-type`} label={t.label} hint={t.hint} checked={mode === t.mode} onChange={() => setMode(t.mode)} />
            ))}
          </div>
          {mode === "standard" ? null : <AdvancementTable mode={mode} />}
        </fieldset>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">Start</legend>
          <div className="grid grid-cols-2 gap-2">
            <Choice name={`${ids}-start`} label="A number" hint="Such as Countdown 4." checked={!rolled} onChange={() => setRolled(false)} />
            <Choice name={`${ids}-start`} label="Roll dice" hint="Rolled when you start it." checked={rolled} onChange={() => setRolled(true)} />
          </div>
          {rolled ? (
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Number of dice" value={diceCount} onChange={(e) => setDiceCount(Number(e.target.value))} className={SELECT}>
                {Array.from({ length: MAX_COUNTDOWN_DICE }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "die" : "dice"}
                  </option>
                ))}
              </select>
              <select
                aria-label="Die"
                value={diceSides}
                onChange={(e) => setDiceSides(Number(e.target.value) as CountdownDiceSides)}
                className={SELECT}
              >
                {COUNTDOWN_DICE_SIDES.map((n) => (
                  <option key={n} value={n}>
                    d{n}
                  </option>
                ))}
              </select>
              <p className="col-span-2 m-0 text-[13px] text-[#8fa3a8]">
                {`"Countdown (${formula})": the server rolls ${formula} and the total is where it starts.`}
              </p>
            </div>
          ) : (
            <>
              <p className="m-0 text-[14px] text-[#9fb2b6]">Pick where it starts. Each tick brings it one step closer to zero.</p>
              <div role="radiogroup" aria-label="Starting value" className="grid grid-cols-5 gap-2">
                {Array.from({ length: MAX_COUNTDOWN_START }, (_, k) => MAX_COUNTDOWN_START - k).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={n === start}
                    onClick={() => setStart(n)}
                    className={cn(
                      "aspect-square cursor-pointer rounded-[10px] border font-display text-[20px] font-bold transition-transform hover:-translate-y-0.5",
                      n === start ? "border-brand bg-brand text-brand-ink" : "border-[#33444a] bg-[#141e22] text-[#e6ecea] hover:border-brand",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}
        </fieldset>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">Repeats</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {REPEATS.map((r) => (
              <label
                key={r.repeat}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2 text-[14px] font-semibold text-[#e6ecea]",
                  repeat === r.repeat ? "border-brand bg-[#1d2a2e]" : "border-[#33444a] bg-[#141e22] hover:border-brand",
                )}
              >
                <input
                  type="radio"
                  name={`${ids}-repeat`}
                  aria-label={r.label}
                  checked={repeat === r.repeat}
                  onChange={() => setRepeat(r.repeat)}
                  className="size-4 flex-none accent-[var(--brand)]"
                />
                {r.label}
              </label>
            ))}
          </div>
          <p className="m-0 text-[13px] text-[#8fa3a8]" aria-live="polite">
            {REPEATS.find((r) => r.repeat === repeat)?.hint}
          </p>
        </fieldset>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border border-[#33444a] bg-[#141e22] px-3 py-2 text-[14px] text-[#e6ecea]">
          <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} className="mt-0.5 size-4 flex-none accent-[var(--brand)]" />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">Advance automatically on action rolls</span>
            <span className="text-[12px] text-[#8fa3a8]">Armed: each PC action roll ticks it as its type says. You can switch it on the card.</span>
          </span>
        </label>

        {create.error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {create.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={BTN} onClick={close}>
            Cancel
          </button>
          <BrandButton type="submit" variant="solid" disabled={create.pending}>
            {rolled ? `Roll ${formula}` : `Start at ${start}`}
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}
