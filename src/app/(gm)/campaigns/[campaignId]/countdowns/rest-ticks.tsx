"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import type { CountdownDiceSides } from "@/lib/domain/countdowns/advanced";
import {
  MAX_REST_TICK_FIXED,
  REST_TICK_DICE_SIDES,
  REST_TICK_KINDS,
  restTickAmountLabel,
  type RestTick,
  type RestTickAmount,
  type RestTickKind,
  type RestTickRest,
} from "@/lib/domain/countdowns/rest-ticks";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CountdownView } from "../../../../../../convex/countdowns";

import { useKeyed } from "./track";

/**
 * Countdowns that tick on rests, the GM's controls (plan rest-ticks, RT2; bead dcm-674k). User decisions 2026-11-12:
 * every countdown type has "On long rest" (a FINISHED long rest) and "On short rest" (a short rest, and an interrupted
 * long rest, Q1), each Off or an amount (a fixed number, the PCs who rested, a die, a die plus those PCs) and Automatic
 * (ticks by itself) or Reminder (the rest panel asks "Tick X?" with the amount already rolled). The server stores and
 * rolls them (countdowns.setRestTick, convex/rests.ts); this file only edits the setting.
 */

export const REST_LABEL: Record<RestTickRest, string> = { long: "On long rest", short: "On short rest" };

const REST_HINT: Record<RestTickRest, string> = {
  long: "Each finished long rest. An interrupted long rest counts as a short rest.",
  short: "Each short rest, and each interrupted long rest.",
};

const KIND_LABEL: Record<RestTickKind, string> = {
  fixed: "A fixed number",
  pcs: "PCs who rested",
  die: "A die",
  diePlusPcs: "A die + PCs who rested",
};

/** The setting a switched-on control starts with: 1 tick, Automatic (the book's "tick down ... once", CB p.164). */
export const DEFAULT_REST_TICK: RestTick = { amount: { kind: "fixed", n: 1 }, mode: "auto" };

/** The die a die kind starts on, when the setting had none. */
const DEFAULT_SIDES: CountdownDiceSides = 6;

/** The setting with another amount kind; keeps the fixed number or the die size it already had. */
export function restTickWithKind(setting: RestTick, kind: RestTickKind): RestTick {
  const sides = "sides" in setting.amount ? setting.amount.sides : DEFAULT_SIDES;
  const amount: RestTickAmount =
    kind === "fixed"
      ? { kind, n: setting.amount.kind === "fixed" ? setting.amount.n : 1 }
      : kind === "pcs"
        ? { kind }
        : { kind, sides };
  return { ...setting, amount };
}

/** A valid fixed amount from the number field (a whole number 1..20), or null. */
export function parseFixedTicks(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_REST_TICK_FIXED ? n : null;
}

/** "Off", or "d6 + PCs who rested, Reminder". */
export function restTickSummary(setting: RestTick | null): string {
  if (setting === null) return "Off";
  return `${restTickAmountLabel(setting.amount)}, ${setting.mode === "auto" ? "Automatic" : "Reminder"}`;
}

/**
 * The card's view after a setRestTick, for the optimistic update: the new setting, and on a long-term row the
 * transition fields derived from it as the server derives them (armed = has a long-rest setting, restMode its mode).
 */
export function withRestTick(view: CountdownView, rest: RestTickRest, setting: RestTick | null): CountdownView {
  if (rest === "short") return { ...view, onShortRest: setting };
  if (view.mode !== "longTerm") return { ...view, onLongRest: setting };
  return { ...view, onLongRest: setting, armed: setting !== null, restMode: setting?.mode ?? "auto" };
}

const SELECT = "min-h-11 min-w-0 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea] disabled:opacity-50";

/**
 * One rest setting: Off / On, the amount (a fixed number 1..20, PCs who rested, a die d4..d20, a die + PCs) and
 * Automatic / Reminder. `onChange` gets each complete setting (null = off). The number field reports every valid
 * keystroke when `live` (the create forms), else once it is left or Enter is pressed (the card, one intent per edit).
 */
