"use client";

import { useQuery } from "convex/react";
import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type CSSProperties } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import {
  canAdvanceCountdown,
  canCancelCountdown,
  canPauseCountdown,
  canResumeCountdown,
  canReverseCountdown,
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_HIDEABLE_FIELDS,
  COUNTDOWN_VISIBILITY_PRESETS,
  countdownVisibilityPreset,
  DEFAULT_HIDDEN_COUNTDOWN_FIELDS,
  MAX_COUNTDOWN_START,
  type CountdownCategory,
  type CountdownHideableField,
  type CountdownVisibility,
  type CountdownVisibilityPreset,
} from "@/lib/domain/countdowns";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CountdownView } from "../../../../../convex/countdowns";

const BTN =
  "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] disabled:cursor-not-allowed disabled:opacity-40";
const CATEGORY_LABEL: Record<CountdownCategory, string> = {
  threat: "Threat",
  project: "Project",
  consequence: "Consequence",
  other: "Other",
};

const VISIBILITY_OPTIONS: { preset: CountdownVisibilityPreset; label: string; badge: string; hint: string }[] = [
  { preset: "private", label: "Private", badge: "Private", hint: "Only you see it." },
  { preset: "partly", label: "Public, details hidden", badge: "Partly hidden", hint: "Players see it without the fields you tick." },
  { preset: "public", label: "Public", badge: "Public", hint: "Players see everything." },
];
const FIELD_LABEL: Record<CountdownHideableField, string> = {
  name: "Name",
  description: "Description",
  category: "Category",
  consequence: "Consequence",
  progress: "Progress",
};

/** The picker keeps the ticked fields while another preset is chosen, so switching back loses nothing. */
type VisibilityChoice = { preset: CountdownVisibilityPreset; hidden: CountdownHideableField[] };

const choiceOf = (visibility: CountdownVisibility): VisibilityChoice => ({
  preset: countdownVisibilityPreset(visibility),
  hidden: visibility.mode === "public" && visibility.hidden.length > 0 ? visibility.hidden : DEFAULT_HIDDEN_COUNTDOWN_FIELDS,
});
const visibilityOf = (choice: VisibilityChoice): CountdownVisibility =>
  choice.preset === "partly" ? { mode: "public", hidden: choice.hidden } : COUNTDOWN_VISIBILITY_PRESETS[choice.preset];

/** "Who can see this": Private / Public, details hidden (a checkbox per field) / Public. */
function VisibilityPicker({ value, onChange }: { value: VisibilityChoice; onChange: (next: VisibilityChoice) => void }) {
  const name = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">Who can see this</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {VISIBILITY_OPTIONS.map(({ preset, label, hint }) => {
          const Icon = preset === "private" ? EyeOff : Eye;
          return (
            <label
              key={preset}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-[10px] border px-3 py-2 text-[14px] text-[#e6ecea]",
                value.preset === preset ? "border-brand bg-[#1d2a2e]" : "border-[#33444a] bg-[#141e22] hover:border-brand",
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name={name}
                  value={preset}
                  aria-label={label}
                  checked={value.preset === preset}
                  onChange={() => onChange({ ...value, preset })}
                  className="size-4 flex-none accent-[var(--brand)]"
                />
                <Icon className="size-4 flex-none" aria-hidden="true" />
                {label}
              </span>
              <span className="text-[12px] text-[#8fa3a8]">{hint}</span>
            </label>
          );
        })}
      </div>
      {value.preset === "partly" ? (
        <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-2 rounded-[10px] border border-dashed border-[#33444a] px-3 py-2">
          <legend className="px-1 text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Hide from players</legend>
          {COUNTDOWN_HIDEABLE_FIELDS.map((field) => (
            <label key={field} className="flex min-h-8 cursor-pointer items-center gap-2 text-[14px] text-[#e6ecea]">
              <input
                type="checkbox"
                checked={value.hidden.includes(field)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    hidden: event.target.checked ? [...value.hidden, field] : value.hidden.filter((f) => f !== field),
                  })
                }
                className="size-4 accent-[var(--brand)]"
              />
              {FIELD_LABEL[field]}
            </label>
          ))}
        </fieldset>
      ) : null}
    </fieldset>
  );
}

