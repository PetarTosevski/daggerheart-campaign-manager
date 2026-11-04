import { ConvexError } from "convex/values";

import {
  readShortfall,
  shortfallHint,
  shortfallLabel,
  shortfallSentence,
  shortfallTag,
  shortfallTitle,
  shortResourcesFromText,
  visibleShortfall,
  type Shortfall,
  type ShortfallViewer,
} from "@/lib/domain/combat-actions/shortfall";

import { errorMessage } from "../convex-errors";
import { adversaryActionMessages } from "./adversaryActions";
import { combatActionMessages } from "./combatActions";
import { combatFeatureMessages } from "./combatFeatures";
import { combatMapMessages } from "./combatMap";
import { spotlightMessages } from "./spotlight";

/**
 * The refusal table (plan combat-hud H6.1; board CmpBlocked "Every refusal"): every combat refusal code mapped to the
 * board's situation title, message (a bold lead and the rest), hint, and the form it takes before the click. One module
 * for every HUD control (H6.2 player surfaces, H6.3 GM surfaces): no control writes its own refusal text. Keyed on the
 * code, never the server's text (spotlight.ts / best-practices rule 9). API and code map: docs/tasks/TASK-HUD-H6.1.md.
 *
 * Messages never name an enemy's HP, Stress, Difficulty or thresholds (HANDOFF hard rule 2): a shortfall paid by an
 * adversary loses its numbers for a player (shortfall.ts `visibleShortfall`).
 */

// ---------------------------------------------------------------- types

/**
 * How a known limit shows before the click (CmpBlocked's last column). The surface that owns the control draws it;
 * `toast` / `none` mean nothing shows before the click (the refusal only comes from the server).
 */
export type BeforeForm =
  /** A tag above the hand card ("Needs 1 Hope", "Out of combat"). */
  | "card-tag"
  /** The card's or panel's Use button disabled with its reason. */
  | "use-disabled"
  /** A feature's Use disabled on the sheet / ring, with its reason. */
  | "feature-disabled"
  /** The option is left out of the hit window ("Mark an Armor Slot" with none left). */
  | "option-hidden"
  /** "Used · back after a rest" on the card. */
  | "used-tag"
  /** The sheet's feature badge ("Used"). */
  | "sheet-badge"
  /** The picker's counter ("2 / 2") stops further picks. */
  | "picker-counter"
  /** The target's ring dimmed (can't be targeted). */
  | "ring-dimmed"
  /** The target's ring dotted (no line of sight). */
  | "ring-dotted"
  /** The target's ring plus a hint ("Move next to the Bandit first"). */
  | "ring-hint"
  /** A GM Fear cost disabled ("This needs 2 Fear. You have 1."). */
  | "fear-disabled"
  /** The adversary's attack / feature disabled until it is spotlit. */
  | "attack-disabled"
  /** Every non-reaction control disabled while the GM holds the spotlight (H6.2). */
  | "control-disabled"
  | "toast"
  | "none";

/** Where the click-time refusal shows: under the pressed control (layer 2) or as a toast near the hand (layer 3). */
export type RefusalPlace = "inline" | "toast";

/** What the surface does after showing it: refresh its data (an answered request) or snap the token back. */
export type RefusalThen = "refresh" | "snap-back";

/** Names and numbers the caller knows, filled into the board's sentences ("Wall Walk needs 1 Hope."). */
export type RefusalContext = {
  /** The card or feature used ("Wall Walk", "Rune Ward"). */
  subject?: string | null;
  /** The target's display name as the viewer sees it ("the Bandit", "the Lieutenant"); never a number. */
  target?: string | null;
  /** The picker's maximum ("Pick up to 2 targets"). */
  max?: number | null;
  /** The adversary to spotlight ("the Lieutenant"). */
  adversary?: string | null;
  /** The client pre-compute (shortfall.ts `shortfallOf`), used when the server sends no structured shortfall. */
  shortfall?: readonly Shortfall[] | null;
  /** Who reads it (default "player"): a player never sees an adversary's numbers. */
  viewer?: ShortfallViewer;
};

