"use client";

import { useState } from "react";

import { hordeHalved } from "@/lib/domain/encounters/damage";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { StatBlock } from "../catalogue/stat-block";
import { attackRoll, damageRoll, isNatural20, type BlockRules, type DicePool } from "./rules";
import type { TrackerActions, TrackerInstance } from "./use-tracker";

type Rolled = { text: string; crit: boolean };

function diceText(dice: readonly { sides: number; value: number }[]): string {
  return dice.map((d) => `d${d.sides} ${d.value}`).join(", ");
}

/**
 * The selected instance's parchment stat block (A2's StatBlock) with the tracker's head actions: "Roll attack"
 * (d20 + ATK, CB p.160) and "Roll damage" go through the GM's hidden roll (rolls.gmRoll: players see it only once the
 * GM reveals it in the roll feed); a natural 20 offers "Critical damage" (CB p.148). Above the features, buttons spend
 * Fear for a Fear-cost feature or to add an Experience (CB p.194: "+N, 1 Fear").
 */
export function SelectedBlock({
  campaignId,
  instance,
  rules,
  fear,
  actions,
}: {
  campaignId: Id<"campaigns">;
  instance: TrackerInstance;
  rules: BlockRules;
  fear: number;
  actions: TrackerActions;
}) {
  const roll = useIntent(api.rolls.gmRoll);
  const [rolled, setRolled] = useState<Rolled | null>(null);
  const [spent, setSpent] = useState<string | null>(null);
  const { block } = rules;
  const attack = attackRoll(block.attack.modifier);
  const halved = rules.hordeX !== null && hordeHalved({ hp: instance.hp, hpMax: instance.stats.hpMax });
  const damageText = halved && rules.hordeX ? rules.hordeX : block.attack.damage;
  const damage = damageRoll(damageText);

  async function rollPool(dice: DicePool, modifier: number, what: string) {
    return roll.fire({ campaignId, dice, modifier, label: `${instance.label}: ${what}` });
  }

  async function rollAttack() {
    if (!attack) return;
    const result = await rollPool(attack.dice, attack.modifier, "attack");
    if (!result) return;
    const crit = isNatural20(result.roll.dice);
    setRolled({ text: `Attack ${result.roll.total} (${diceText(result.roll.dice)}${attack.modifier ? `, ${attack.modifier > 0 ? "+" : ""}${attack.modifier}` : ""})${crit ? ": natural 20, a critical success" : ""}`, crit });
  }

  async function rollDamage(critical: boolean) {
    const pool = damageRoll(damageText, critical);
    if (pool === null || "flat" in pool) return;
    const result = await rollPool(pool.dice, pool.modifier, critical ? "critical damage" : "damage");
    if (result) setRolled({ text: `${critical ? "Critical damage" : "Damage"} ${result.roll.total} (${diceText(result.roll.dice)}${pool.modifier ? `, +${pool.modifier}` : ""})`, crit: false });
  }

  async function spend(amount: number, reason: "feature" | "experience", what: string) {
    const result = await actions.spendFear(amount, reason, instance._id);
    if (result) setSpent(`Spent ${amount} Fear: ${what}`);
  }

  const fearFeatures = block.features.filter((f) => f.fearCost);
  const head = (
    <div className="trk-rolls">
      <button type="button" className="trk-btn trk-btn-parch" disabled={!attack || roll.pending} onClick={() => void rollAttack()}>
        Roll attack
      </button>
      {damage && "flat" in damage ? (
        <span className="trk-flat">Deals {damageText}</span>
      ) : (
        <button type="button" className="trk-btn trk-btn-parch" disabled={!damage || roll.pending} onClick={() => void rollDamage(false)}>
          Roll damage{halved ? " (Horde)" : ""}
        </button>
      )}
      {rolled?.crit && damage && !("flat" in damage) ? (
        <button type="button" className="trk-btn trk-btn-parch trk-btn-crit" disabled={roll.pending} onClick={() => void rollDamage(true)}>
          Critical damage
        </button>
      ) : null}
      <p className="trk-roll-out" aria-live="polite">
        {roll.error ?? (rolled ? `${rolled.text}. Hidden from players until you reveal it in the roll feed.` : null)}
      </p>
    </div>
  );

  const fearPanel =
    fearFeatures.length > 0 || block.experiences.length > 0 ? (
      <div className="trk-fear-acts" role="group" aria-label="Spend Fear for this adversary">
        <strong>Spend Fear</strong>
        {fearFeatures.map((f) => (
          <button
            key={f.name}
            type="button"
            className="trk-btn trk-btn-fear"
            disabled={fear < (f.fearCost ?? 1)}
            onClick={() => void spend(f.fearCost ?? 1, "feature", f.name)}
          >
            Spend {f.fearCost} Fear: {f.name}
          </button>
        ))}
        {block.experiences.map((x) => (
          <button key={x.name} type="button" className="trk-btn trk-btn-fear" disabled={fear < 1} onClick={() => void spend(1, "experience", x.name)}>
            {x.name} +{x.value}, 1 Fear
          </button>
        ))}
        <span className="trk-roll-out" aria-live="polite">
          {spent}
        </span>
      </div>
    ) : null;

  return <StatBlock adversary={block} actions={head} tracker={fearPanel} />;
}
