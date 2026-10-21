// Sorcerer (CB 46). Hope feature: Volatile Magic rerolls chosen damage dice of the caster's latest damage roll.
// The dispatcher loads that roll; "an attack that deals magic damage" is the player's call.
// Class feature: Channel Raw Power, once per long rest: vault a loadout card (`params.choice` =
// "hope:<cardId>" or "damage:<cardId>") for Hope equal to its level, or for +2× its level on the damage roll
// of the spell it enhances. The bonus is an effect (`channel-raw-power-<bonus>`, until the scene ends) that
// the dice box offers as a damage option; End it after that roll.
import { applyResourceDelta } from "../../characters/index";
import { DOMAIN_CARDS } from "../../../srd/domain-cards";
import type { CharacterSheet } from "../../../validation/characters";
import type { ClassFeatures, FeatureMeta } from "../types";
import { dieContribution, HOPE_COST, refuse, withEffect } from "./shared";

// CL9: the SRD leaf module, not the srd barrel.
const getDomainCard = (id: string) => DOMAIN_CARDS.find((c) => c.id === id);

const CHANNEL = "channel-raw-power-";

/** The damage bonus of an active Channel Raw Power effect, or 0. */
function channelBonus(sheet: CharacterSheet): number {
  const effect = sheet.effects.find((e) => e.id.startsWith(CHANNEL));
  return effect ? Number(effect.id.slice(CHANNEL.length)) || 0 : 0;
}

/** Channel Raw Power's choices: each loadout card for Hope or for spell damage (`params.choice`). */
function channelChoices(sheet: CharacterSheet): { value: string; label: string }[] {
  return sheet.domainCards.loadout.flatMap((id) => {
    const card = getDomainCard(id);
    if (card === undefined) return [];
    return [
      { value: `hope:${id}`, label: `${card.name}: ${card.level} Hope` },
      { value: `damage:${id}`, label: `${card.name}: +${2 * card.level} spell damage` },
    ];
  });
}

const channelRawPower: FeatureMeta = {
  key: "channelRawPower",
  name: "Channel Raw Power",
  text: "Once per long rest: vault a loadout card to gain Hope equal to its level, or +2× its level to a spell's damage roll.",
  cost: { use: { key: "channelRawPower", until: "longRest" } },
  automation: "auto",
  target: "self",
  inputs: [{ kind: "select", param: "choice", label: "Card to vault", required: true, empty: "Choose a loadout card", options: channelChoices }],
  use: ({ sheet, params }) => {
    const [mode, cardId] = (params.choice ?? "").split(":");
    if ((mode !== "hope" && mode !== "damage") || !cardId) refuse("Choose a loadout card and Hope or damage.");
    const card = getDomainCard(cardId);
    if (card === undefined || !sheet.domainCards.loadout.includes(cardId)) refuse("Choose a card from your loadout.");
    const vaulted = { ...sheet, domainCards: { ...sheet.domainCards, loadout: sheet.domainCards.loadout.filter((id) => id !== cardId) } };
    if (mode === "hope") {
      return { sheet: applyResourceDelta(vaulted, "hope", card.level), summary: `used Channel Raw Power: vaulted ${card.name} for ${card.level} Hope` };
    }
    const bonus = 2 * card.level;
    return {
      sheet: withEffect(
        { ...vaulted, effects: vaulted.effects.filter((e) => !e.id.startsWith(CHANNEL)) },
        { id: `${CHANNEL}${bonus}`, source: "Channel Raw Power", text: `+${bonus} to the damage roll of the spell you enhance. End it after that roll.`, until: "scene" },
      ),
      summary: `used Channel Raw Power: vaulted ${card.name} for +${bonus} spell damage`,
    };
  },
};

export const sorcerer: ClassFeatures = {
  classId: "sorcerer",
  hopeFeature: {
    key: "volatileMagic",
    name: "Volatile Magic",
    text: "Reroll any number of your damage dice on an attack that deals magic damage.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    inputs: [{ kind: "rollDice", param: "dieIndexes", label: "Dice to reroll" }],
    use: ({ sheet, params, rng, roll }) => {
      if (roll?.kind !== "damage") refuse("Your latest roll is not a damage roll.");
      const indexes = [...new Set(params.dieIndexes ?? [])];
      if (indexes.length === 0) refuse("Choose the damage dice to reroll.");
      if (indexes.some((i) => roll.dice[i]?.role !== "damage" || roll.dice[i]?.dropped)) refuse("Only damage dice can be rerolled.");
      let total = roll.total;
      const dice = roll.dice.map((die, i) => {
        if (!indexes.includes(i)) return die;
        const rerolled = { ...die, value: rng(die.sides) };
        total += dieContribution(rerolled) - dieContribution(die);
        return rerolled;
      });
      return {
        sheet,
        roll: { ...roll, dice, total, manual: roll.manual },
        summary: `used Volatile Magic: rerolled ${indexes.length} damage ${indexes.length === 1 ? "die" : "dice"}, ${roll.total} → ${total}`,
      };
    },
  },
  classActions: [channelRawPower],
  rollOptions: (sheet, kind) => {
    const bonus = channelBonus(sheet);
    return kind === "damage" && bonus > 0 ? [{ key: "channelRawPower", label: `Channel Raw Power +${bonus}`, effect: { kind: "modifier", value: bonus } }] : [];
  },
};
