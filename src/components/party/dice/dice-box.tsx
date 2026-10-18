"use client";

import "./dice.css";

import { useQuery } from "convex/react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { Label, Pill, SheetBox } from "@/components/party/sheet-ui";
import { BRAWLERS_STRIKE } from "@/lib/domain/class-features/classes/brawler";
import { rollOptions, weaponOverrides } from "@/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "@/lib/domain/class-features/index";
import type { FeatureScope, RollPrompt } from "@/lib/domain/class-features/types";
import { dualityEffects, OUTCOME_LABEL, TYPED_MODIFIER_MAX, weaponDice, type DicePool } from "@/lib/domain/dice";
import { ikonisWeapon } from "@/lib/domain/dice/ikonis";
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
import { AdvantageStepper, BoardDiceToggles, CountStepper, DiceTiles } from "./parts";
import { canAnimate3d, useDiceSettings } from "./settings";
import { playRollSound } from "./sound";
import { TagTeam } from "./tag-team";

type Mode = "action" | "reaction" | "damage";
type Result = { id: number; roll: RollRecord; prompts: RollPrompt[]; label: string; fearGained?: number };

const SIDES = [4, 6, 8, 10, 12, 20] as const;
/** The most advantage or disadvantage dice one roll accepts (the domain's stepper limit). */
const ADVANTAGE_LIMIT = 6;
/** Rolls kept for the "Earlier" list, the newest included (the board keeps six). */
const HISTORY = 6;

const MODES = [
  ["action", "Action"],
  ["reaction", "Reaction"],
  ["damage", "Damage"],
] as const;

const KIND_LABEL: Record<RollRecord["kind"], string> = { action: "Action", reaction: "Reaction", damage: "Damage", free: "Roll" };