export function RestTickControl({
  rest,
  value,
  onChange,
  live,
  disabled = false,
}: {
  rest: RestTickRest;
  value: RestTick | null;
  onChange: (setting: RestTick | null) => void;
  live: boolean;
  disabled?: boolean;
}) {
  const ids = useId();
  // A draft only while the GM types a fixed number; otherwise the field shows the stored one (no props copied into state).
  const [draft, setDraft] = useState<string | null>(null);
  const label = REST_LABEL[rest];
  const amount = value?.amount;
  const fixed = amount?.kind === "fixed" ? amount.n : null;
  const commit = () => {
    if (draft === null || value === null) return;
    const n = parseFixedTicks(draft);
    if (n !== null && n !== fixed) onChange({ ...value, amount: { kind: "fixed", n } });
    setDraft(null);
  };

  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-2 rounded-[10px] border border-[#33444a] bg-[#10181b] px-3 py-2.5"
      data-testid={`rest-tick-${rest}`}
      disabled={disabled}
    >
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="text-[14px] font-semibold text-[#e6ecea]">
          {label}
        </span>
        <span className="ml-auto flex gap-1.5">
          <BrandButton variant="neutral" aria-pressed={value === null} disabled={disabled} onClick={() => value !== null && onChange(null)}>
            Off
          </BrandButton>
          <BrandButton variant="neutral" aria-pressed={value !== null} disabled={disabled} onClick={() => value === null && onChange(DEFAULT_REST_TICK)}>
            On
          </BrandButton>
        </span>
      </div>
      <p className="m-0 text-[12px] text-[#8fa3a8]">{REST_HINT[rest]}</p>
      {value === null || amount === undefined ? null : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 flex-col gap-1 text-[13px] text-[#9fb2b6]">
              <label htmlFor={`${ids}-kind`}>Ticks</label>
              <select
                id={`${ids}-kind`}
                value={amount.kind}
                disabled={disabled}
                onChange={(e) => onChange(restTickWithKind(value, e.target.value as RestTickKind))}
                className={SELECT}
              >
                {REST_TICK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            {amount.kind === "fixed" ? (
              <div className="flex flex-col gap-1 text-[13px] text-[#9fb2b6]">
                <label htmlFor={`${ids}-n`}>Number (1 to {MAX_REST_TICK_FIXED})</label>
                <input
                  id={`${ids}-n`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_REST_TICK_FIXED}
                  step={1}
                  value={draft ?? String(amount.n)}
                  disabled={disabled}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (live) {
                      const n = parseFixedTicks(e.target.value);
                      if (n !== null) onChange({ ...value, amount: { kind: "fixed", n } });
                    }
                  }}
                  onBlur={live ? () => setDraft(null) : commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (live) setDraft(null);
                      else commit();
                    }
                  }}
                  className={cn(SELECT, "w-full sm:w-28")}
                />
              </div>
            ) : amount.kind === "die" || amount.kind === "diePlusPcs" ? (
              <div className="flex flex-col gap-1 text-[13px] text-[#9fb2b6]">
                <label htmlFor={`${ids}-die`}>Die</label>
                <select
                  id={`${ids}-die`}
                  value={amount.sides}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...value, amount: { kind: amount.kind, sides: Number(e.target.value) as CountdownDiceSides } })}
                  className={cn(SELECT, "sm:w-28")}
                >
                  {REST_TICK_DICE_SIDES.map((n) => (
                    <option key={n} value={n}>
                      d{n}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div role="group" aria-label={`${label}: how`} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-[#9fb2b6]">How</span>
            <span className="flex gap-1.5">
              <BrandButton
                variant="neutral"
                aria-pressed={value.mode === "auto"}
                title="The rest ticks it by itself."
                disabled={disabled}
                onClick={() => value.mode !== "auto" && onChange({ ...value, mode: "auto" })}
              >
                Automatic
              </BrandButton>
              <BrandButton
                variant="neutral"
                aria-pressed={value.mode === "remind"}
                title="The rest panel asks you first, with the amount already rolled; one click ticks it."
                disabled={disabled}
                onClick={() => value.mode !== "remind" && onChange({ ...value, mode: "remind" })}
              >
                Reminder
              </BrandButton>
            </span>
          </div>
        </>
      )}
    </fieldset>
  );
}

/**
 * The card's rest settings (both rests), behind a "Rest ticks" disclosure with a one-line summary. Each change is one
 * `countdowns.setRestTick` intent with an optimistic update of the list; `pairIds` are a chase pair's rows, which share
 * the setting (the server writes both).
 */
export function RestTickSettings({
  countdown,
  campaignId,
  name,
  pairIds,
}: {
  countdown: CountdownView;
  campaignId: Id<"campaigns">;
  name: string;
  pairIds?: ReadonlySet<Id<"countdowns">>;
}) {
  const [open, setOpen] = useState(false);
  const ids = useId();
  const set = useKeyed(
    useMutation(api.countdowns.setRestTick).withOptimisticUpdate((store, { countdownId, rest, setting }) => {
      const list = store.getQuery(api.countdowns.listByCampaign, { campaignId });
      if (list === undefined) return;
      const partner = list.find((c) => c._id === countdownId)?.chase?.partnerId;
      const hits = (id: Id<"countdowns">) => id === countdownId || id === partner || pairIds?.has(id) === true;
      store.setQuery(
        api.countdowns.listByCampaign,
        { campaignId },
        list.map((c) => (hits(c._id) ? withRestTick(c, rest, setting) : c)),
      );
    }),
  );
  const disabled = countdown.status === "cancelled";
  const fire = (rest: RestTickRest, setting: RestTick | null) => void set.fire({ campaignId, countdownId: countdown._id, rest, setting });

  return (
    <div className="flex flex-col gap-2" data-testid="rest-tick-settings">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[13px] text-[#9fb2b6]" data-testid="rest-tick-summary">
          Long rest: {restTickSummary(countdown.onLongRest)} · Short rest: {restTickSummary(countdown.onShortRest)}
        </span>
        <BrandButton
          variant="neutral"
          aria-expanded={open}
          aria-controls={`${ids}-panel`}
          aria-label={`Rest ticks of ${name}`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Done" : "Rest ticks"}
        </BrandButton>
      </div>
      {open ? (
        <div id={`${ids}-panel`} className="flex flex-col gap-2">
          <RestTickControl rest="long" value={countdown.onLongRest} onChange={(s) => fire("long", s)} live={false} disabled={disabled} />
          <RestTickControl rest="short" value={countdown.onShortRest} onChange={(s) => fire("short", s)} live={false} disabled={disabled} />
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {set.error ?? ""}
      </p>
    </div>
  );
}