/** A "Hidden" placeholder for a field the GM keeps from players. */
function Hidden({ field }: { field: CountdownHideableField }) {
  return (
    <span className="cd-hidden" data-testid={`hidden-${field}`}>
      <span className="sr-only">{FIELD_LABEL[field]} </span>Hidden
    </span>
  );
}

// Irregular sand grains from the board.
const GRAIN_RADII = [
  "58% 42% 55% 45% / 52% 60% 40% 48%",
  "45% 55% 40% 60% / 60% 45% 55% 40%",
  "62% 38% 50% 50% / 45% 55% 45% 55%",
  "50% 50% 62% 38% / 55% 40% 60% 45%",
  "40% 60% 55% 45% / 48% 58% 42% 52%",
];
const GRAIN_SIZE = [20, 17, 22, 18, 21, 16, 19];
const GRAIN_TILT = [-12, 18, -4, 27, -20, 8, 35];
const GRAIN_DROP = [0, 3, -2, 2, -1, 4, 1];
const HOURGLASS = "M14 9 L46 9 C46 25 34 32 32 40 C34 48 46 55 46 71 L14 71 C14 55 26 48 28 40 C26 32 14 25 14 9 Z";
// A cloth draped over the glass, for a countdown whose progress the GM hides.
const CLOTH = "M9 11 Q30 4 51 11 L53 64 Q47 71 41 65 Q36 72 30 65 Q24 72 19 65 Q13 71 7 64 Z";