/** One resolved refusal, ready to render: the toast and the inline message read the same fields. */
export type Refusal = {
  /** The server's code, `FALLBACK` for anything unknown, or a client-only key (`CLIENT_REFUSALS`). */
  code: string;
  /** CmpBlocked's "Situation" ("Not enough Hope"): the toast's bold title. */
  title: string;
  /** The message's bold lead ("Wall Walk needs 1 Hope."). */
  lead: string;
  /** The rest of the message ("You have 0."), or null. */
  rest: string | null;
  /** How to fix it ("Roll with Hope, or rest, to gain Hope."), or null. */
  hint: string | null;
  /** `lead` + `rest` as one string (aria descriptions, titles). */
  text: string;
  before: readonly BeforeForm[];
  place: RefusalPlace;
  then: RefusalThen | null;
  /** The toast's look: `block` (amber lock, a refusal) or `neutral` (grey, nothing went wrong: "Already answered"). */
  tone: "block" | "neutral";
  /** The shortfalls behind a cost refusal (already redacted for the viewer). */
  shortfall: readonly Shortfall[];
};

type Line = { lead: string; rest?: string | null };

type Entry = {
  /** The board row this code stands for (`FEATURE_USED*` → FEATURE_EXHAUSTED), for the docs and tests. */
  row: string;
  title: string;
  /** The board's sentence from what the caller knows; `server` is the refusal's own message, when it sent one. */
  line: (ctx: RefusalContext, server: string | null) => Line;
  hint: string | null;
  before: readonly BeforeForm[];
  place?: RefusalPlace;
  then?: RefusalThen;
  tone?: "block" | "neutral";
  /** A cost refusal: the message comes from the shortfall (structured, else the client's, else the server's words). */
  cost?: true;
};

/** Every combat domain's codes (the modules `tests/unit/hud/refusals.test.ts` also checks file by file). */
export type CombatRefusalCode =
  | keyof typeof combatActionMessages
  | keyof typeof combatFeatureMessages
  | keyof typeof combatMapMessages
  | keyof typeof adversaryActionMessages
  | keyof typeof spotlightMessages;

/** Common and other domains' codes the combat surfaces also meet. */
type SharedCode = "INVALID" | "NOT_FOUND" | "RATE_LIMITED" | "NOT_ENOUGH_HOPE" | "FEAR_EMPTY" | "CHARACTER_UNAVAILABLE" | "ENCOUNTER_NOT_RUNNING";

export type RefusalCode = CombatRefusalCode | SharedCode;

// ---------------------------------------------------------------- helpers

/** "the Bandit" / "that target": a name as the middle of a sentence. */
const named = (name: string | null | undefined, fallback: string) => name?.trim() || fallback;
const capital = (s: string) => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The server's own sentence wins when it is specific (it names what the template can't); else the template. */
const serverOr = (server: string | null, line: Line): Line => (server ? { lead: server } : line);

/** A simple row: the domain's message, nothing before the click, under the control. */
const plain = (row: string, title: string, message: string, extra: Partial<Entry> = {}): Entry => ({
  row,
  title,
  line: (_ctx, server) => serverOr(server, { lead: message }),
  hint: null,
  before: ["none"],
  ...extra,
});

// ---------------------------------------------------------------- the table

const COST: Entry = {
  row: "CARD_COST_UNPAID",
  title: "Not enough to pay",
  line: (_ctx, server) => serverOr(server, { lead: "You can’t pay that cost right now." }),
  hint: null,
  before: ["card-tag", "use-disabled"],
  cost: true,
};

/**
 * The table. Board rows marked `*` there are suggested names; each maps to the server's real code here (see `row`).
 * Order follows CmpBlocked, then the remaining combat codes.
 */
