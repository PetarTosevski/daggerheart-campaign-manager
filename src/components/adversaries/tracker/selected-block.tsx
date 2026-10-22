"use client";

import { useRef, useState, type ReactNode } from "react";

import { play3d } from "@/components/party/dice/dice3d";
import { canAnimate3d, useDiceSettings } from "@/components/party/dice/settings";
import { playRollSound } from "@/components/party/dice/sound";

import { hordeHalved } from "@/lib/domain/encounters/damage";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { StatBlock } from "../catalogue/stat-block";
import { attackRoll, damageRoll, isNatural20, type BlockRules, type DicePool } from "./rules";
import type { TrackerInstance } from "./use-tracker";

type Rolled = { text: string; crit: boolean };

function diceText(dice: readonly { sides: number; value: number }[]): string {
  return dice.map((d) => `d${d.sides} ${d.value}`).join(", ");
}

/**
 * The selected instance's parchment stat block (A2's StatBlock) with the tracker's head actions: "Roll attack"
 * (d20 + ATK, CB p.160) and "Roll damage" go through the GM's hidden roll (rolls.gmRoll: players see it only once the
 * GM reveals it in the roll feed); a natural 20 offers "Critical damage" (CB p.148). These stay as the GM's untargeted
 * rolls; the targeted Attack and the feature Use buttons (plan combat-actions AA3) are the actions panel above the
 * features (`renderActions`), which goes through the server. Rolls play the 3D dice and the dice sound like the GM
 * roll form (dice settings: 3D off, reduced motion or sound off fall back as there).
 */
export function SelectedBlock({
  campaignId,
  instance,
  rules,
  renderActions,
}: {
  campaignId: Id<"campaigns">;
  instance: TrackerInstance;
  rules: BlockRules;
  /** The adversary actions panel (AA3), given the 3D dice for the server's attack rolls. */
  renderActions: (onDice: (dice: Parameters<typeof play3d>[1]["dice"]) => void) => ReactNode;
}) {
  const roll = useIntent(api.rolls.gmRoll);
  const [rolled, setRolled] = useState<Rolled | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [settings] = useDiceSettings();
  const { block } = rules;
  const attack = attackRoll(block.attack.modifier);
  const halved = rules.hordeX !== null && hordeHalved({ hp: instance.hp, hpMax: instance.stats.hpMax });
  const damageText = halved && rules.hordeX ? rules.hordeX : block.attack.damage;
  const damage = damageRoll(damageText);

  // The same 3D dice and sound as the GM roll form, per this device's settings; the text result shows right away.
  async function rollPool(dice: DicePool, modifier: number, what: string) {
    const result = await roll.fire({ campaignId, dice, modifier, label: `${instance.label}: ${what}` });
    if (result) void animate(result.roll.dice);
    return result;
  }

  async function animate(dice: Parameters<typeof play3d>[1]["dice"]) {
    const shown = canAnimate3d(settings) && stage.current !== null && (await play3d(stage.current, { dice, sound: settings.sound }));
    if (!shown && settings.sound) playRollSound();
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
      <div ref={stage} className="trk-dice-stage" data-testid="tracker-dice-stage" />
    </div>
  );

  return <StatBlock adversary={block} actions={head} tracker={renderActions((dice) => void animate(dice))} />;
}
