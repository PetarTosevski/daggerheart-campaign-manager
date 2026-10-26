"use client";

import { useLevelUpDraft } from "@/app/(gm)/campaigns/[campaignId]/party/[characterId]/level-up-draft";
import { HeroCard } from "@/components/party/hero-card";
import { Label, paperField, Small } from "@/components/party/sheet-ui";
import { multiclassSpellcastOption } from "@/lib/domain/characters/spellcast";
import { isMarked, MARK_CLEAR_LEVELS, type MulticlassChoice } from "@/lib/domain/level-up";
import { getSubclass, PORTRAITS } from "@/lib/srd";
import { CLASSES } from "@/lib/srd/classes";
import { DOMAIN_CARDS, DOMAINS } from "@/lib/srd/domain-cards";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { TRAIT_IDS, type TraitId } from "@/lib/srd/types";
import type { AdvancementOption, CharacterSheet } from "@/lib/validation/characters";

import { sourcesFor, traitLabel } from "./shared";

// Inline choosers under a tier box option ticked for the new level (plan guided-level-up, GL1). The chooser logic
// comes from the removed modal stepper (cda2114 stepper.tsx); the choices go into the level-up draft.

const RANK_NEXT = { foundation: "specialization", specialization: "mastery", mastery: "mastery" } as const;
const RANK_TITLE = { specialization: "Specialization", mastery: "Mastery" } as const;

/**
 * The chooser for the draft's `index`th pick of `option` in `tier` (0 = the first), or null for options without one.
 * Only traits take a chooser per pick; the other options with one have a single slot per tier.
 */
export function TierPicker({
  option,
  tier,
  index = 0,
  sheet,
  hopeAndFear,
}: {
  option: AdvancementOption;
  tier: number;
  index?: number;
  sheet: CharacterSheet;
  hopeAndFear: boolean;
}) {
  if (index > 0 && option !== "traits") return null;
  switch (option) {
    case "traits":
      return <TraitPicker tier={tier} index={index} sheet={sheet} />;
    case "experiences":
      return <GoToPicker option="experiences" tier={tier} sheet={sheet} />;
    case "domainCard":
      return <GoToPicker option="domainCard" tier={tier} sheet={sheet} />;
    case "multiclass":
      return <MulticlassPicker sheet={sheet} hopeAndFear={hopeAndFear} />;
    case "subclass":
      return <SubclassCard sheet={sheet} />;
    default:
      return null;
  }
}

const PICK_SUFFIX = ["", " (second pick)", " (third pick)"];

/**
 * Two traits to raise for the `index`th traits pick of `tier`: not marked this tier (marks clear at 5 and 8) and not
 * raised by another pick this level.
 */