function toInt(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** Unavailable characters can't roll (decision 9; the server refuses too). */
function isUnavailable(character: CharacterView): boolean {
  return character.status === "dead" || character.status === "away" || (character.sheet.conditions ?? []).includes("unconscious");
}

function poolLabel(pool: DicePool, flat: number): string {
  return pool.map((d) => `${d.count}d${d.sides}`).join("+") + (flat ? `+${flat}` : "");
}

/** The coloured outcome line: "Critical success", "Success with Hope", "With Fear" (no Difficulty), "Damage". */
function outcomeText(roll: RollRecord): string {
  if (roll.outcome === "none") return KIND_LABEL[roll.kind];
  const base = roll.outcome !== "critical" && roll.difficulty === undefined ? (roll.outcome.endsWith("Hope") ? "with Hope" : "with Fear") : OUTCOME_LABEL[roll.outcome];
  return roll.kind === "reaction" ? `${base} · reaction` : base;
}

function outcomeTone(roll: RollRecord): string {
  if (roll.outcome === "critical") return "crit";
  if (roll.outcome === "none") return "dmg";
  return roll.outcome.endsWith("Hope") ? "hope" : "fear";
}

/** "8 + 9 + 2" when the counted dice and the modifier add up to the total (a critical's bonus does not). */
function partsText(roll: RollRecord): string {
  const terms = roll.dice.filter((d) => !d.dropped).map((d) => (d.role === "disadvantage" ? -d.value : d.value));
  if (roll.modifier) terms.push(roll.modifier);
  if (terms.length < 2 || terms.reduce((a, b) => a + b, 0) !== roll.total) return "";
  return terms.map((t, i) => (i === 0 ? String(t) : t < 0 ? `− ${-t}` : `+ ${t}`)).join(" ");
}

/** The italic consequence line: what the server applied for Hope, Stress and Fear (CB 95, `dualityEffects`). */
function consequence(roll: RollRecord, fearGained: number | undefined): string {
  if (roll.kind === "reaction") return "Reaction rolls don’t generate Hope or Fear.";
  if (roll.kind !== "action") return "";
  const fx = dualityEffects("action", roll.outcome);
  if (fx.clearStress) return "Critical success: you gain a Hope and clear a Stress.";
  if (fx.hope) return "Rolled with Hope: you gain a Hope.";
  if (fx.fear) return fearGained === 0 ? "Rolled with Fear: the GM’s Fear is already full." : "Rolled with Fear: the GM gains a Fear.";
  return "";
}

/** One line of the "Earlier" list: "Action 17 · with Fear (8/9)", "Damage 9". */
function earlierText(roll: RollRecord): string {
  const hope = roll.dice.find((d) => d.role === "hope");
  const fear = roll.dice.find((d) => d.role === "fear");
  const outcome = roll.outcome === "none" ? "" : ` · ${outcomeText(roll)}`;
  return `${KIND_LABEL[roll.kind]} ${roll.total}${outcome}${hope && fear ? ` (${hope.value}/${fear.value})` : ""}${roll.manual ? " · manual" : ""}`;
}

/** Prompts after a roll (Strange Patterns, Favor): each choice is a button that answers through the feature (`classFeatures.use`). */
function RollPrompts({ characterId, prompts }: { characterId: Id<"characters">; prompts: RollPrompt[] }) {
  const answer = useIntent(api.classFeatures.use);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  return prompts.map((p) => (
    <div key={p.key} className="dc-prompt sh-small" role="group" aria-label={p.text}>
      <span>{p.text}</span>
      {answered[p.key] ? (
        <span className="italic" role="status">
          {answered[p.key]}
        </span>
      ) : (
        p.choices.map((c) => (
          <Pill
            key={c.key}
            disabled={answer.pending}
            onClick={() =>
              void answer.fire({ characterId, featureKey: p.featureKey, params: { choice: c.key } }).then((out) => {
                if (out) setAnswered((a) => ({ ...a, [p.key]: out.summary }));
              })
            }
          >
            {c.label}
          </Pill>
        ))
      )}
      {answer.error ? (
        <span role="alert" className="dc-error">
          {answer.error}
        </span>
      ) : null}
    </div>
  ));
}

/** A board chip around a real checkbox (Experiences, features, attack). */
function Chip({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="dc-chip">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/**
 * The dice box on the sheet, in the board's dice toolbar format: action, reaction and damage rolls, server-rolled
 * server-rolled, with Experiences, features, help dice and Tag Team under "Roll options".
 */
export function DiceBox({ campaignId, character, hopeAndFear }: { campaignId: Id<"campaigns">; character: CharacterView; hopeAndFear: boolean }) {
  const view = character.sheet;
  const sheet = useMemo(() => {
    const parsed = characterSheetSchema.safeParse(view);
    return parsed.success ? parsed.data : null;
  }, [view]);
  const unavailable = isUnavailable(character);

  const [mode, setMode] = useState<Mode>("action");
  const [trait, setTrait] = useState<TraitId>("agility");
  const [modifier, setModifier] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [experienceIds, setExperienceIds] = useState<string[]>([]);
  // Net advantage: + advantage dice, − disadvantage dice.
  const [edge, setEdge] = useState(0);
  const [help, setHelp] = useState(0);
  const [attack, setAttack] = useState(false);
  const [ikonisAttack, setIkonisAttack] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [source, setSource] = useState("primary");
  const [customCount, setCustomCount] = useState("1");
  const [customSides, setCustomSides] = useState<number>(6);
  const [critical, setCritical] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<Result[]>([]);
  const [rolling, setRolling] = useState(false);
  const seq = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const [settings] = useDiceSettings();
  const advantage = Math.max(0, edge);
  const disadvantage = Math.max(0, -edge);

  const actionRoll = useIntent(api.rolls.actionRoll);
  const damageRoll = useIntent(api.rolls.damageRoll);
  const pending = actionRoll.pending || damageRoll.pending;
  const error = actionRoll.error ?? damageRoll.error;

  // GM Fear at the right of the toolbar, as on the board (players see it on the dashboard too).
  const campaign = useQuery(api.campaigns.get, { campaignId });
  // The Motherboard module (null in other frames): the Ikonis replaces weapons there (CB 301).
  const extras = useQuery(api.characterExtras.get, { characterId: character._id });
  const motherboard = extras?.motherboard ?? null;
  const scope: FeatureScope = { hopeAndFear, ikonis: motherboard !== null };
  const ikonis = motherboard && sheet ? ikonisWeapon(motherboard.ikonis, motherboard.installed, sheet.level, sheet.proficiency) : null;
  const overrides = sheet ? weaponOverrides(sheet, CLASS_FEATURES, scope) : [];
  const allOptions = sheet ? rollOptions(sheet, mode, CLASS_FEATURES, scope) : [];
  // Brawler's Strike as a primary weapon is listed once, as the I Am the Weapon override, when that applies (HF 10).
  const strikeOverride = overrides.some((o) => o.key === "brawlersStrike");
  const weapons = [
    { key: "primary", id: view.primaryWeaponId },
    { key: "secondary", id: view.secondaryWeaponId },
  ].flatMap(({ key, id }) => {
    const w = id ? WEAPONS.find((x) => x.id === id) : undefined;
    if (!w || (w.id === BRAWLERS_STRIKE && strikeOverride)) return [];
    try {
      const { dice, flat } = weaponDice(w.damage, view.proficiency, w.id === BRAWLERS_STRIKE);
      return [{ key, label: `${key === "primary" ? "Primary" : "Secondary"}: ${w.name} (${poolLabel(dice, flat)})`, dice }];
    } catch {
      return [];
    }
  });
  const ikonisLabel = ikonis ? `Ikonis: ${ikonis.label} (${poolLabel(ikonis.dice, ikonis.flat)})` : "";
  const sources = [...weapons.map((w) => w.key), ...(ikonis ? ["ikonis"] : []), ...overrides.map((o) => o.key), "custom"];
  const damageSourceKey = sources.includes(source) ? source : sources[0]!;
  // Physical-only options (Combat Training, CB 48) are left out for a magic damage source, as the server does.
  const magicSource =
    mode === "damage" &&
    ((damageSourceKey === "primary" || damageSourceKey === "secondary"
      ? WEAPONS.find((w) => w.id === (damageSourceKey === "primary" ? view.primaryWeaponId : view.secondaryWeaponId))?.damageType
      : overrides.find((o) => o.key === damageSourceKey)?.damageType) === "magic");
  const options = allOptions.filter((o) => !(o.physicalOnly && magicSource));
  const useIkonis = mode === "action" && ikonisAttack && ikonis !== null;
  const rollTrait = useIkonis && ikonis.trait ? ikonis.trait : trait;

  /** What the result row says the roll was: "Presence +2 action roll vs 12", "Primary: Rapier (1d8) · critical". */
  function rollLabel(): string {
    if (mode === "damage") {
      const name =
        weapons.find((w) => w.key === damageSourceKey)?.label ??
        (damageSourceKey === "ikonis" ? ikonisLabel : (overrides.find((o) => o.key === damageSourceKey)?.label ?? `${toInt(customCount) ?? 0}d${customSides}`));
      return `${name}${critical ? " · critical" : ""}`;
    }
    const diff = toInt(difficulty);
    return `${TRAIT_LABEL[rollTrait]} ${signed(view.traits[rollTrait])} ${mode} roll${diff !== undefined ? ` vs ${diff}` : ""}`;
  }

  async function show(roll: RollRecord, prompts: RollPrompt[], label: string, fearGained?: number) {
    const animate = canAnimate3d(settings) && stage.current !== null;
    if (animate) setRolling(true);
    const shown = animate && (await play3d(stage.current!, { dice: roll.dice, sound: settings.sound }));
    setRolling(false);
    if (!shown && settings.sound) playRollSound();
    seq.current += 1;
    const entry: Result = { id: seq.current, roll, prompts, label, ...(fearGained !== undefined ? { fearGained } : {}) };
    setResult(entry);
    setHistory((h) => [entry, ...h].slice(0, HISTORY));
  }

  async function roll() {
    setResult(null);
    const label = rollLabel();
    const mod = toInt(modifier) ?? 0;
    const picked = chosen.filter((k) => options.some((o) => o.key === k));
    if (mode === "damage") {
      const damageSource =
        damageSourceKey === "primary" || damageSourceKey === "secondary"
          ? { kind: "weapon" as const, slot: damageSourceKey === "primary" ? ("primary" as const) : ("secondary" as const) }
          : damageSourceKey === "custom"
            ? { kind: "dice" as const, dice: [{ count: toInt(customCount) ?? 0, sides: customSides }] }
            : damageSourceKey === "ikonis"
              ? { kind: "ikonis" as const }
              : { kind: "override" as const, key: damageSourceKey };
      const args = { source: damageSource, critical, modifier: mod, options: picked };
      const out = await damageRoll.fire({ characterId: character._id, ...args });
      if (out) await show(out.roll, [], label);
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
      attack: mode === "action" && (attack || useIkonis),
      options: picked,
      ...(useIkonis ? { ikonis: true } : {}),
    };
    const out = await actionRoll.fire({ characterId: character._id, ...args });
    if (out) await show(out.roll, out.prompts, label, out.fearGained);
  }

  const hopeCost = experienceIds.length;
  const notEnoughHope = mode !== "damage" && hopeCost > view.hope;
  const modifierTooBig = Math.abs(toInt(modifier) ?? 0) > TYPED_MODIFIER_MAX;
  const canRoll = !(unavailable || pending || notEnoughHope || modifierTooBig);
  const earlier = history.slice(1);

  const modField = (
    <label className="dc-field dc-narrow">
      <Label>Mod</Label>
      <input className="dc-in" inputMode="numeric" placeholder="+0" value={modifier} onChange={(e) => setModifier(e.target.value.replace(/[^0-9+-]/g, "").slice(0, 3))} />
    </label>
  );

  return (
    <SheetBox label="Dice" className="dc-box">
      {unavailable ? (
        <p className="sh-small m-0 italic" role="status">
          {view.name} can’t roll right now (dead, away or unconscious).
        </p>
      ) : null}
      <div className="dc-bar">
        <h3 className="sh-h dc-h">
          <span aria-hidden="true">🎲 </span>Dice
        </h3>
        <div className="dc-seg" role="radiogroup" aria-label="Roll type">
          {MODES.map(([key, label]) => (
            <label key={key} className="dc-seg-opt">
              <input type="radio" name={`mode-${character._id}`} className="sr-only" checked={mode === key} onChange={() => setMode(key)} />
              {label}
            </label>
          ))}
        </div>

        {mode === "damage" ? (
          <>
            <label className="dc-field dc-source">
              <Label>Damage source</Label>
              <select className="dc-in" value={damageSourceKey} onChange={(e) => setSource(e.target.value)}>
                {weapons.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
                {ikonis ? <option value="ikonis">{ikonisLabel}</option> : null}
                {overrides.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
                <option value="custom">Other dice (spell, feature)</option>
              </select>
            </label>
            {damageSourceKey === "custom" ? (
              <>
                <label className="dc-field dc-narrow">
                  <Label>Dice count</Label>
                  <input className="dc-in" inputMode="numeric" value={customCount} onChange={(e) => setCustomCount(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
                </label>
                <label className="dc-field dc-narrow">
                  <Label>Die</Label>
                  <select className="dc-in" value={customSides} onChange={(e) => setCustomSides(Number(e.target.value))}>
                    {SIDES.map((s) => (
                      <option key={s} value={s}>
                        d{s}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            {modField}
            <label className="dc-toggle dc-crit" title="Critical hit: adds the dice’s maximum">
              <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
              <span aria-hidden="true">{critical ? "✓ " : ""}</span>
              Critical hit<span aria-hidden="true">{critical ? " (+max dice)" : "?"}</span>
            </label>
            <Pill variant="solid" className="dc-go" disabled={!canRoll} onClick={() => void roll()}>
              {pending ? (
                "Rolling…"
              ) : (
                <>
                  <span aria-hidden="true">⚔ </span>Roll<span aria-hidden="true"> damage</span>
                </>
              )}
            </Pill>
          </>
        ) : (
          <>
            <label className="dc-field dc-trait">
              <Label>Trait</Label>
              <select className="dc-in" value={rollTrait} disabled={useIkonis && ikonis.trait !== null} onChange={(e) => setTrait(e.target.value as TraitId)}>
                {TRAIT_IDS.map((t) => (
                  <option key={t} value={t}>
                    {TRAIT_LABEL[t]} {signed(view.traits[t])}
                  </option>
                ))}
              </select>
            </label>
            {modField}
            <label className="dc-field dc-narrow dc-diff">
              <Label>Difficulty</Label>
              <input className="dc-in" inputMode="numeric" placeholder="—" title="The GM’s call" value={difficulty} onChange={(e) => setDifficulty(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
            </label>
            <AdvantageStepper value={edge} limit={ADVANTAGE_LIMIT} onChange={setEdge} />
            <Pill variant="roll" className="dc-go" disabled={!canRoll} onClick={() => void roll()}>
              {pending ? (
                "Rolling…"
              ) : (
                <>
                  Roll<span aria-hidden="true"> Hope &amp; Fear</span>
                </>
              )}
            </Pill>
          </>
        )}

        <div className="dc-end">
          <BoardDiceToggles />
          {campaign ? (
            <span className="sh-small dc-fear">
              GM Fear <strong>{campaign.fear}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {notEnoughHope || modifierTooBig ? (
        <p className="sh-small dc-note m-0">
          {notEnoughHope ? "Not enough Hope for those Experiences. " : ""}
          {modifierTooBig ? `The modifier goes from −${TYPED_MODIFIER_MAX} to +${TYPED_MODIFIER_MAX}.` : ""}
        </p>
      ) : null}
      <p aria-live="polite" className="dc-error m-0 empty:hidden">
        {error}
      </p>

      <details className="dc-opts" open>
        <summary className="sh-lbl">Roll options</summary>
        <div className="dc-opts-row">
          {mode !== "damage" && view.experiences.length > 0 ? (
            <fieldset className="dc-group">
              <legend className="sh-lbl">Experiences (1 Hope each)</legend>
              {view.experiences.map((e) => (
                <Chip key={e.id} checked={experienceIds.includes(e.id)} onChange={(on) => setExperienceIds((ids) => (on ? [...ids, e.id] : ids.filter((id) => id !== e.id)))}>
                  {e.name} (+{e.value})
                </Chip>
              ))}
            </fieldset>
          ) : null}
          {mode === "action" ? (
            <div className="dc-group">
              <Chip checked={attack} onChange={setAttack}>
                Attack roll
              </Chip>
              {ikonis ? (
                <Chip checked={ikonisAttack} onChange={setIkonisAttack}>
                  Ikonis attack ({ikonis.label}
                  {ikonis.attack ? `, +${ikonis.attack}` : ""}
                  {ikonis.advantage ? ", advantage" : ""})
                </Chip>
              ) : null}
              <CountStepper label="Help dice" value={help} max={ADVANTAGE_LIMIT} onChange={setHelp} />
            </div>
          ) : null}
          {options.length > 0 ? (
            <fieldset className="dc-group">
              <legend className="sh-lbl">Features</legend>
              {options.map((o) =>
                o.auto ? (
                  <span key={o.key} className="dc-chip on static">
                    {o.label} (always)
                  </span>
                ) : (
                  <Chip key={o.key} checked={chosen.includes(o.key)} onChange={(on) => setChosen((ks) => (on ? [...ks, o.key] : ks.filter((k) => k !== o.key)))}>
                    {o.label}
                    {o.cost?.hope ? ` (${o.cost.hope} Hope)` : ""}
                  </Chip>
                ),
              )}
            </fieldset>
          ) : null}
          <div className="dc-group">
            <TagTeam campaignId={campaignId} character={character} disabled={unavailable} />
          </div>
        </div>
      </details>

      <div ref={stage} className="empty:hidden" />
      <div className="dc-results empty:hidden">
        {pending || rolling ? (
          <p role="status" className="sh-small dc-rolling m-0">
            The dice are rolling…
          </p>
        ) : null}
        {result ? (
          <section aria-label="Last roll" className="dc-last">
            <div className="dc-last-row">
              <DiceTiles roll={result.roll} />
              <div className="dc-last-main" data-testid="last-roll">
                <span className="dc-total">{result.roll.total}</span>
                <span className="dc-last-text">
                  <span className={`dc-outcome ${outcomeTone(result.roll)}`}>
                    {outcomeText(result.roll)}
                    {result.roll.manual ? <span className="dc-manual">manual</span> : null}
                  </span>
                  <span className="sh-small">
                    {result.label}
                    {partsText(result.roll) ? ` (${partsText(result.roll)})` : ""}
                  </span>
                  {consequence(result.roll, result.fearGained) ? <span className="sh-small italic">{consequence(result.roll, result.fearGained)}</span> : null}
                </span>
              </div>
            </div>
            <RollPrompts characterId={character._id} prompts={result.prompts} />
          </section>
        ) : null}
        {earlier.length > 0 ? (
          <div className="dc-earlier sh-small">
            <span className="sh-lbl" id={`earlier-${character._id}`}>
              Earlier
            </span>
            <ul aria-labelledby={`earlier-${character._id}`}>
              {earlier.map((r) => (
                <li key={r.id}>{earlierText(r.roll)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SheetBox>
  );
}
