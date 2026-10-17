// Journey to Horizon tracker rules (Hope & Fear pp.177, 186): the Doom Track
// and the Soul Echoes count. Pure: shared by Convex and the dashboard.
import { z } from "zod";

import { DOOM_BOXES } from "../doom-track";

export const HORIZON_TRACKER_KEY = "horizon";

/** Tier rules 1–3 apply "after you mark 5 boxes in this tier". */
export const TIER_RULE_THRESHOLD = 5;
/** The party begins with one Soul Echo and needs all ten to reach Horizon (HF p.177). */
export const FIRST_ECHO = 1;
export const MAX_ECHOES = 10;

export const doomBoxStateSchema = z.object({
  marked: z.boolean(),
  session: z.number().int().positive().optional(),
  occurred: z.boolean(),
  markedAt: z.number(),
});

export const horizonStateSchema = z.object({
  boxes: z.record(z.string(), doomBoxStateSchema),
  echoesCollected: z.number().int().min(FIRST_ECHO).max(MAX_ECHOES),
});

export type DoomBoxState = z.infer<typeof doomBoxStateSchema>;
export type HorizonState = z.infer<typeof horizonStateSchema>;
export type DoomTierNumber = 1 | 2 | 3 | 4;

export const INITIAL_HORIZON_STATE: HorizonState = { boxes: {}, echoesCollected: FIRST_ECHO };

/** Stored state (or null when never written) checked against the schema. */
export function parseHorizonState(data: unknown): HorizonState {
  return data === null || data === undefined ? INITIAL_HORIZON_STATE : horizonStateSchema.parse(data);
}

const BOX_BY_ID = new Map(DOOM_BOXES.map((b) => [b.id, b]));

export function doomBox(id: string) {
  return BOX_BY_ID.get(id);
}

export const isMarked = (state: HorizonState, id: string) => state.boxes[id]?.marked === true;

export function markedInTier(state: HorizonState, tier: DoomTierNumber): number {
  return DOOM_BOXES.filter((b) => b.tier === tier && isMarked(state, b.id)).length;
}

/** Tiers 1–3: whether the tier's rule is in force (5 or more boxes marked). */
export function tierRuleActive(state: HorizonState, tier: DoomTierNumber): boolean {
  return tier !== 4 && markedInTier(state, tier) >= TIER_RULE_THRESHOLD;
}

export type MarkRefusal = "UNKNOWN_BOX" | "ALREADY_MARKED" | "TIER_TOO_HIGH" | "PARENT_UNMARKED";
export type UnmarkRefusal = "UNKNOWN_BOX" | "NOT_MARKED" | "CHILD_MARKED";

export const REFUSAL_MESSAGES: Record<MarkRefusal | UnmarkRefusal | "NOT_MARKED_OCCURRED", string> = {
  UNKNOWN_BOX: "That box is not on the Doom Track.",
  ALREADY_MARKED: "That box is already marked.",
  TIER_TOO_HIGH: "Mark a box in the party’s tier or below.",
  PARENT_UNMARKED: "Mark the box it’s nested under first.",
  NOT_MARKED: "That box is not marked.",
  CHILD_MARKED: "Unmark the boxes nested under it first.",
  NOT_MARKED_OCCURRED: "Only a marked event can occur.",
};

/** "Mark a box in the party’s tier or below. You can’t mark a nested box until you mark the box it’s nested under." */
export function markRefusal(state: HorizonState, id: string, partyTier: number): MarkRefusal | null {
  const box = BOX_BY_ID.get(id);
  if (!box) return "UNKNOWN_BOX";
  if (isMarked(state, id)) return "ALREADY_MARKED";
  if (box.tier > partyTier) return "TIER_TOO_HIGH";
  if (box.parent !== null && !isMarked(state, box.parent)) return "PARENT_UNMARKED";
  return null;
}

/** A GM correction: a box can be unmarked only while nothing nested under it is marked. */
export function unmarkRefusal(state: HorizonState, id: string): UnmarkRefusal | null {
  if (!BOX_BY_ID.has(id)) return "UNKNOWN_BOX";
  if (!isMarked(state, id)) return "NOT_MARKED";
  if (DOOM_BOXES.some((b) => b.parent === id && isMarked(state, b.id))) return "CHILD_MARKED";
  return null;
}

/**
 * Tier 4: "Each time you mark a box from this tier, you gain a number of Fear
 * equal to the number of marked boxes in this tier" — counted after the mark.
 */
export function fearForMark(stateAfterMark: HorizonState, id: string): number {
  return BOX_BY_ID.get(id)?.tier === 4 ? markedInTier(stateAfterMark, 4) : 0;
}

export function withMark(state: HorizonState, id: string, markedAt: number, session?: number): HorizonState {
  const entry: DoomBoxState = { marked: true, occurred: false, markedAt };
  if (session !== undefined) entry.session = session;
  return { ...state, boxes: { ...state.boxes, [id]: entry } };
}

export function withoutMark(state: HorizonState, id: string): HorizonState {
  const boxes = { ...state.boxes };
  delete boxes[id];
  return { ...state, boxes };
}

/** What players may see: the Echo count and the text of events that have occurred. */
export function occurredEvents(state: HorizonState): { id: string; tier: DoomTierNumber; text: string }[] {
  return DOOM_BOXES.filter((b) => state.boxes[b.id]?.marked && state.boxes[b.id]?.occurred).map(({ id, tier, text }) => ({
    id,
    tier,
    text,
  }));
}