export const REFUSALS: Record<RefusalCode, Entry> = {
  // --- CmpBlocked rows
  CARD_COST_UNPAID: COST,
  FEATURE_COST_UNPAID: { ...COST, row: "CARD_COST_UNPAID (feature)", before: ["feature-disabled"] },
  NOT_ENOUGH_HOPE: { ...COST, row: "CARD_COST_UNPAID (Hope feature)", before: ["feature-disabled"] },
  CARD_EXHAUSTED: {
    row: "CARD_EXHAUSTED",
    title: "Used up",
    line: (ctx) => (ctx.subject ? { lead: `${ctx.subject} is used`, rest: "until your next rest." } : { lead: "That card is used up", rest: "until your next rest." }),
    hint: null,
    before: ["used-tag"],
  },
  FEATURE_EXHAUSTED: {
    row: "FEATURE_USED*",
    title: "Feature used",
    line: (ctx) => ({ lead: ctx.subject ? `${ctx.subject} is used up for now.` : "That feature is used up for now." }),
    hint: "It comes back on a rest.",
    before: ["sheet-badge"],
  },
  FEATURE_STATE_MISSING: {
    row: "CONDITION_NOT_MET*",
    title: "Situation not met",
    line: (_ctx, server) => serverOr(server, { lead: "Something this needs isn’t ready yet." }),
    hint: "Set it up, then try again.",
    before: ["card-tag"],
  },
  INVALID: {
    row: "CONDITION_NOT_MET*",
    title: "Situation not met",
    line: (_ctx, server) => serverOr(server, { lead: "That can’t be done right now." }),
    hint: null,
    before: ["card-tag"],
  },
  COMBAT_TARGET_INVALID: {
    row: "TOO_MANY_TARGETS* / BAD_TARGET*",
    title: "Can’t target",
    line: (ctx, server) => {
      if (ctx.max != null) return { lead: `Pick up to ${ctx.max} target${ctx.max === 1 ? "" : "s"}.` };
      if (ctx.target) return { lead: `${capital(ctx.target)} can’t be attacked right now.` };
      return serverOr(server, { lead: "That target can’t be attacked right now." });
    },
    hint: null,
    before: ["picker-counter", "ring-dimmed"],
  },
  COMBAT_NO_LINE_OF_SIGHT: {
    row: "COMBAT_NO_LINE_OF_SIGHT",
    title: "No line of sight",
    line: (ctx) => ({ lead: `You can’t see ${named(ctx.target, "that target")}`, rest: "from where you stand." }),
    hint: "Move or remove what blocks the view.",
    before: ["ring-dotted"],
  },
  COMBAT_OUT_OF_REACH: {
    row: "OUT_OF_REACH*",
    title: "Out of reach",
    line: (ctx) => ({ lead: `Move next to ${named(ctx.target, "it")} first.` }),
    hint: null,
    before: ["ring-hint"],
  },
  CARD_NOT_COMBAT: {
    row: "NOT_IN_COMBAT*",
    title: "Not in combat",
    line: (ctx, server) => (ctx.subject ? { lead: `${ctx.subject} can’t be used in combat.` } : serverOr(server, { lead: "That card can’t be used in combat." })),
    hint: null,
    before: ["card-tag"],
  },
  FEATURE_NOT_COMBAT: {
    row: "NOT_IN_COMBAT*",
    title: "Not in combat",
    line: (ctx, server) => serverOr(server, { lead: `${ctx.subject ?? "That feature"} can’t be used in combat.` }),
    hint: null,
    before: ["feature-disabled"],
  },
  FEATURE_NEEDS_MAP: {
    row: "NO_MAP*",
    title: "No live map",
    line: () => ({ lead: "That needs a live map", rest: "with its targets on it." }),
    hint: "Ask the GM to set a map live.",
    before: ["toast"],
    place: "toast",
  },
  NOT_ENOUGH_FEAR: { ...COST, row: "NOT_ENOUGH_FEAR", title: "GM: not enough Fear", before: ["fear-disabled"] },
  FEAR_EMPTY: { ...COST, row: "NOT_ENOUGH_FEAR (Fear spend)", title: "GM: not enough Fear", before: ["fear-disabled"] },
  ADVERSARY_NOT_SPOTLIT: {
    row: "SPOTLIGHT_FIRST*",
    title: "GM: spotlight first",
    line: (ctx) => ({ lead: `Spotlight ${named(ctx.adversary ?? ctx.target, "that adversary")} first.` }),
    hint: "Spotlighting costs 1 Fear.",
    before: ["attack-disabled"],
  },
  REQUEST_NOT_OPEN: {
    row: "STALE_REQUEST*",
    title: "Already answered",
    line: () => ({ lead: "Someone already answered this." }),
    hint: null,
    before: ["toast"],
    place: "toast",
    then: "refresh",
    tone: "neutral",
  },
  MOVE_BLOCKED: {
    row: "MOVE_BLOCKED*",
    title: "Movement blocked",
    line: () => ({ lead: "Something blocks the way." }),
    hint: null,
    before: ["none"],
    then: "snap-back",
  },
  SPOTLIGHT_WITH_GM: {
    row: "SPOTLIGHT_WITH_GM (H6.1)",
    title: "The GM has the spotlight",
    line: () => ({ lead: "The GM has the spotlight.", rest: "You can use reactions until it comes back." }),
    hint: null,
    before: ["control-disabled"],
  },
  ADVERSARY_DEFEATED: plain("—", "GM: defeated", spotlightMessages.ADVERSARY_DEFEATED, { before: ["control-disabled"] }),

  // --- the other combat codes (no board row; the domain's own words)
  CARD_NOT_IN_LOADOUT: plain("—", "Not in your loadout", combatActionMessages.CARD_NOT_IN_LOADOUT, { hint: "Swap it in from your vault first.", before: ["card-tag"] }),
  COMBAT_NOT_YOUR_CHARACTER: plain("—", "Not your character", combatActionMessages.COMBAT_NOT_YOUR_CHARACTER),
  FEATURE_NOT_OWNED: plain("—", "Not your feature", combatFeatureMessages.FEATURE_NOT_OWNED),
  ADVERSARY_FEATURE_UNAVAILABLE: plain("—", "Can’t use that now", adversaryActionMessages.ADVERSARY_FEATURE_UNAVAILABLE, { before: ["attack-disabled"] }),
  NOT_A_RESPONDER: plain("—", "Can’t answer this hit", adversaryActionMessages.NOT_A_RESPONDER, { place: "toast", then: "refresh", tone: "neutral" }),
  COMBAT_MAP_NOT_FOUND: plain("—", "Map gone", combatMapMessages.COMBAT_MAP_NOT_FOUND, { place: "toast", then: "refresh", tone: "neutral" }),
  COMBAT_MAP_LIMIT: plain("—", "Too many maps", combatMapMessages.COMBAT_MAP_LIMIT),
  COMBAT_MAP_SIZE: plain("—", "Map size", combatMapMessages.COMBAT_MAP_SIZE),
  COMBAT_TOKEN_NOT_FOUND: plain("—", "Token gone", combatMapMessages.COMBAT_TOKEN_NOT_FOUND, { place: "toast", then: "refresh", tone: "neutral" }),
  COMBAT_TOKEN_LIMIT: plain("—", "Too many tokens", combatMapMessages.COMBAT_TOKEN_LIMIT),
  COMBAT_OBJECT_NOT_FOUND: plain("—", "Object gone", combatMapMessages.COMBAT_OBJECT_NOT_FOUND, { place: "toast", then: "refresh", tone: "neutral" }),
  COMBAT_OBJECT_LIMIT: plain("—", "Too many objects", combatMapMessages.COMBAT_OBJECT_LIMIT),
  COMBAT_AREA_LIMIT: plain("—", "Too many areas", combatMapMessages.COMBAT_AREA_LIMIT),
  COMBAT_NOT_YOUR_TOKEN: plain("—", "Not your token", combatMapMessages.COMBAT_NOT_YOUR_TOKEN, { then: "snap-back" }),
  COMBAT_NO_CHARACTER: plain("—", "Not on this map", combatMapMessages.COMBAT_NO_CHARACTER),
  COMBAT_GENERATE_UNAVAILABLE: plain("—", "Try again", combatMapMessages.COMBAT_GENERATE_UNAVAILABLE, { place: "toast" }),
  COMBAT_LAYOUT_INVALID: plain("—", "Layout not valid", combatMapMessages.COMBAT_LAYOUT_INVALID),
  COMBAT_LIGHT_NOT_SEEN: plain("—", "Light not seen", combatMapMessages.COMBAT_LIGHT_NOT_SEEN),
  COMBAT_MAP_CORRUPT: plain("—", "Map can’t be read", combatMapMessages.COMBAT_MAP_CORRUPT, { place: "toast" }),
  NOT_FOUND: plain("—", "Gone", "That no longer exists.", { place: "toast", then: "refresh", tone: "neutral" }),
  RATE_LIMITED: plain("—", "Slow down", "Too many requests. Wait a moment and try again.", { place: "toast", tone: "neutral" }),
  CHARACTER_UNAVAILABLE: plain("—", "Can’t act", "This character can’t act right now (dead, away or unconscious)."),
  ENCOUNTER_NOT_RUNNING: plain("—", "No encounter running", "Start the encounter first.", { before: ["attack-disabled"] }),
};

