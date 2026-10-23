// Reign of the Weredragon: the Astromancer's Revelations (Hope & Fear
// pp.140-141). Pure module: bundled into Convex functions, relative imports only.
import { z } from "zod";

import { RuleError } from "../../errors/app-error";

export const WEREDRAGON_FRAME_ID = "reign-of-the-weredragon";
export const WEREDRAGON_TRACKER_KEY = "weredragon";

/** The five revelation columns of the Night Sky Reading table, in book order. */
export const REVELATION_KINDS = ["secret", "ally", "key1", "key2", "showdown"] as const;
export type RevelationKind = (typeof REVELATION_KINDS)[number];

export const REVELATION_LABELS: Record<RevelationKind, string> = {
  secret: "Secret’s Location",
  ally: "Powerful Ally",
  key1: "Key to Victory 1",
  key2: "Key to Victory 2",
  showdown: "Showdown Location",
};

/** What each revelation does at the table (HF p.140). */
export const REVELATION_EFFECTS: Record<RevelationKind, string> = {
  secret:
    "Where the PCs must go to learn a secret that could help them defeat Forlorne. Each player writes one secret Forlorne is hiding; between sessions, pick one to inspire the secret they uncover.",
  ally: "This ally has a pool of 3 Hope at the start of any scene with Forlorne as an adversary. A PC within Far range can spend a Hope from it as their own. Unusable if the ally is unconscious or dead.",
  key1: "A defensive item. When Forlorne appears, a PC holding at least one of these items gains 1d4 Hope.",
  key2: "A weapon that can harm Forlorne. A PC wielding it gains +1 Proficiency for attacks against Forlorne.",
  showdown: "Where the PCs are most likely to face Forlorne in their final battle.",
};

/** HF p.140, Fifth Revelation. */
export const SHOWDOWN_EFFECT =
  "If the PCs arrive at the showdown location with the secret, the ally, and both keys to victory, Forlorne appears alone and tries to destroy them. Her passive features “Feed on Fear” and “Terrifying” aren’t available while she’s in this location.";

/** HF p.140: the book's advice when assigning dice. */
export const SPREAD_ADVICE =
  "Spread out where the PCs have to go: avoid having more than one revelation occur in the same place (for example Elevarne or Nightshade).";

export type NightSkyCell = {
  text: string;
  /** Where the PCs must go for this entry (used for the same-place warning). */
  place: string;
};

/**
 * Night Sky Reading table (HF p.141), indexed [kind][die - 1]. Entries marked
 * with an asterisk are described in "Keys to Victory" (HF p.142).
 */
