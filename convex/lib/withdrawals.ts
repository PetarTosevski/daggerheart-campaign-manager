import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import { ownedHere } from "./featureOwned";
import type { SanctionAction } from "./validators/combatRequests";

/**
 * The withdrawable uses (combat HUD HD3; `combatWithdraw.withdraw`, and dcm-bxp.99.32.40's GM read
 * `combatRequestsReads.withdrawn`): an open sanction, or a Charge waiting for its Difficulty (the request kind check).
 */
export function withdrawable(payload: Doc<"combatRequests">["payload"]): { characterId: Id<"characters">; action: SanctionAction | "charge" } | null {
  if (payload.kind === "sanction") return { characterId: payload.characterId, action: payload.action };
  if (payload.kind === "difficulty" && payload.ask.kind === "charge") return { characterId: payload.characterId, action: "charge" };
  return null;
}

/** The use's name for the feed line and the GM's toast: the card's or feature's printed name, "a Charge", or "an attack". */
export function withdrawalUseName(action: SanctionAction | "charge", sheet: CharacterSheet | null, campaign: Pick<Doc<"campaigns">, "frameId" | "options">): string {
  if (action === "charge") return "a Charge";
  switch (action.kind) {
    case "attack":
      return "an attack";
    case "card":
      return getDomainCard(action.cardId)?.name ?? "a card";
    case "feature":
      return (sheet ? ownedHere(sheet, campaign).find((f) => f.featureId === action.featureId)?.name : undefined) ?? "a feature use";
  }
}