/**
 * Board rows with no server code: client-only refusals a surface raises itself (never sent by the server, never a
 * key the server may use). NO_ARMOR_SLOT is the hit window's hidden option (CmpBlocked code "—"). Difficult terrain
 * has no entry: moving onto it rolls nothing (user answer 2026-11-02).
 */
export const CLIENT_REFUSALS = {
  NO_ARMOR_SLOT: {
    row: "— (No Armor Slot)",
    title: "No Armor Slot",
    line: () => ({ lead: "No Armor Slot left to mark." }),
    hint: "Repair armor on a rest.",
    before: ["option-hidden"],
  },
} as const satisfies Record<string, Entry>;

export type ClientRefusalCode = keyof typeof CLIENT_REFUSALS;

/** Anything else (CmpBlocked FALLBACK): an unknown code, a lost connection, a bug. */
export const FALLBACK: Entry = {
  row: "FALLBACK",
  title: "Something went wrong",
  line: () => ({ lead: "Something went wrong.", rest: "Check your connection and try again." }),
  hint: null,
  before: ["toast"],
  place: "toast",
};

// ---------------------------------------------------------------- resolve

const DOMAIN_DEFAULTS: ReadonlySet<string> = new Set(
  [combatActionMessages, combatFeatureMessages, combatMapMessages, adversaryActionMessages, spotlightMessages].flatMap((m) => Object.values(m) as string[]),
);