function TraitPicker({ tier, index, sheet }: { tier: number; index: number; sheet: CharacterSheet }) {
  const { level, draft, setPickTargets } = useLevelUpDraft();
  const pick = draft.picks.filter((p) => p.option === "traits" && p.tier === tier)[index];
  const chosen = pick?.targets ?? [];
  const elsewhere = draft.picks.filter((p) => p !== pick && p.option === "traits").flatMap((p) => p.targets ?? []);
  const marksClear = MARK_CLEAR_LEVELS.includes(level);
  return (
    <div className="lu-panel adv-picker">
      <Small as="p">
        {index > 0 ? "Second pick: choose two other traits" : "Choose two traits"} to raise by +1 and mark ({chosen.length}/2).
      </Small>
      <div className="lu-chips" role="group" aria-label={`Traits to raise for level ${level}${PICK_SUFFIX[index] ?? ""}`}>
        {TRAIT_IDS.map((t) => {
          const on = chosen.includes(t);
          const otherPick = elsewhere.includes(t);
          const marked = (!marksClear && isMarked({ ...sheet, level }, t)) || otherPick;
          const full = !on && chosen.length >= 2;
          return (
            <button
              key={t}
              type="button"
              className="lu-opt"
              aria-pressed={on}
              disabled={marked || full}
              onClick={() => setPickTargets("traits", tier, on ? chosen.filter((x) => x !== t) : [...chosen, t], index)}
            >
              {traitLabel(t)} {sheet.traits[t] >= 0 ? "+" : ""}
              {sheet.traits[t]}
              {marked ? <span className="lu-opt-note">{otherPick ? "(other pick)" : "(marked)"}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Options whose targets are chosen elsewhere: a button to the Experiences box or the Domain Deck, and what is chosen. */
function GoToPicker({ option, tier, sheet }: { option: "experiences" | "domainCard"; tier: number; sheet: CharacterSheet }) {
  const { draft, goTo } = useLevelUpDraft();
  const targets = draft.picks.find((p) => p.option === option && p.tier === tier)?.targets ?? [];
  const names =
    option === "experiences"
      ? targets.map((id) => sheet.experiences.find((x) => x.id === id)?.name ?? id)
      : targets.map((id) => DOMAIN_CARDS.find((c) => c.id === id)?.name ?? id);
  const needed = option === "experiences" ? 2 : 1;
  return (
    <div className="lu-panel adv-picker">
      <Small as="p">
        {names.length > 0 ? `Chosen: ${names.join(", ")}.` : option === "experiences" ? "Choose the two Experiences to raise." : "Choose the extra card in the Domain Deck."}
        {names.length > 0 && names.length < needed ? " Choose one more." : ""}
      </Small>
      <button type="button" className="lu-opt self-start" onClick={() => goTo(option === "experiences" ? "experiences" : "deck")}>
        {option === "experiences" ? "Choose them in Experiences" : "Choose it in the Domain Deck"}
      </button>
    </div>
  );
}

const EMPTY_MC: MulticlassChoice = { classId: "", domainId: "", subclassId: "" };

/** Multiclass (CB 110): another class, one of its domains the character lacks, and its foundation card. */
function MulticlassPicker({ sheet, hopeAndFear }: { sheet: CharacterSheet; hopeAndFear: boolean }) {
  const { level, draft, setMulticlass } = useLevelUpDraft();
  const mc = draft.multiclass ?? EMPTY_MC;
  const sources = sourcesFor(hopeAndFear);
  const own = CLASSES.find((c) => c.id === sheet.classId);
  const cls = CLASSES.find((c) => c.id === mc.classId);
  return (
    <fieldset className="lu-panel adv-picker adv-mc">
      <legend className="sh-lbl px-1">Multiclass for level {level}</legend>
      <label className="adv-field">
        <Label>Class</Label>
        <select className={paperField.input} value={mc.classId} onChange={(e) => setMulticlass({ classId: e.target.value, domainId: "", subclassId: "" })}>
          <option value="">Choose</option>
          {CLASSES.filter((c) => c.id !== sheet.classId && sources.includes(c.source)).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="adv-field">
        <Label>Domain</Label>
        <select className={paperField.input} value={mc.domainId} disabled={!cls} onChange={(e) => setMulticlass({ ...mc, domainId: e.target.value })}>
          <option value="">Choose</option>
          {(cls?.domains ?? [])
            .filter((d) => !own?.domains.some((x) => x === d))
            .map((d) => (
              <option key={d} value={d}>
                {DOMAINS.find((x) => x.id === d)?.name ?? d}
              </option>
            ))}
        </select>
      </label>
      <label className="adv-field">
        <Label>Foundation card</Label>
        <select
          className={paperField.input}
          value={mc.subclassId}
          disabled={!cls}
          onChange={(e) => setMulticlass({ classId: mc.classId, domainId: mc.domainId, subclassId: e.target.value })}
        >
          <option value="">Choose</option>
          {SUBCLASSES.filter((s) => s.classId === mc.classId && sources.includes(s.source)).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {mc.subclassId ? <SpellcastChoice sheet={sheet} mc={mc} onPick={(t) => setMulticlass({ ...mc, spellcastTrait: t })} /> : null}
    </fieldset>
  );
}

/**
 * CB 111: with a Spellcast trait on both foundation cards, the player picks which one Spellcast Rolls use; without
 * one before, the new subclass's is used (a note). Nothing shows when nothing changes.
 */
function SpellcastChoice({ sheet, mc, onPick }: { sheet: CharacterSheet; mc: MulticlassChoice; onPick: (trait: TraitId) => void }) {
  const option = multiclassSpellcastOption(sheet.subclassId, mc.subclassId);
  const added = getSubclass(mc.subclassId);
  if (option.kind === "forced") {
    return (
      <Small as="p">
        You had no Spellcast trait, so your Spellcast Rolls use {added?.name ?? "the new subclass"}&apos;s: {traitLabel(option.trait)}.
      </Small>
    );
  }
  if (option.kind !== "choose") return null;
  const choices = [
    { trait: option.original, from: getSubclass(sheet.subclassId)?.name ?? "your subclass" },
    { trait: option.added, from: added?.name ?? "the new subclass" },
  ];
  return (
    <div className="adv-field">
      <Label>Spellcast trait for Spellcast Rolls</Label>
      <div className="lu-chips" role="group" aria-label="Spellcast trait for Spellcast Rolls">
        {choices.map((c) => (
          <button key={c.trait} type="button" className="lu-opt" aria-pressed={mc.spellcastTrait === c.trait} onClick={() => onPick(c.trait)}>
            {traitLabel(c.trait)} <span className="lu-opt-note">({c.from})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The upgraded subclass card takes no choice: it shows the card the subclass moves to, as the Heritage & Subclass
 * tab's hero card.
 */
function SubclassCard({ sheet }: { sheet: CharacterSheet }) {
  const { level } = useLevelUpDraft();
  const sub = getSubclass(sheet.subclassId);
  const next = RANK_NEXT[sheet.subclassRank];
  return (
    <div className="lu-panel adv-picker adv-subclass">
      <Small as="p">
        At level {level} you take your {next} card.
      </Small>
      {sub ? (
        <HeroCard kind="Subclass" name={sub.name} tier={RANK_TITLE[next]} features={sub[next]} art={PORTRAITS[`sub-${sub.id}`]} />
      ) : null}
    </div>
  );
}
