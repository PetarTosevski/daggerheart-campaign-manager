import { CONDITIONS } from "@/lib/validation/characters";

/** Token sides as the board shows them (Combat.dc.html `SIDE`): label and ring colour. */
export const SIDES = {
  pc: { label: "Party", colour: "#e3b45a" },
  enemy: { label: "Enemy", colour: "#c0392b" },
  ally: { label: "Ally", colour: "#4f9e72" },
  neutral: { label: "Neutral", colour: "#8a9aa0" },
} as const satisfies Record<"pc" | "enemy" | "ally" | "neutral", { label: string; colour: string }>;

/** A PC's conditions: the character sheet's list (src/lib/validation/characters.ts). */
export const PC_CONDITIONS = CONDITIONS.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));

/** The encounter tracker's conditions (CB p.102; convex/lib/validators/encounters.ts), for adversary and custom tokens. */
export const TRACKER_CONDITIONS = [
  { id: "hidden", label: "Hidden" },
  { id: "restrained", label: "Restrained" },
  { id: "vulnerable", label: "Vulnerable" },
  { id: "distracted", label: "Distracted" },
] as const;