/** The refusal's data, when it is one: `{ code, message?, shortfall? }` (CF13; shortfall per bead dcm-bxp.99.32.2). */
export function refusalData(error: unknown): { code: string; message: string | null; data: object } | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  if (typeof code !== "string") return null;
  return { code, message: typeof message === "string" && message ? message : null, data };
}

/** A cost refusal without numbers: the resources its "Short of: …" text names, or the one its code implies. */
function impliedShortfall(code: string, message: string | null): Shortfall[] {
  const named = shortResourcesFromText(message);
  if (named.length > 0) return named;
  if (code === "NOT_ENOUGH_HOPE") return [{ resource: "hope", need: null, have: null }];
  if (code === "NOT_ENOUGH_FEAR" || code === "FEAR_EMPTY") return [{ resource: "fear", need: null, have: null, payer: "gm" }];
  return [];
}

/** Whether a code has an entry (the server's table or a client-only one). */
export function isMappedRefusal(code: string): code is RefusalCode | ClientRefusalCode {
  return code in REFUSALS || code in CLIENT_REFUSALS;
}

function build(code: string, entry: Entry, ctx: RefusalContext, server: string | null, shortfall: readonly Shortfall[]): Refusal {
  const viewer = ctx.viewer ?? "player";
  const short = shortfall.map((s) => visibleShortfall(s, viewer));
  let line: Line;
  let title = entry.title;
  let hint = entry.hint;
  const first = short[0];
  if (entry.cost && first) {
    const sentence = shortfallSentence(first, { subject: ctx.subject, viewer });
    const more = short.slice(1).map((s) => shortfallSentence(s, { subject: "It", viewer }).lead);
    line = { lead: sentence.lead, rest: [sentence.rest, ...more].filter(Boolean).join(" ") || null };
    title = code === "NOT_ENOUGH_FEAR" || code === "FEAR_EMPTY" ? entry.title : shortfallTitle(first.resource);
    hint = shortfallHint(first.resource);
  } else {
    // A server text that is just the domain's default (or a bare "Short of: …") adds nothing to the board's sentence.
    const specific = server && !DOMAIN_DEFAULTS.has(server) && !/^Short of:/i.test(server) ? server : null;
    line = entry.line(ctx, specific);
  }
  const rest = line.rest ?? null;
  return {
    code,
    title,
    lead: line.lead,
    rest,
    hint,
    text: rest ? `${line.lead} ${rest}` : line.lead,
    before: entry.before,
    place: entry.place ?? "inline",
    then: entry.then ?? null,
    tone: entry.tone ?? "block",
    shortfall: short,
  };
}

