"use client";

import { useId, useState } from "react";

import { Label, PaperInput, Pill, SheetBox, Small } from "@/components/party/sheet-ui";
import { availableOptions, offersOption, OPTION_ORDER, OPTION_RULES, picksFor, TIERS, type Tier } from "@/lib/domain/level-up";
import { MAX_LEVEL, tierForLevel } from "@/lib/domain/characters";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";
import type { CharacterSheet } from "@/lib/validation/characters";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import { OPTION_SHORT, OPTION_TEXT } from "./shared";

const UNLOCK_LEVEL = { 2: 2, 3: 5, 4: 8 } as const;

const TIER_TEXT: Record<Tier, { title: string; intro: string; choose: string }> = {
  2: {
    title: "Levels 2–4 (Tier 2)",
    intro: "At level 2, gain an additional Experience at +2 and gain a +1 bonus to your Proficiency.",
    choose: "Choose two options from the list below and mark them.",
  },
  3: {
    title: "Levels 5–7 (Tier 3)",
    intro: "At level 5, gain an additional Experience at +2 and clear all marks on character traits. Then gain a +1 bonus to your Proficiency.",
    choose: "Choose two options from the list below or any from the previous tier and mark them.",
  },
  4: {
    title: "Levels 8–10 (Tier 4)",
    intro: "At level 8, gain an additional Experience at +2 and clear all marks on character traits. Then gain a +1 bonus to your Proficiency.",
    choose: "Choose two options from the list below or any from the previous tier and mark them.",
  },
};

const OUTRO =
  "Update your level and adjust your damage thresholds accordingly. Take an additional domain card of your level or lower from a domain you have access to.";

/**
 * The board's Level Up region (Story & Advancement): budget pill, then the three tier boxes with read-only adv-box
 * checkboxes for the advancements taken (and the level that took them), joined boxes for two-pick options, crossed-out
 * options and locked tiers. Levelling itself happens from the header's level circle.
 */
export function TierBoxes({ sheet }: { sheet: CharacterSheet }) {
  const headId = useId();
  // Crossed-out reasons come from the option list for the next level; at level 10 ask as if one level lower.
  const options = availableOptions({ ...sheet, level: Math.min(sheet.level, MAX_LEVEL - 1) });
  const total = 2 * (sheet.level - 1);
  const used = sheet.advancements.reduce((sum, a) => sum + a.picks.reduce((s, p) => s + OPTION_RULES[p.option].cost, 0), 0);
  const current = tierForLevel(sheet.level);

  return (
    <section className="adv" aria-labelledby={headId}>
      <div className="adv-head">
        <h3 id={headId} className="sh-h">
          Level Up
        </h3>
        <span className={cn("adv-budget", total === 0 ? "locked" : used >= total && "full")}>{total ? `${used} / ${total} advancements used` : "No advancements yet"}</span>
        <Small className="italic">{total ? "2 per level gained. Spend them in your current tier or any tier below it." : "Reach level 2 to choose your first advancements."}</Small>
      </div>
      <div className="adv-tiers">
        {TIERS.map((tier) => {
          const locked = tier > current;
          const text = TIER_TEXT[tier];
          return (
            <SheetBox key={tier} title={text.title} label={`Tier ${tier}`} className={cn(locked && "adv-locked")}>
              {locked ? <span className="adv-budget locked self-center">Reach level {UNLOCK_LEVEL[tier]} to unlock</span> : null}
              <div className="adv-intro">{text.intro}</div>
              <Small className="text-center">{text.choose}</Small>
              <ul className="adv-opts" aria-label={`Tier ${tier} options`}>
                {OPTION_ORDER.filter((o) => tier >= OPTION_RULES[o].fromTier && offersOption(sheet, o)).map((option) => {
                  const rule = OPTION_RULES[option];
                  const taken = picksFor(sheet, tier, option);
                  const blocked = options.find((o) => o.tier === tier && o.option === option)?.blocked;
                  const crossed = taken.length === 0 && Boolean(blocked) && !blocked?.startsWith("Reach");
                  const joined = rule.cost === 2;
                  const boxes = joined ? 1 : rule.slots;
                  return (
                    <li key={option} className="adv-row" title={crossed ? (blocked ?? undefined) : undefined}>
                      <span className="adv-boxes">
                        {Array.from({ length: boxes }, (_, k) => {
                          const pick = taken[k];
                          const name = `Tier ${tier}: ${OPTION_SHORT[option]} ${joined ? "(uses both picks for a level)" : `(${k + 1})`}${pick ? `, taken at level ${pick.level}` : ""}`;
                          return <input key={k} type="checkbox" className={cn("adv-box adv-chk", joined && "joined")} checked={pick !== undefined} readOnly disabled aria-label={name} title={name} />;
                        })}
                      </span>
                      <Small className={cn(crossed && "adv-crossed")}>
                        {OPTION_TEXT[option]}
                        {crossed ? <span className="sr-only"> Crossed out: {blocked}</span> : null}
                        {taken.length > 0 ? <span className="adv-when"> (level {taken.map((t) => t.level).join(", ")})</span> : null}
                      </Small>
                    </li>
                  );
                })}
              </ul>
              <Small className="text-center font-semibold">{OUTRO}</Small>
            </SheetBox>
          );
        })}
      </div>
    </section>
  );
}

/** GM correction under the tier boxes: sets the level directly, with no automation (decision 4). */
export function CorrectLevel({ characterId, level }: { characterId: Id<"characters">; level: number }) {
  const [value, setValue] = useState(String(level));
  const { fire, error, pending } = useIntent(api.levelUp.correctLevel);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL && n !== level;
  return (
    <form
      className="adv-correct"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void fire({ characterId, level: n });
      }}
    >
      <label className="adv-correct-field">
        <Label>GM correction: set the level (no automation)</Label>
        <PaperInput type="number" min={1} max={MAX_LEVEL} style={{ width: 112 }} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <Pill type="submit" variant="solid" disabled={!valid || pending}>
        Set level
      </Pill>
      <p role="alert" className="adv-error empty:hidden">
        {error}
      </p>
    </form>
  );
}
