// Dark Heart of Andaluria: the Hunt and Liminal Clues (Hope & Fear pp.154-155).
// Pure module: bundled into Convex functions, relative imports only.
import { z } from "zod";

import { RuleError } from "../../errors/app-error";

export const ANDALURIA_FRAME_ID = "dark-heart-of-andaluria";
export const ANDALURIA_TRACKER_KEY = "andaluria";

/** HF p.154: "Arrival, Investigation, Escalation, Confrontation, and Epilogue". */
export const HUNT_BEATS = ["arrival", "investigation", "escalation", "confrontation", "epilogue"] as const;
export type HuntBeat = (typeof HUNT_BEATS)[number];

export const BEAT_LABELS: Record<HuntBeat, string> = {
  arrival: "Arrival",
  investigation: "Investigation",
  escalation: "Escalation",
  confrontation: "Confrontation",
  epilogue: "Epilogue",
};

/** HF p.154, one line per beat. */
export const BEAT_HINTS: Record<HuntBeat, string> = {
  arrival: "The PCs are hooked into the adventure with a strange event that implies monster activity.",
  investigation: "The PCs follow leads and gather clues to discover the truth of the monster.",
  escalation: "The PCs bring together what they’ve discovered and develop a plan for finding and defeating it.",
  confrontation: "The PCs attempt to banish, bind, or destroy the monster using what they’ve learned.",
  epilogue: "The PCs wrap up loose ends and move on to their next mission.",
};

/** HF p.154: "devise 4 to 6 pieces of information or evidence". */
export const SUGGESTED_CLUES = { min: 4, max: 6 } as const;
export const MAX_CLUES = 12;
// Keeps the whole tracker row well under Convex's 1 MiB document limit (~37 KB per full hunt).
export const MAX_HUNTS = 20;
export const MAX_LIST_ITEMS = 20;
export const FIELD_MAX = 1000;

export type Clue = {
  id: string;
  text: string;
  revealed: boolean;
  /** GM note (for example how the clue manifested). Never shown to players. */
  note: string;
};

export type Hunt = {
  id: string;
  title: string;
  /** The monster's name. */
  monster: string;
  /** What is it? */
  what: string;
  /** What does it want? */
  wants: string;
  /** Where can you find it? */
  where: string;
  /** How can you defeat it? */
  defeat: string;
  beat: HuntBeat;
  clues: Clue[];
  underlings: string[];
  bystanders: string[];
  archived: boolean;
  /** GM toggle: players also see the monster and its answers. */
  monsterRevealed: boolean;
  createdAt: number;
};

export type AndaluriaState = { hunts: Hunt[] };

export function defaultAndaluriaState(): AndaluriaState {
  return { hunts: [] };
}

const field = (label: string) =>
  z.string().trim().max(FIELD_MAX, `${label} cannot exceed ${FIELD_MAX} characters.`);
const list = (label: string) =>
  z
    .array(z.string().trim().min(1).max(200, `${label} entries cannot exceed 200 characters.`))
    .max(MAX_LIST_ITEMS, `At most ${MAX_LIST_ITEMS} ${label.toLowerCase()}.`);

export const huntBeatSchema = z.enum(HUNT_BEATS);
export const huntTitleSchema = z.string().trim().min(1, "Name the hunt.").max(100, "Hunt names cannot exceed 100 characters.");

export const huntPatchSchema = z
  .object({
    title: huntTitleSchema.optional(),
    monster: field("Monster").optional(),
    what: field("What it is").optional(),
    wants: field("What it wants").optional(),
    where: field("Where it is").optional(),
    defeat: field("How to defeat it").optional(),
    beat: huntBeatSchema.optional(),
    underlings: list("Underlings").optional(),
    bystanders: list("Bystanders").optional(),
    archived: z.boolean().optional(),
    monsterRevealed: z.boolean().optional(),
  })
  .strict();
export type HuntPatch = z.infer<typeof huntPatchSchema>;

export const clueTextSchema = z.string().trim().min(1, "Write the clue first.").max(FIELD_MAX, `Clues cannot exceed ${FIELD_MAX} characters.`);
export const cluePatchSchema = z
  .object({
    text: clueTextSchema.optional(),
    note: field("Notes").optional(),
    revealed: z.boolean().optional(),
  })
  .strict();