export const NIGHT_SKY: Record<RevelationKind, readonly NightSkyCell[]> = {
  secret: [
    { text: "Nightshade", place: "Nightshade" },
    { text: "Elevarne", place: "Elevarne" },
    { text: "Nwarlyth", place: "Nwarlyth" },
    { text: "Stillwater Lake", place: "Stillwater Lake" },
    { text: "Vexstone Abbey", place: "Vexstone Abbey" },
    { text: "Witch’s End", place: "Witch’s End" },
  ],
  ally: [
    {
      text: "Tiltuk (they/them), a young dryad from the Dryad’s Graveyard. They are oath-sworn to hold back the weredrakes that have overrun their homeland.",
      place: "Dryad’s Graveyard",
    },
    {
      text: "Ehud (he/him), the chieftain of a clan of sapient bears living along the shore of the river that runs through Starlance Grove. He purchases Forlorne’s clemency with regular tribute—but the cost has become intolerable.",
      place: "Starlance Grove",
    },
    {
      text: "B’rahl Zed (he/him), a cave ogre cursed with immortality who roams the Whelvewood. He protects the wilds from Forlorne’s encroachment.",
      place: "The Whelvewood",
    },
    {
      text: "Vexxen (they/them), a demon imprisoned long ago within an obelisk at Knightstead, has power not of this world. Lady Lavender can be convinced to release them.",
      place: "Knightstead",
    },
    {
      text: "Cymor Bucklethorn (he/him), a halfling spymaster of the Whelvian Thieves Guild. He built a network of clandestine operatives to fund a rebellion against Forlorne but was betrayed. As punishment, Forlorne turned him to stone and placed him on display in Vexstone Abbey.",
      place: "Vexstone Abbey",
    },
    {
      text: "Harrowyrr Lykona (she/her), Forlorne’s twin sister, was lost in a fire when she was eleven. She haunts Witch’s End as a charred skeleton wrapped in an ashen shroud.",
      place: "Witch’s End",
    },
  ],
  key1: [
    { text: "A Glider trapped within the Wyrmbolt Tower in Elevarne", place: "Elevarne" },
    { text: "Emberwoven Armor formed from an elder dryad’s ashes in the Dryad’s Graveyard", place: "Dryad’s Graveyard" },
    { text: "An Enlighten Relic from a landmark in the Whelvewood", place: "The Whelvewood" },
    { text: "A Ring of Unbreakable Resolve buried in the ruins of Vexstone Abbey", place: "Vexstone Abbey" },
    { text: "A Clay Companion that’s made a home in the caves below Vexstone Abbey", place: "Vexstone Abbey" },
    { text: "The Zoetrope of the Bright Bacchanal* hidden at Witch’s End", place: "Witch’s End" },
  ],
  key2: [
    { text: "A Legendary Hallowed Axe stuck in a log in Froghaven Bog", place: "Froghaven Bog" },
    { text: "A Legendary Scepter left in Nightshade", place: "Nightshade" },
    { text: "Lady Lavender’s Longsword* from Knightstead", place: "Knightstead" },
    {
      text: "A Stag Knight’s Bramble Sword (use Advanced Cutlass statistics) from the Starlance Grove",
      place: "Starlance Grove",
    },
    { text: "A Firestaff hidden in one of the standing stones of Stillwater Lake", place: "Stillwater Lake" },
    { text: "A Magus Revolver smuggled into Nightshade by a clandestine organization", place: "Nightshade" },
  ],
  showdown: [
    { text: "Nightshade", place: "Nightshade" },
    { text: "Elevarne", place: "Elevarne" },
    { text: "Nwarlyth", place: "Nwarlyth" },
    { text: "Stillwater Lake", place: "Stillwater Lake" },
    { text: "Vexstone Abbey", place: "Vexstone Abbey" },
    { text: "Witch’s End", place: "Witch’s End" },
  ],
};

export const REVELATION_STATUSES = ["hidden", "revealed", "achieved"] as const;
export type RevelationStatus = (typeof REVELATION_STATUSES)[number];

export type Revelation = {
  kind: RevelationKind;
  die: number | null;
  text: string;
  status: RevelationStatus;
};

export type ForlorneSecret = {
  id: string;
  authorId: string;
  text: string;
  used: boolean;
  createdAt: number;
};

export type WeredragonState = {
  revelations: Revelation[];
  secrets: ForlorneSecret[];
  /** The last 5d6 Night Sky roll, waiting for the GM to assign it (null once applied). */
  pendingRoll: number[] | null;
};

export const READING_DICE = 5;
export const TEXT_MAX = 1000;
export const MAX_SECRETS = 200;
/** One player can't use up the campaign's secret slots. */
export const MAX_SECRETS_PER_AUTHOR = 10;

export function defaultWeredragonState(): WeredragonState {
  return {
    revelations: REVELATION_KINDS.map((kind) => ({ kind, die: null, text: "", status: "hidden" })),
    secrets: [],
    pendingRoll: null,
  };
}