function CountdownCard({ countdown, campaignId, readOnly }: { countdown: CountdownView; campaignId: Id<"campaigns">; readOnly: boolean }) {
  const operate = useIntent(api.countdowns.operate);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editingVisibility, setEditingVisibility] = useState(false);
  const { _id: countdownId, status } = countdown;
  const name = countdown.name ?? "Hidden countdown";
  // Players get no values when the GM hides the progress; the status still shows.
  const progress =
    countdown.currentValue === null || countdown.startingValue === null
      ? null
      : { value: countdown.currentValue, start: countdown.startingValue };
  const done = status === "completed";
  const paused = status === "paused";
  const t = progress && progress.start ? progress.value / progress.start : 0;
  const low = progress !== null && !done && t <= 0.25;
  const sand = done ? "#e0605a" : low ? "#e0905a" : "var(--brand)";
  const grains = done ? ["#ffb4a8", "#c0423a", "#6a1a14"] : low ? ["#ffd2a0", "#e0803a", "#7a3a10"] : ["#ffe9b0", "#d9a64a", "#7a5218"];
  const preset = countdownVisibilityPreset(countdown.visibility);
  const badge = VISIBILITY_OPTIONS.find((o) => o.preset === preset)!.badge;
  const BadgeIcon = preset === "private" ? EyeOff : Eye;

  const act = (action: "advance" | "reverse" | "pause" | "resume" | "cancel" | "correction", amount?: number) =>
    operate.fire({ countdownId, action, amount });

  return (
    <article
      aria-label={name}
      data-status={status}
      className={cn(
        "flex flex-col gap-3 rounded-[14px] border bg-[#141e22] p-4",
        done ? "animate-[cdpulse_1.6s_ease-in-out_infinite] border-danger-line" : "border-[#253338]",
      )}
    >
      <div className="flex items-center gap-3.5">
        <div className="flex w-[74px] flex-none flex-col items-center gap-0.5 rounded-xl bg-[#10181b] py-1 leading-none" aria-hidden="true">
          <svg width="44" height="58" viewBox="0 0 60 80">
            {progress ? (
              <>
                <defs>
                  <clipPath id={`hg-${countdownId}`}>
                    <path d={HOURGLASS} />
                  </clipPath>
                </defs>
                <g clipPath={`url(#hg-${countdownId})`}>
                  <rect x="0" y={(40 - 31 * t).toFixed(1)} width="60" height="40" fill={sand} />
                  <rect x="0" y={(71 - 31 * (1 - t)).toFixed(1)} width="60" height="40" fill={sand} opacity="0.85" />
                </g>
                {!done && progress.value < progress.start ? (
                  <line x1="30" y1="40" x2="30" y2={(71 - 31 * (1 - t)).toFixed(1)} stroke={sand} strokeWidth="1.5" strokeDasharray="2 2" />
                ) : null}
              </>
            ) : null}
            <path d={HOURGLASS} fill="rgba(200, 220, 230, 0.06)" stroke="#9fb2b6" strokeWidth="1.5" />
            {progress ? null : (
              <g data-testid="covered-hourglass">
                <path d={CLOTH} fill="#2b3a3f" stroke="#55686d" strokeWidth="1.2" />
                <path d="M16 20 Q30 15 44 20 M14 44 Q30 39 46 44" fill="none" stroke="#3d4f54" strokeWidth="1" />
                <text x="30" y="46" textAnchor="middle" fontSize="20" fontWeight="700" fill="#d9a64a">?</text>
              </g>
            )}
            <rect x="8" y="3" width="44" height="6" rx="2" fill="#7a5a2e" />
            <rect x="8" y="71" width="44" height="6" rx="2" fill="#7a5a2e" />
          </svg>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("truncate text-[16px] font-semibold", countdown.name === null ? "text-[#9fb2b6] italic" : "text-[#e6ecea]")}>
            {name}
          </span>
          {countdown.consequence === null ? (
            <span className="text-[13px] text-[#9fb2b6]">
              At zero: <Hidden field="consequence" />
            </span>
          ) : countdown.consequence ? (
            <span className="text-[13px] text-[#9fb2b6]">{countdown.consequence}</span>
          ) : null}
          {countdown.description === null ? (
            <span className="text-[13px] text-[#8fa3a8]">
              Notes: <Hidden field="description" />
            </span>
          ) : countdown.description ? (
            <span className="text-[13px] text-[#8fa3a8] italic">{countdown.description}</span>
          ) : null}
          <span className="flex flex-wrap items-center gap-2 text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">
            {countdown.category === null ? <Hidden field="category" /> : <span>{CATEGORY_LABEL[countdown.category]}</span>}
            {paused ? <span className="rounded-full border border-[#4a5a60] px-2 py-0.5 text-[#c9d2cf]">Paused</span> : null}
            {readOnly ? null : (
              <button
                type="button"
                data-preset={preset}
                aria-label={`Who can see ${name}: ${badge}`}
                onClick={() => setEditingVisibility(true)}
                className={cn(
                  "flex min-h-7 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 tracking-[0.08em] normal-case hover:border-brand",
                  preset === "public" ? "border-[#33444a] text-[#9fb2b6]" : "border-[#7a5a2e] text-[#e6c88a]",
                )}
              >
                <BadgeIcon className="size-3.5" aria-hidden="true" />
                {badge}
              </button>
            )}
          </span>
        </div>
        {progress ? (
          <span
            className={cn("flex-none font-display text-[22px] font-black", done ? "text-[#ffb4ae]" : "text-[#f4efe6]")}
            aria-label={`${progress.value} of ${progress.start}`}
            data-testid="countdown-value"
          >
            {progress.value}
            <span className="text-[12px] text-[#8fa3a8]">/{progress.start}</span>
          </span>
        ) : (
          <span className="flex-none font-display text-[22px] font-black text-[#8fa3a8]" aria-label="Progress hidden" data-testid="countdown-value">
            ?
          </span>
        )}
      </div>

      {done ? (
        <div role="status" className="rounded-lg border border-danger-line bg-[#3a1414] px-3 py-2 text-center font-display text-[14px] tracking-[0.1em] text-[#ffd9d6]">
          THE COUNTDOWN HAS STRUCK
        </div>
      ) : null}

      {progress ? (
        <div
          role="group"
          aria-label={readOnly ? "Countdown grains" : "Click a grain to correct the countdown"}
          className="flex min-h-7 flex-nowrap items-center gap-[3px] rounded-[10px] bg-[linear-gradient(180deg,rgba(0,0,0,0.25),rgba(122,82,24,0.12))] px-2 py-1.5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)]"
        >
          {Array.from({ length: progress.start }, (_, k) => {
            const on = k < progress.value;
            const target = k + 1 === progress.value ? k : k + 1;
            const style: CSSProperties = {
              flex: "1 1 0",
              minWidth: 0,
              maxWidth: GRAIN_SIZE[k % 7],
              aspectRatio: 1.22,
              marginTop: GRAIN_DROP[k % 7],
              borderRadius: GRAIN_RADII[k % 5],
              transform: `rotate(${GRAIN_TILT[k % 7]}deg)`,
              ...(on
                ? {
                    border: "none",
                    background: `radial-gradient(circle at 34% 30%, ${grains[0]} 0%, ${grains[1]} 55%, ${grains[2]} 100%)`,
                    boxShadow: `0 2px 3px rgba(0, 0, 0, 0.55), inset -1px -2px 2px rgba(0, 0, 0, 0.25), 0 0 6px ${grains[1]}55`,
                  }
                : {
                    border: "1px dashed rgba(217, 166, 74, 0.35)",
                    background: "rgba(10, 16, 18, 0.6)",
                    boxShadow: "inset 0 1px 3px rgba(0, 0, 0, 0.6)",
                  }),
            };
            return (
              <button
                key={k}
                type="button"
                aria-label={`${name}: grain ${k + 1} of ${progress.start}`}
                aria-pressed={on}
                title={`Correct to ${target}`}
                disabled={readOnly || operate.pending || (done && target < progress.value)}
                className="cursor-pointer p-0 transition-transform hover:scale-110 disabled:cursor-not-allowed"
                style={style}
                onClick={() => void act("correction", target - progress.value)}
              />
            );
          })}
        </div>
      ) : (
        <div className="cd-hidden-strip">The sand is covered</div>
      )}

      {readOnly || !progress ? null : (
        <div className="grid grid-cols-[1.2fr_1.4fr_1fr] gap-2">
          <button
            type="button"
            className={cn(BTN, "border-transparent font-bold text-brand-ink")}
            style={{ background: done ? "#5a2a2a" : "var(--brand)" }}
            disabled={operate.pending || !canAdvanceCountdown(status, progress.value)}
            onClick={() => void act("advance")}
          >
            Tick −1
          </button>
          <button
            type="button"
            className={BTN}
            aria-label={`Borrowed time: add one to ${name}`}
            disabled={operate.pending || !canReverseCountdown(status, progress.value, progress.start)}
            onClick={() => void act("reverse")}
          >
            Borrowed Time
          </button>
          {paused ? (
            <button type="button" className={BTN} disabled={operate.pending || !canResumeCountdown(status)} onClick={() => void act("resume")}>
              Resume
            </button>
          ) : (
            <button type="button" className={BTN} disabled={operate.pending || !canPauseCountdown(status)} onClick={() => void act("pause")}>
              Pause
            </button>
          )}
        </div>
      )}

      <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {operate.error}
      </p>

      {!readOnly && canCancelCountdown(status) ? (
        confirmCancel ? (
          <div role="alertdialog" aria-label={`Cancel ${name}`} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2 text-[14px] text-[#ffd9d6]">
            <span className="flex-1">Cancel this countdown? It can’t be resumed.</span>
            <button type="button" className={BTN} onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="min-h-10 cursor-pointer rounded-[9px] bg-danger-solid px-3 text-[14px] font-semibold text-white disabled:opacity-50"
              disabled={operate.pending}
              onClick={() => void act("cancel")}
            >
              Cancel countdown
            </button>
          </div>
        ) : (
          <button type="button" className="self-end text-[13px] text-[#8fa3a8] underline-offset-4 hover:underline" onClick={() => setConfirmCancel(true)}>
            Cancel countdown…
          </button>
        )
      ) : null}

      {readOnly ? null : (
        <Modal
          open={editingVisibility}
          onClose={() => setEditingVisibility(false)}
          title="Who can see this"
          className="max-w-[560px] border-[#33444a] bg-[#121b1f]"
        >
          <VisibilityForm countdown={countdown} campaignId={campaignId} onDone={() => setEditingVisibility(false)} />
        </Modal>
      )}
    </article>
  );
}