export type CluePatch = z.infer<typeof cluePatchSchema>;

function findHunt(state: AndaluriaState, huntId: string): Hunt {
  const hunt = state.hunts.find((h) => h.id === huntId);
  if (!hunt) throw new RuleError("INVALID", "That hunt no longer exists.");
  return hunt;
}

function mapHunt(state: AndaluriaState, huntId: string, fn: (h: Hunt) => Hunt): AndaluriaState {
  findHunt(state, huntId);
  return { hunts: state.hunts.map((h) => (h.id === huntId ? fn(h) : h)) };
}

export function createHunt(state: AndaluriaState, id: string, title: string, now: number): AndaluriaState {
  if (state.hunts.length >= MAX_HUNTS) throw new RuleError("INVALID", `A campaign can hold at most ${MAX_HUNTS} hunts.`);
  const hunt: Hunt = {
    id,
    title: huntTitleSchema.parse(title),
    monster: "",
    what: "",
    wants: "",
    where: "",
    defeat: "",
    beat: "arrival",
    clues: [],
    underlings: [],
    bystanders: [],
    archived: false,
    monsterRevealed: false,
    createdAt: now,
  };
  return { hunts: [...state.hunts, hunt] };
}

export function patchHunt(state: AndaluriaState, huntId: string, patch: HuntPatch): AndaluriaState {
  const p = huntPatchSchema.parse(patch);
  return mapHunt(state, huntId, (h) => ({ ...h, ...p }));
}

export function removeHunt(state: AndaluriaState, huntId: string): AndaluriaState {
  findHunt(state, huntId);
  return { hunts: state.hunts.filter((h) => h.id !== huntId) };
}

export function addClue(state: AndaluriaState, huntId: string, clueId: string, text: string): AndaluriaState {
  const clean = clueTextSchema.parse(text);
  return mapHunt(state, huntId, (h) => {
    if (h.clues.length >= MAX_CLUES) throw new RuleError("INVALID", `A hunt can hold at most ${MAX_CLUES} clues.`);
    return { ...h, clues: [...h.clues, { id: clueId, text: clean, revealed: false, note: "" }] };
  });
}

export function patchClue(state: AndaluriaState, huntId: string, clueId: string, patch: CluePatch): AndaluriaState {
  const p = cluePatchSchema.parse(patch);
  return mapHunt(state, huntId, (h) => {
    if (!h.clues.some((c) => c.id === clueId)) throw new RuleError("INVALID", "That clue no longer exists.");
    return { ...h, clues: h.clues.map((c) => (c.id === clueId ? { ...c, ...p } : c)) };
  });
}

export function removeClue(state: AndaluriaState, huntId: string, clueId: string): AndaluriaState {
  return mapHunt(state, huntId, (h) => {
    if (!h.clues.some((c) => c.id === clueId)) throw new RuleError("INVALID", "That clue no longer exists.");
    return { ...h, clues: h.clues.filter((c) => c.id !== clueId) };
  });
}

/** HF p.154: "Once all clues have emerged, the PCs can confront the horror fully armed with knowledge." */
export function allCluesRevealed(hunt: Pick<Hunt, "clues">): boolean {
  return hunt.clues.length > 0 && hunt.clues.every((c) => c.revealed);
}

export type PlayerHunt = {
  id: string;
  title: string;
  beat: HuntBeat;
  archived: boolean;
  /** Revealed ("solid") clues only, without GM notes. */
  clues: { id: string; text: string }[];
  allCluesRevealed: boolean;
  /** Present only when the GM revealed the monster. */
  monster?: { monster: string; what: string; wants: string; where: string; defeat: string };
};

/** What a player may read about a hunt: its title, beat and revealed clues (and the monster once revealed). */
export function playerHuntView(hunt: Hunt): PlayerHunt {
  return {
    id: hunt.id,
    title: hunt.title,
    beat: hunt.beat,
    archived: hunt.archived,
    clues: hunt.clues.filter((c) => c.revealed).map((c) => ({ id: c.id, text: c.text })),
    allCluesRevealed: allCluesRevealed(hunt),
    ...(hunt.monsterRevealed
      ? { monster: { monster: hunt.monster, what: hunt.what, wants: hunt.wants, where: hunt.where, defeat: hunt.defeat } }
      : {}),
  };
}
