"use client";

import { useId, useRef, useState } from "react";

import { FREE_DIE_SIDES, FREE_ROLL_LIMITS, formatFreeRoll, freeDiceCount, parseFreeRoll, type FreePool } from "@/lib/domain/dice";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { play3d } from "./dice3d";
import { DiceFaces } from "./parts";
import { canAnimate3d, useDiceSettings } from "./settings";
import { playRollSound } from "./sound";

/**
 * Free rolls of mixed dice (user 2026-11-04: "combine different dice, for example 3d6 + 1d8"): a die-size row that adds
 * one die per tap, a − / + count per size, a − / + modifier, an optional typed formula ("3d6+1d8+2") and a live preview.
 * Every control works without typing, at 44 px on touch. The server rolls (`rolls.gmRoll` secret, `rolls.freeRoll`
 * public) and checks the limits again (`assertFreeRoll`: d4–d20, at most 20 dice, modifier within ±60).
 */

const BTN = "min-h-11 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const STEP = "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-[#33444a] bg-transparent text-[18px] leading-none text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const INPUT = "min-h-11 rounded-[9px] border border-[#33444a] bg-[#10181b] px-3 text-[14px] text-[#e6ecea]";
const LBL = "text-[12px] text-[#8fa3a8] uppercase";

export type FreeRollValue = { dice: FreePool; modifier: number };

const { dice: MAX_DICE, modifier: MAX_MOD } = FREE_ROLL_LIMITS;

/** The formula text for a pool ("" for an empty one), as the typed field shows it after a button press. */
function formulaText({ dice, modifier }: FreeRollValue): string {
  return freeDiceCount(dice) === 0 && modifier === 0 ? "" : formatFreeRoll(dice, modifier);
}

/** Adds `delta` dice of one size: a new size goes last, a size at 0 drops out. */
function changeCount(dice: FreePool, sides: number, delta: number): FreePool {
  const has = dice.some((g) => g.sides === sides);
  const next = has ? dice.map((g) => (g.sides === sides ? { ...g, count: g.count + delta } : g)) : [...dice, { sides, count: delta }];
  return next.filter((g) => g.count > 0);
}

/**
 * The controlled pool builder: die sizes, counts, modifier, typed formula and preview. `value` is the pool; the typed
 * text is local and follows the buttons (event handlers only, no effect copies it).
 */
export function DicePoolBuilder({ value, onChange, disabled = false }: { value: FreeRollValue; onChange: (next: FreeRollValue) => void; disabled?: boolean }) {
  const [text, setText] = useState(() => formulaText(value));
  const [textError, setTextError] = useState<string | null>(null);
  const hintId = useId();
  const total = freeDiceCount(value.dice);
  const full = total >= MAX_DICE;

  function set(next: FreeRollValue) {
    setText(formulaText(next));
    setTextError(null);
    onChange(next);
  }

  function typed(raw: string) {
    setText(raw);
    if (raw.trim() === "") {
      setTextError(null);
      onChange({ dice: [], modifier: 0 });
      return;
    }
    try {
      onChange(parseFreeRoll(raw));
      setTextError(null);
    } catch (e) {
      setTextError(e instanceof Error ? e.message : "Can't read that roll.");
    }
  }

  return (
    <div className="flex w-full flex-col gap-2" data-testid="dice-pool-builder">
      <div role="group" aria-label="Add a die" className="flex flex-wrap gap-1.5">
        {FREE_DIE_SIDES.map((sides) => (
          <button key={sides} type="button" className={`${BTN} min-w-12 font-mono`} aria-label={`Add a d${sides}`} disabled={disabled || full} onClick={() => set({ ...value, dice: changeCount(value.dice, sides, 1) })}>
            d{sides}
          </button>
        ))}
      </div>
      {value.dice.length > 0 ? (
        <ul aria-label="Dice in this roll" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {value.dice.map((g) => (
            <li key={g.sides} className="flex items-center gap-1 rounded-[10px] border border-[#253338] bg-[#10181b] p-1">
              <button type="button" className={STEP} aria-label={`One d${g.sides} fewer`} disabled={disabled} onClick={() => set({ ...value, dice: changeCount(value.dice, g.sides, -1) })}>
                −
              </button>
              <span className="min-w-12 text-center font-mono text-[15px] text-[#e6ecea]">
                {g.count}d{g.sides}
              </span>
              <button type="button" className={STEP} aria-label={`One d${g.sides} more`} disabled={disabled || full} onClick={() => set({ ...value, dice: changeCount(value.dice, g.sides, 1) })}>
                +
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div role="group" aria-label="Modifier" className="flex flex-col gap-1">
          <span className={LBL} aria-hidden="true">
            Modifier
          </span>
          <span className="flex items-center gap-1">
            <button type="button" className={STEP} aria-label="Lower the modifier" disabled={disabled || value.modifier <= -MAX_MOD} onClick={() => set({ ...value, modifier: value.modifier - 1 })}>
              −
            </button>
            <output aria-label="Modifier value" className="min-w-10 text-center font-mono text-[15px] text-[#e6ecea]">
              {value.modifier > 0 ? `+${value.modifier}` : value.modifier}
            </output>
            <button type="button" className={STEP} aria-label="Raise the modifier" disabled={disabled || value.modifier >= MAX_MOD} onClick={() => set({ ...value, modifier: value.modifier + 1 })}>
              +
            </button>
          </span>
        </div>
        <label className={`flex min-w-36 flex-1 flex-col gap-1 ${LBL}`}>
          Type a roll
          <input
            className={`${INPUT} font-mono normal-case`}
            placeholder="3d6+1d8+2"
            autoComplete="off"
            spellCheck={false}
            maxLength={FREE_ROLL_LIMITS.formula}
            aria-invalid={textError !== null}
            aria-describedby={hintId}
            disabled={disabled}
            value={text}
            onChange={(e) => typed(e.target.value)}
          />
        </label>
        {total > 0 || value.modifier !== 0 ? (
          <button type="button" className={BTN} disabled={disabled} onClick={() => set({ dice: [], modifier: 0 })}>
            Clear
          </button>
        ) : null}
      </div>
      <p id={hintId} aria-live="polite" className="m-0 text-[13px] text-[#f0b8b0] empty:hidden">
        {textError}
      </p>
      <p className="m-0 text-[14px] text-[#c9d2cf]">
        <span className="mr-1 text-[#8fa3a8]">Roll:</span>
        <output data-testid="free-roll-preview" className="font-mono text-[#e6ecea]">
          {total > 0 ? formatFreeRoll(value.dice, value.modifier) : "pick a die"}
        </output>
        <span className="ml-2 text-[12px] text-[#8fa3a8]">
          ({total}/{MAX_DICE} dice)
        </span>
      </p>
    </div>
  );
}

type RollMode = "gm" | "public";

const COPY: Record<RollMode, { form: string; id: string; submit: string }> = {
  gm: { form: "GM roll", id: "gm-roll-form", submit: "Roll in secret" },
  public: { form: "Free roll", id: "free-roll-form", submit: "Roll" },
};

/**
 * A free roll form: `gm` is the GM's secret roll (hidden until revealed; starts at 1d20 as before), `public` is any
 * member's roll everyone sees (starts empty). `showResult` adds the last roll's dice and total under the form, for the
 * Combat HUD's Dice pop-over, which has no feed beside it.
 */
export function FreeRollForm({ campaignId, mode, showResult = false }: { campaignId: Id<"campaigns">; mode: RollMode; showResult?: boolean }) {
  const [value, setValue] = useState<FreeRollValue>(() => (mode === "gm" ? { dice: [{ count: 1, sides: 20 }], modifier: 0 } : { dice: [], modifier: 0 }));
  const [label, setLabel] = useState("");
  const gmRoll = useIntent(api.rolls.gmRoll);
  const freeRoll = useIntent(api.rolls.freeRoll);
  const roll = mode === "gm" ? gmRoll : freeRoll;
  const [last, setLast] = useState<{ dice: Parameters<typeof DiceFaces>[0]["dice"]; text: string } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [settings] = useDiceSettings();
  const copy = COPY[mode];
  const total = freeDiceCount(value.dice);

  // The same 3D dice and sound as the character dice box, per this device's settings.
  async function submit() {
    if (total === 0) return;
    const args = { campaignId, dice: value.dice, modifier: value.modifier, ...(label.trim() ? { label: label.trim() } : {}) };
    const result = await roll.fire(args);
    if (!result) return;
    if (showResult) setLast({ dice: result.roll.dice, text: `${formatFreeRoll(value.dice, value.modifier)} = ${result.roll.total}` });
    const shown = canAnimate3d(settings) && stage.current !== null && (await play3d(stage.current, { dice: result.roll.dice, sound: settings.sound }));
    if (!shown && settings.sound) playRollSound();
  }

  return (
    <form
      id={copy.id}
      aria-label={copy.form}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DicePoolBuilder value={value} onChange={setValue} disabled={roll.pending} />
      <div className="flex flex-wrap items-end gap-2">
        <label className={`flex min-w-32 flex-1 flex-col gap-1 ${LBL}`}>
          For
          <input className={`${INPUT} normal-case`} placeholder="Optional label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button type="submit" className={BTN} disabled={roll.pending || total === 0}>
          {copy.submit}
        </button>
      </div>
      <p aria-live="polite" className="m-0 w-full text-[13px] text-danger empty:hidden">
        {roll.error}
      </p>
      {showResult ? (
        <div role="status" className="flex w-full flex-wrap items-center gap-2 text-[14px] text-[#e6ecea] empty:hidden" data-testid={mode === "gm" ? "gm-roll-result" : "free-roll-result"}>
          {last ? (
            <>
              <DiceFaces dice={last.dice} />
              <b>{last.text}</b>
            </>
          ) : null}
        </div>
      ) : null}
      <div ref={stage} className="w-full empty:hidden" />
    </form>
  );
}