/** Changes a countdown's visibility. Mounted only while its dialog is open, so it starts from the stored value. */
function VisibilityForm({ countdown, campaignId, onDone }: { countdown: CountdownView; campaignId: Id<"campaigns">; onDone: () => void }) {
  const setVisibility = useIntent(api.countdowns.setVisibility);
  const [choice, setChoice] = useState(() => choiceOf(countdown.visibility));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (setVisibility.pending) return;
        const saved = await setVisibility.fire({ campaignId, countdownId: countdown._id, visibility: visibilityOf(choice) });
        if (saved) onDone();
      }}
    >
      <p className="m-0 text-[15px] font-semibold text-[#e6ecea]">{countdown.name}</p>
      <VisibilityPicker value={choice} onChange={setChoice} />
      {setVisibility.error ? (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {setVisibility.error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2.5">
        <button type="button" className={BTN} onClick={onDone}>
          Cancel
        </button>
        <BrandButton type="submit" variant="solid" disabled={setVisibility.pending}>
          Save
        </BrandButton>
      </div>
    </form>
  );
}

const NEW_COUNTDOWN_VISIBILITY = choiceOf(COUNTDOWN_VISIBILITY_PRESETS.public);

function NewCountdownDialog({ campaignId, open, onClose }: { campaignId: Id<"campaigns">; open: boolean; onClose: () => void }) {
  const create = useIntent(api.countdowns.create);
  const [start, setStart] = useState(6);
  const [visibility, setVisibility] = useState(NEW_COUNTDOWN_VISIBILITY);
  // The form unmounts on close (Modal renders children only while open); reset the picker too.
  const close = () => {
    setStart(6);
    setVisibility(NEW_COUNTDOWN_VISIBILITY);
    create.clearError();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="New countdown" className="max-w-[560px] border-[#33444a] bg-[#121b1f]">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (create.pending) return;
          const form = new FormData(event.currentTarget);
          const created = await create.fire({
            campaignId,
            name: String(form.get("name") ?? ""),
            consequence: String(form.get("consequence") ?? ""),
            description: String(form.get("description") ?? ""),
            category: String(form.get("category")) as CountdownCategory,
            startingValue: start,
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
            <select
              name="category"
              aria-label="Category"
              defaultValue="threat"
              className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
            >
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
            Start at {start}
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}

/** Countdowns section of the CampaignHub board. Countdowns are core: every frame has them. */
export function Countdowns({ campaignId, readOnly = false }: { campaignId: Id<"campaigns">; readOnly?: boolean }) {
  const countdowns = useQuery(api.countdowns.listByCampaign, { campaignId });
  const [creating, setCreating] = useState(false);

  return (
    <section aria-labelledby="cd-h" className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="cd-h" className="m-0 font-display text-[24px] font-bold text-parchment">
          Countdowns
        </h2>
        {readOnly ? null : (
          <button type="button" className={cn(BTN, "min-h-11 px-4")} onClick={() => setCreating(true)}>
            + New countdown
          </button>
        )}
      </div>
      {countdowns === undefined ? (
        <p className="text-[#9fb2b6]">Loading countdowns…</p>
      ) : countdowns.length === 0 && readOnly ? (
        <p className="m-0 rounded-[14px] border-2 border-dashed border-[#33444a] p-6 text-center text-[15px] text-[#9fb2b6]">
          No countdowns running.
        </p>
      ) : countdowns.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="cursor-pointer rounded-[14px] border-2 border-dashed border-[#33444a] bg-transparent p-6 text-[15px] text-[#9fb2b6]"
        >
          No countdowns running. Start one from 20 down to 1.
        </button>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {countdowns.map((c) => (
            <CountdownCard key={c._id} countdown={c} campaignId={campaignId} readOnly={readOnly} />
          ))}
        </div>
      )}
      {readOnly ? null : <NewCountdownDialog campaignId={campaignId} open={creating} onClose={() => setCreating(false)} />}
    </section>
  );
}