export function isDie(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

export function nightSkyEntry(kind: RevelationKind, die: number): NightSkyCell {
  if (!isDie(die)) throw new RuleError("INVALID", "A Night Sky die is a whole number from 1 to 6.");
  return NIGHT_SKY[kind][die - 1];
}

/**
 * Checks a reading assignment: `assignment[i]` is the index into `roll` of the
 * die placed in column `REVELATION_KINDS[i]`. "You can have only one die in each
 * column" and all five dice are used, so it must be a permutation of 0..4.
 */
export function assertAssignment(roll: readonly number[], assignment: readonly number[]): void {
  if (roll.length !== READING_DICE || !roll.every(isDie)) throw new RuleError("INVALID", "A reading is five d6.");
  if (assignment.length !== READING_DICE) throw new RuleError("INVALID", "Assign one die to each of the five revelations.");
  const seen = new Set<number>();
  for (const i of assignment) {
    if (!Number.isInteger(i) || i < 0 || i >= READING_DICE || seen.has(i)) {
      throw new RuleError("INVALID", "Each die goes to exactly one revelation.");
    }
    seen.add(i);
  }
}

/** The dice each column receives under an assignment. */
export function assignedDice(roll: readonly number[], assignment: readonly number[]): number[] {
  assertAssignment(roll, assignment);
  return assignment.map((i) => roll[i]);
}

/** Applies a reading: each revelation takes its die and the table text, and is hidden again. */
export function applyReading(
  state: WeredragonState,
  roll: readonly number[],
  assignment: readonly number[],
): WeredragonState {
  const dice = assignedDice(roll, assignment);
  return {
    ...state,
    pendingRoll: null,
    revelations: REVELATION_KINDS.map((kind, i) => ({
      kind,
      die: dice[i],
      text: nightSkyEntry(kind, dice[i]).text,
      status: "hidden",
    })),
  };
}

export type PlaceClash = { place: string; kinds: RevelationKind[] };

/** Places where more than one revelation lands, given each column's die (null = unset). */
export function placeClashes(dice: readonly (number | null)[]): PlaceClash[] {
  const byPlace = new Map<string, RevelationKind[]>();
  REVELATION_KINDS.forEach((kind, i) => {
    const die = dice[i];
    if (!isDie(die)) return;
    const place = nightSkyEntry(kind, die).place;
    byPlace.set(place, [...(byPlace.get(place) ?? []), kind]);
  });
  return [...byPlace].filter(([, kinds]) => kinds.length > 1).map(([place, kinds]) => ({ place, kinds }));
}

/** Revelations 1–4 achieved: the PCs have the secret, the ally and both keys. */
export function showdownReady(revelations: readonly Revelation[]): boolean {
  return REVELATION_KINDS.slice(0, 4).every((kind) => revelations.find((r) => r.kind === kind)?.status === "achieved");
}

export const revelationKindSchema = z.enum(REVELATION_KINDS);
export const revelationStatusSchema = z.enum(REVELATION_STATUSES);

export const revelationPatchSchema = z
  .object({
    die: z.number().int().min(1, "A die is 1 to 6.").max(6, "A die is 1 to 6.").nullable().optional(),
    text: z.string().trim().max(TEXT_MAX, `Revelations cannot exceed ${TEXT_MAX} characters.`).optional(),
    status: revelationStatusSchema.optional(),
  })
  .strict();
export type RevelationPatch = z.infer<typeof revelationPatchSchema>;

export const secretTextSchema = z
  .string()
  .trim()
  .min(1, "Write the secret first.")
  .max(TEXT_MAX, `Secrets cannot exceed ${TEXT_MAX} characters.`);

/**
 * Updates one revelation. Changing the die without new text re-seeds the text
 * from the Night Sky table; clearing the die keeps the text.
 */
export function patchRevelation(state: WeredragonState, kind: RevelationKind, patch: RevelationPatch): WeredragonState {
  const p = revelationPatchSchema.parse(patch);
  return {
    ...state,
    revelations: state.revelations.map((r) => {
      if (r.kind !== kind) return r;
      const next = { ...r };
      if (p.die !== undefined) {
        next.die = p.die;
        if (p.die !== null && p.text === undefined && p.die !== r.die) next.text = nightSkyEntry(kind, p.die).text;
      }
      if (p.text !== undefined) next.text = p.text;
      if (p.status !== undefined) next.status = p.status;
      return next;
    }),
  };
}

/**
 * What a player may read: revealed revelations (unrevealed ones carry no die or
 * text) and their own secrets, without the GM's "used" mark (it would spoil
 * which idea inspired the secret).
 */
export function playerWeredragonView(state: WeredragonState, userId: string): WeredragonState {
  return {
    revelations: state.revelations.map((r) =>
      r.status === "hidden" ? { kind: r.kind, die: null, text: "", status: "hidden" } : r,
    ),
    secrets: state.secrets.filter((s) => s.authorId === userId).map((s) => ({ ...s, used: false })),
    pendingRoll: state.pendingRoll,
  };
}
