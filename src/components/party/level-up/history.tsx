"use client";

import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { availableOptions, offersOption, OPTION_ORDER, OPTION_RULES, picksFor, TIERS } from "@/lib/domain/level-up";
import { MAX_LEVEL } from "@/lib/domain/characters";
import { useIntent } from "@/lib/use-intent";
import type { CharacterSheet } from "@/lib/validation/characters";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import { OPTION_SHORT } from "./shared";

const TIER_LEVELS = { 2: "Levels 2–4", 3: "Levels 5–7", 4: "Levels 8–10" } as const;

/** The tier grid as read-only history (Party board, level-up sheet): marked slots with the level that took them. */
export function TierGrid({ sheet }: { sheet: CharacterSheet }) {
  const options = availableOptions(sheet);
  return (
    <div className="grid gap-4 sm:grid-cols-3" aria-label="Advancement history">
      {TIERS.map((tier) => (
        <section key={tier} aria-label={`Tier ${tier}`} className="flex flex-col gap-2 rounded-[12px] border border-line-2 p-3">
          <h3 className="m-0 font-display text-[15px] font-bold">
            Tier {tier} <span className="font-sans text-[13px] font-normal text-muted-text">· {TIER_LEVELS[tier]}</span>
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {OPTION_ORDER.filter((o) => tier >= OPTION_RULES[o].fromTier && offersOption(sheet, o)).map((option) => {
              const taken = picksFor(sheet, tier, option);
              const blocked = options.find((o) => o.tier === tier && o.option === option)?.blocked;
              const crossed = taken.length === 0 && blocked && !blocked.startsWith("Reach");
              return (
                <li key={option} className="flex items-start gap-2 text-[14px]" title={crossed ? blocked : undefined}>
                  <span className="flex flex-none gap-1 pt-0.5" aria-hidden="true">
                    {Array.from({ length: OPTION_RULES[option].slots }, (_, k) => (
                      <span key={k} className={`inline-block size-3.5 rounded-[3px] border ${k < taken.length ? "border-brand bg-brand" : "border-line-2"}`} />
                    ))}
                  </span>
                  <span className={crossed ? "text-muted-text line-through" : ""}>
                    {OPTION_SHORT[option]}
                    <span className="sr-only">
                      : {taken.length} of {OPTION_RULES[option].slots} marked
                    </span>
                    {taken.length > 0 ? <span className="text-muted-text"> (level {taken.map((t) => t.level).join(", ")})</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** GM correction: sets the level directly, with no automation (decision 4). */
export function CorrectLevel({ characterId, level }: { characterId: Id<"characters">; level: number }) {
  const [value, setValue] = useState(String(level));
  const { fire, error, pending } = useIntent(api.levelUp.correctLevel);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL && n !== level;
  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-line-2 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void fire({ characterId, level: n });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[14px] text-muted-text">GM correction: set the level (no automation)</span>
        <input type="number" min={1} max={MAX_LEVEL} className="min-h-11 w-28 rounded-[10px] border border-line-2 bg-[#1d1a27] px-3 text-parchment" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <BrandButton type="submit" disabled={!valid || pending}>
        Set level
      </BrandButton>
      <p role="alert" className="m-0 w-full text-danger empty:hidden">
        {error}
      </p>
    </form>
  );
}