/**
 * The refusal to show for `error` (whatever a mutation threw) or a code. Order: the table's entry for the code, else a
 * client-only key, else an app code outside the table (its own message, under the control), else FALLBACK. A cost
 * refusal reads the server's structured shortfall, else `ctx.shortfall` (the client pre-compute), else the resources
 * its "Short of: …" text names.
 */
export function refusalFor(error: unknown, ctx: RefusalContext = {}): Refusal {
  if (typeof error === "string") return refusalForCode(error, ctx);
  const data = refusalData(error);
  if (!data) return build("FALLBACK", FALLBACK, ctx, null, []);
  const structured = readShortfall(data.data);
  const shortfall = structured.length > 0 ? structured : ctx.shortfall?.length ? ctx.shortfall : impliedShortfall(data.code, data.message);
  if (data.code in REFUSALS) return build(data.code, REFUSALS[data.code as RefusalCode], ctx, data.message, shortfall);
  // An app code outside the combat table (UNDO_STALE, DICE_RULE …): its own words; truly unknown → FALLBACK.
  const text = errorMessage(error);
  if (text === "Something went wrong.") return build("FALLBACK", FALLBACK, ctx, null, []);
  return build(data.code, plain("—", "Can’t do that", text), ctx, null, []);
}

/** The refusal for a bare code (a before-the-click reason, a client-only refusal); unknown → FALLBACK. */
export function refusalForCode(code: string, ctx: RefusalContext = {}): Refusal {
  const entry: Entry | undefined = (REFUSALS as Record<string, Entry>)[code] ?? (CLIENT_REFUSALS as Record<string, Entry>)[code];
  if (!entry) return build("FALLBACK", FALLBACK, ctx, null, []);
  return build(code, entry, ctx, null, ctx.shortfall ?? []);
}

/**
 * The before-the-click text beside a disabled control (CmpBlocked layer 1) for a known limit, or null when the code has
 * no short form (its lead then serves). Shortfalls: "Needs 3 Hope · you have 1"; tags take `tag: true` ("Needs 1 Hope").
 */
export function beforeText(code: RefusalCode | ClientRefusalCode, ctx: RefusalContext & { tag?: boolean } = {}): string {
  const viewer = ctx.viewer ?? "player";
  const first = ctx.shortfall?.[0];
  const entry: Entry = (REFUSALS as Record<string, Entry>)[code] ?? (CLIENT_REFUSALS as Record<string, Entry>)[code]!;
  if (entry.cost && first) return ctx.tag ? shortfallTag(first, viewer) : shortfallLabel(first, viewer);
  if (code === "CARD_EXHAUSTED" || code === "FEATURE_EXHAUSTED") return "Used · back after a rest";
  if (code === "SPOTLIGHT_WITH_GM") return "The GM has the spotlight · reactions only";
  return refusalForCode(code, ctx).lead;
}
