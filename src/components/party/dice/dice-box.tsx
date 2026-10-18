"use client";

import { useMemo, useRef, useState } from "react";

import { rollOptions, weaponOverrides } from "@/lib/domain/class-features/hooks";
import type { RollPrompt } from "@/lib/domain/class-features/types";
import { advantagePlan, weaponDice, type DicePool } from "@/lib/domain/dice";
import type { RollRecord } from "@/lib/domain/duality";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";
import { WEAPONS } from "@/lib/srd/equipment";
import { TRAIT_IDS, type TraitId } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";
import { characterSheetSchema } from "@/lib/validation/characters";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../convex/characters";
import { play3d } from "./dice3d";
import { CountStepper, DiceFaces, DiceSettingsToggles, rollHeadline } from "./parts";
import { canAnimate3d, useDiceSettings } from "./settings";
import { playRollSound } from "./sound";
import { TagTeam } from "./tag-team";

type Mode = "action" | "reaction" | "damage";
type Result = { roll: RollRecord; prompts: RollPrompt[] };

const SIDES = [4, 6, 8, 10, 12, 20] as const;

function toInt(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Unavailable characters can't roll (decision 9; the server refuses too). */
function isUnavailable(character: CharacterView): boolean {
  return character.status === "dead" || character.status === "away" || (character.sheet.conditions ?? []).includes("unconscious");
}

/** The dice box on the sheet: action, reaction and damage rolls, server-rolled or typed in from physical dice. */
export function DiceBox({ campaignId, character }: { campaignId: Id<"campaigns">; character: CharacterView }) {
  const view = character.sheet;
  const sheet = useMemo(() => {
    const parsed = characterSheetSchema.safeParse(view);
    return parsed.success ? parsed.data : null;
  }, [view]);
  const unavailable = isUnavailable(character);

  const [mode, setMode] = useState<Mode>("action");
  const [trait, setTrait] = useState<TraitId>("agility");
  const [modifier, setModifier] = useState("0");
  const [difficulty, setDifficulty] = useState("");
  const [experienceIds, setExperienceIds] = useState<string[]>([]);
  const [advantage, setAdvantage] = useState(0);
  const [disadvantage, setDisadvantage] = useState(0);
  const [help, setHelp] = useState(0);
  const [attack, setAttack] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [source, setSource] = useState("primary");
  const [customCount, setCustomCount] = useState("1");
  const [customSides, setCustomSides] = useState<number>(6);
  const [critical, setCritical] = useState(false);
  const [manual, setManual] = useState(false);
  const [values, setValues] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [settings] = useDiceSettings();

  const actionRoll = useIntent(api.rolls.actionRoll);
  const damageRoll = useIntent(api.rolls.damageRoll);
  const manualRoll = useIntent(api.rolls.manualRoll);
  const pending = actionRoll.pending || damageRoll.pending || manualRoll.pending;
  const error = actionRoll.error ?? damageRoll.error ?? manualRoll.error;

  const overrides = sheet ? weaponOverrides(sheet) : [];
  const options = sheet ? rollOptions(sheet, mode) : [];
  const weapons = [
    { key: "primary", id: view.primaryWeaponId },
    { key: "secondary", id: view.secondaryWeaponId },
  ].flatMap(({ key, id }) => {
    const w = id ? WEAPONS.find((x) => x.id === id) : undefined;
    return w ? [{ key, label: `${key === "primary" ? "Primary" : "Secondary"}: ${w.name} (${w.damage})`, damage: w.damage }] : [];
  });

  // The dice a manual entry must supply, in the server's rolling order.
  const damagePool: DicePool = (() => {
    const weapon = weapons.find((w) => w.key === source);
    if (weapon) {
      try {
        return weaponDice(weapon.damage, view.proficiency).dice;
      } catch {
        return [];
      }
    }
    const override = overrides.find((o) => o.key === source);
    if (override) return override.dice;
    return [{ count: toInt(customCount) ?? 0, sides: customSides }];
  })();
  const plan = (() => {
    try {
      return advantagePlan(advantage, disadvantage, mode === "reaction" ? 0 : help);
    } catch {
      return [];
    }
  })();
  const expected: { label: string; sides: number }[] =
    mode === "damage"
      ? damagePool.flatMap((p) => Array.from({ length: Math.max(0, p.count) }, () => p.sides)).map((sides, i) => ({ label: `Damage die ${i + 1}`, sides }))
      : [
          { label: "Hope die", sides: 12 },
          { label: "Fear die", sides: 12 },
          ...plan.map((role, i) => ({ label: role === "disadvantage" ? "Disadvantage die" : `${role === "help" ? "Help" : "Advantage"} die ${i + 1}`, sides: 6 })),
        ];

  async function show(roll: RollRecord, prompts: RollPrompt[]) {
    const shown = canAnimate3d(settings) && stage.current !== null && (await play3d(stage.current, { dice: roll.dice, sound: settings.sound }));
    if (!shown && settings.sound) playRollSound();
    setResult({ roll, prompts });
  }

  async function roll() {
    setResult(null);
    const mod = toInt(modifier) ?? 0;
    const picked = manual ? [] : chosen.filter((k) => options.some((o) => o.key === k));
    if (mode === "damage") {
      const damageSource =
        source === "primary" || source === "secondary"
          ? { kind: "weapon" as const, slot: source === "primary" ? ("primary" as const) : ("secondary" as const) }
          : source === "custom"
            ? { kind: "dice" as const, dice: [{ count: toInt(customCount) ?? 0, sides: customSides }] }
            : { kind: "override" as const, key: source };
      const args = { source: damageSource, critical, modifier: mod, options: picked };
      const out = manual
        ? await manualRoll.fire({ characterId: character._id, roll: { kind: "damage", ...args }, values: values.slice(0, expected.length).map((v) => toInt(v) ?? 0) })
        : await damageRoll.fire({ characterId: character._id, ...args });
      if (out) await show(out.roll, []);
      return;
    }
    const diff = toInt(difficulty);
    const args = {
      kind: mode,
      trait,
      modifier: mod,
      ...(diff !== undefined ? { difficulty: diff } : {}),
      experienceIds,
      advantage,
      disadvantage,
      help: mode === "reaction" ? 0 : help,
      attack: mode === "action" && attack,
      options: picked,
    };
    if (manual) {
      const out = await manualRoll.fire({ characterId: character._id, roll: args, values: values.slice(0, expected.length).map((v) => toInt(v) ?? 0) });
      if (out) await show(out.roll, []);
      return;
    }
    const out = await actionRoll.fire({ characterId: character._id, ...args });
    if (out) await show(out.roll, out.prompts);
  }

  const hopeCost = experienceIds.length;
  const notEnoughHope = mode !== "damage" && hopeCost > view.hope;
  const manualIncomplete = manual && expected.some((_, i) => toInt(values[i] ?? "") === undefined);

  return (
    <section className="cs-box" aria-label="Dice">
      <h3 className="cs-h">Dice</h3>
      {unavailable ? (
        <p className="cs-small m-0 italic" role="status">
          {view.name} can’t roll right now (dead, away or unconscious).
        </p>
      ) : null}
      <div className="cs-tabs flex flex-wrap gap-2" role="radiogroup" aria-label="Roll type">
        {(
          [
            ["action", "Action"],
            ["reaction", "Reaction"],
            ["damage", "Damage"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className={`cs-pill ${mode === key ? "cs-solid" : ""}`}>
            <input type="radio" name={`mode-${character._id}`} className="sr-only" checked={mode === key} onChange={() => setMode(key)} />
            {label}
          </label>
        ))}
      </div>

      {mode === "damage" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="cs-lbl">Damage source</span>
            <select className="cs-in" value={source} onChange={(e) => setSource(e.target.value)}>
              {weapons.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
              {overrides.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
              <option value="custom">Other dice (spell, feature)</option>
            </select>
          </label>
          {source === "custom" ? (
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="cs-lbl">Dice count</span>
                <input className="cs-in w-20 text-center" inputMode="numeric" value={customCount} onChange={(e) => setCustomCount(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="cs-lbl">Die</span>
                <select className="cs-in" value={customSides} onChange={(e) => setCustomSides(Number(e.target.value))}>
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      d{s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-[16px]">
            <input type="checkbox" className="size-5" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
            Critical (adds the dice’s maximum)
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="cs-lbl">Trait</span>
            <select className="cs-in" value={trait} onChange={(e) => setTrait(e.target.value as TraitId)}>
              {TRAIT_IDS.map((t) => (
                <option key={t} value={t}>
                  {TRAIT_LABEL[t]} ({view.traits[t] >= 0 ? "+" : ""}
                  {view.traits[t]})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cs-lbl">Difficulty</span>
            <input className="cs-in text-center" inputMode="numeric" placeholder="GM’s call" value={difficulty} onChange={(e) => setDifficulty(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
          </label>
          {mode === "action" ? (
            <label className="flex min-h-11 items-center gap-2 self-end text-[16px]">
              <input type="checkbox" className="size-5" checked={attack} onChange={(e) => setAttack(e.target.checked)} />
              Attack roll
            </label>
          ) : null}
        </div>
      )}

      <label className="flex flex-col gap-1 sm:max-w-40">
        <span className="cs-lbl">Modifier</span>
        <input className="cs-in text-center" inputMode="numeric" value={modifier} onChange={(e) => setModifier(e.target.value.replace(/[^0-9-]/g, "").slice(0, 3))} />
      </label>

      {mode !== "damage" ? (
        <>
          {view.experiences.length > 0 ? (
            <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0">
              <legend className="cs-lbl mb-1">Experiences (1 Hope each)</legend>
              {view.experiences.map((e) => (
                <label key={e.id} className="flex min-h-10 items-center gap-2 text-[16px]">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={experienceIds.includes(e.id)}
                    onChange={(ev) => setExperienceIds((ids) => (ev.target.checked ? [...ids, e.id] : ids.filter((id) => id !== e.id)))}
                  />
                  {e.name} (+{e.value})
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <CountStepper label="Advantage" value={advantage} max={6} onChange={setAdvantage} />
            <CountStepper label="Disadvantage" value={disadvantage} max={6} onChange={setDisadvantage} />
            {mode === "action" ? <CountStepper label="Help dice" value={help} max={6} onChange={setHelp} /> : null}
          </div>
        </>
      ) : null}

      {options.length > 0 && !manual ? (
        <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0">
          <legend className="cs-lbl mb-1">Features</legend>
          {options.map((o) =>
            o.auto ? (
              <span key={o.key} className="cs-small">
                {o.label} (always)
              </span>
            ) : (
              <label key={o.key} className="flex min-h-10 items-center gap-2 text-[16px]">
                <input type="checkbox" className="size-5" checked={chosen.includes(o.key)} onChange={(e) => setChosen((ks) => (e.target.checked ? [...ks, o.key] : ks.filter((k) => k !== o.key)))} />
                {o.label}
                {o.cost?.hope ? ` (${o.cost.hope} Hope)` : ""}
              </label>
            ),
          )}
        </fieldset>
      ) : null}

      <label className="flex min-h-11 items-center gap-2 text-[16px]">
        <input type="checkbox" className="size-5" checked={manual} onChange={(e) => setManual(e.target.checked)} />
        Enter physical dice
      </label>
      {manual ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Physical dice">
          {expected.map((d, i) => (
            <label key={`${d.label}-${i}`} className="flex flex-col gap-1">
              <span className="cs-lbl">
                {d.label} (d{d.sides})
              </span>
              <input
                className="cs-in w-20 text-center"
                inputMode="numeric"
                value={values[i] ?? ""}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
                  setValues(next);
                }}
              />
            </label>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="cs-pill cs-solid" disabled={unavailable || pending || notEnoughHope || manualIncomplete} onClick={() => void roll()}>
          {pending ? "Rolling…" : "Roll"}
        </button>
        {notEnoughHope ? <span className="cs-small italic">Not enough Hope for those Experiences.</span> : null}
        <DiceSettingsToggles className="ml-auto" />
      </div>
      <p aria-live="polite" className="m-0 text-[14px] text-[#8e2b2b] empty:hidden">
        {error}
      </p>

      <div ref={stage} className="empty:hidden" />
      {result ? (
        <section aria-label="Last roll" className="flex flex-col gap-2 rounded-[10px] border border-[#d1b98b] bg-[#fffaf0] p-3">
          <p className="m-0 font-display text-[22px]" data-testid="last-roll">
            {rollHeadline(result.roll)}
            {result.roll.manual ? <span className="ml-2 align-middle text-[12px] tracking-[0.12em] uppercase">manual</span> : null}
          </p>
          <DiceFaces dice={result.roll.dice} />
          {result.prompts.map((p) => (
            <div key={p.key} className="cs-small flex flex-wrap items-center gap-2" role="note">
              <span>{p.text}</span>
              {p.choices.map((c) => (
                <span key={c.key} className="rounded-full border border-[#b08a3e] px-2 py-0.5 text-[13px]">
                  {c.label}
                </span>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      <TagTeam campaignId={campaignId} character={character} disabled={unavailable} />
    </section>
  );
}
