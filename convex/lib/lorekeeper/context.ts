import { MENTION_TOKEN_RE } from "../../../src/lib/domain/notes/mentions";
import { getPublishedFrame } from "../../../src/lib/frames/index";
import {
  getAncestry,
  getClass,
  getCommunity,
  getDomainCard,
  getSubclass,
  getTransformation,
} from "../../../src/lib/srd/index";
import type { CharacterSheet } from "../../../src/lib/validation/characters";
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { partyOf, readSheet } from "../characterSheet";
import { pageAccess } from "../notes";
import { atLeast, permissionFor } from "../permissions";
import { BOOK_KEY_HOUSE_RULES, LOREKEEPER_LIMITS } from "../validators/lorekeeper";

/**
 * The campaign context a question may use (Q4, analysis 5.4): the frame, the asker's own characters, the party's
 * classes, the table rulings and (when the GM switched the house-rules book on, Q7) GM pages shared with everyone.
 * Never GM-only data, for anyone, the GM included.
 *
 * This module reads only: the campaign's characters (`partyOf`), the table rulings, the house-rules book switch
 * (`lorekeeperBooks` / `lorekeeperLibrary`) and the GM's journal pages with visibility `everyone`, each checked with
 * `pageAccess` as the asker. It never reads codex entries, encounters, custom adversaries, countdowns, session prep,
 * Fear or any other journal; tests/convex/lorekeeper-context.test.ts reads this file's imports and table reads to
 * keep it that way, and seeds canary strings in all of them.
 */

export type ContextFrame = { id: string; name: string };

/** One of the asker's characters (permissionFor >= edit). */
export type ContextCharacter = {
  name: string;
  className: string;
  subclass: string;
  level: number;
  /** Ancestry and community names. */
  heritage: string[];
  domainCards: string[];
  features: string[];
};

/** A party member's class line, visible to every member on the Party page. */
export type ContextPartyMember = { className: string; subclass: string };

/** A pinned table ruling; `id` is the lorekeeperRulings id (passed through to ruling quotes). */
export type ContextRuling = { id?: string; title: string; text: string };

/** A GM journal page with visibility 'everyone' (Q7), read as the asker. */
export type ContextHouseRule = { title: string; text: string };

export type LorekeeperContext = {
  frame: ContextFrame;
  characters: ContextCharacter[];
  party: ContextPartyMember[];
  rulings: ContextRuling[];
  houseRules: ContextHouseRule[];
};

/** The context of `user`'s question in `campaign`, with only what `user` may see. */
export type BuildContext = (ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">) => Promise<LorekeeperContext>;

/** Caps on what the context carries (the prompt's size, analysis 8). */
export const CONTEXT_LIMITS = {
  /** House-rule pages per question. */
  houseRulePages: 10,
  /** Characters of one house-rule page's text. */
  houseRulePageChars: 4000,
  /** Characters of all house-rule pages together. */
  houseRuleChars: 12000,
  /** Names in one character's feature or domain-card list. */
  namesPerList: 40,
} as const;

/** Characters whose sheets count (dead and retired ones are out of play). */
const IN_PLAY: ReadonlySet<Doc<"characters">["status"]> = new Set(["active", "away"]);

/** The campaign's frame id and name. */
export function contextFrame(campaign: Doc<"campaigns">): ContextFrame {
  return { id: campaign.frameId, name: getPublishedFrame(campaign.frameId)?.name ?? "Custom frame" };
}

/** A sheet, or null when it does not read (CHARACTER_CORRUPT); anything else is a bug and throws. */
function sheetOf(character: Doc<"characters">): CharacterSheet | null {
  try {
    return readSheet(character.sheet);
  } catch (error) {
    if ((error as { data?: { code?: unknown } }).data?.code === "CHARACTER_CORRUPT") return null;
    throw error;
  }
}

function classLine(sheet: CharacterSheet): ContextPartyMember {
  return {
    className: getClass(sheet.classId)?.name ?? sheet.classId,
    subclass: getSubclass(sheet.subclassId)?.name ?? sheet.subclassId,
  };
}

function unique(names: (string | undefined)[]): string[] {
  return [...new Set(names.filter((n): n is string => typeof n === "string" && n.length > 0))].slice(0, CONTEXT_LIMITS.namesPerList);
}

/** Ancestry (and transformation) and community names. */
function heritageOf(sheet: CharacterSheet): string[] {
  const a = sheet.ancestry;
  const ancestry =
    a.kind === "single"
      ? [getAncestry(a.id)?.name]
      : a.kind === "mixed"
        ? [a.name || undefined, getAncestry(a.first)?.name, getAncestry(a.second)?.name]
        : [getAncestry(a.form)?.name];
  const transformation = sheet.transformationId === undefined ? undefined : getTransformation(sheet.transformationId)?.name;
  return unique([...ancestry, transformation, getCommunity(sheet.communityId)?.name]);
}

/** The names of the features the character has now: class, subclass up to its rank, heritage, multiclass. */
function featuresOf(sheet: CharacterSheet): string[] {
  const cls = getClass(sheet.classId);
  const sub = getSubclass(sheet.subclassId);
  const rank = sheet.subclassRank;
  const subFeatures = sub
    ? [...sub.foundation, ...(rank !== "foundation" ? sub.specialization : []), ...(rank === "mastery" ? sub.mastery : [])]
    : [];
  const a = sheet.ancestry;
  const ancestryFeatures =
    a.kind === "single" ? (getAncestry(a.id)?.features ?? []) : a.kind === "shapeshifter" ? [{ name: a.feature }] : [];
  const mixed = a.kind === "mixed" ? [getAncestry(a.first)?.features[0]?.name, getAncestry(a.second)?.features[1]?.name] : [];
  const transformation = sheet.transformationId === undefined ? [] : (getTransformation(sheet.transformationId)?.features ?? []);
  const multi = sheet.multiclass;
  const multiFeatures = multi
    ? [
        `Multiclass: ${getClass(multi.classId)?.name ?? multi.classId}`,
        ...(getClass(multi.classId)?.classFeatures ?? []).map((f) => f.name),
        ...(getSubclass(multi.subclassId)?.foundation ?? []).map((f) => f.name),
      ]
    : [];
  return unique([
    cls?.hopeFeature.name,
    ...(cls?.classFeatures ?? []).map((f) => f.name),
    ...subFeatures.map((f) => f.name),
    ...ancestryFeatures.map((f) => f.name),
    ...mixed,
    getCommunity(sheet.communityId)?.feature.name,
    ...transformation.map((f) => f.name),
    ...multiFeatures,
  ]);
}

function characterOf(sheet: CharacterSheet): ContextCharacter {
  const line = classLine(sheet);
  return {
    name: sheet.name,
    className: line.className,
    subclass: line.subclass,
    level: sheet.level,
    heritage: heritageOf(sheet),
    domainCards: unique([...sheet.domainCards.loadout, ...sheet.domainCards.owned].map((id) => getDomainCard(id)?.name)),
    features: featuresOf(sheet),
  };
}

/**
 * The asker's characters and the party's class lines, from one bounded read of the campaign's characters. A
 * character is the asker's when they own it and `permissionFor` gives them edit on it, so the GM (who edits every
 * sheet) gets only the characters they own, never a player's sheet (Q4).
 */
async function charactersAndParty(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">) {
  const characters: ContextCharacter[] = [];
  const party: ContextPartyMember[] = [];
  for (const character of await partyOf(ctx, campaign._id)) {
    if (!IN_PLAY.has(character.status)) continue;
    const sheet = sheetOf(character);
    if (sheet === null) continue;
    party.push(classLine(sheet));
    if (character.ownerId !== user._id) continue;
    if (!atLeast(await permissionFor(ctx, user, { type: "character", campaign, character }, "edit"), "edit")) continue;
    characters.push(characterOf(sheet));
  }
  return { characters, party };
}

/** The newest table rulings (all members read them). */
async function rulingsOf(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<ContextRuling[]> {
  const rows = await ctx.db
    .query("lorekeeperRulings")
    .withIndex("by_campaign_pinned", (q) => q.eq("campaignId", campaign._id))
    .order("desc")
    .take(LOREKEEPER_LIMITS.rulingsPerCampaign);
  return rows.map((r) => ({ id: r._id, title: r.title, text: r.text }));
}

/** Whether the GM switched the house-rules book on for the campaign (no switch row = off, Q7). */
async function houseRulesEnabled(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<boolean> {
  const book = await ctx.db
    .query("lorekeeperBooks")
    .withIndex("by_key", (q) => q.eq("key", BOOK_KEY_HOUSE_RULES))
    .unique();
  if (book === null) return false;
  const row = await ctx.db
    .query("lorekeeperLibrary")
    .withIndex("by_campaign_book", (q) => q.eq("campaignId", campaign._id).eq("bookId", book._id))
    .unique();
  return row?.enabled === true;
}

/**
 * Entry text for the prompt. Mention tokens become a neutral word: a token carries a Codex entry's name, and a GM may
 * mention a hidden entry, which the prompt must never name (Q4).
 */
function plainText(text: string): string {
  return text.replace(MENTION_TOKEN_RE, "(a codex entry)");
}

/**
 * The GM's journal pages with visibility 'everyone' that `pageAccess` lets the asker read (Q7), with their entries'
 * text, capped. Only the GM's journal is read (journals.by_campaign_user with the GM's id); every other journal, and
 * every page of another visibility, is never touched.
 */
async function houseRulesOf(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">): Promise<ContextHouseRule[]> {
  if (!(await houseRulesEnabled(ctx, campaign))) return [];
  const journals = await ctx.db
    .query("journals")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", campaign.ownerId))
    .take(5);
  const notesCtx = Object.assign({}, ctx, { user, campaign });
  const out: ContextHouseRule[] = [];
  let total = 0;
  for (const journal of journals) {
    if (journal.characterId !== undefined) continue;
    const pages = await ctx.db
      .query("journalPages")
      .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id).eq("binnedAt", undefined))
      .take(200);
    for (const listed of pages) {
      if (out.length >= CONTEXT_LIMITS.houseRulePages || total >= CONTEXT_LIMITS.houseRuleChars) return out;
      if (listed.visibility !== "everyone" || listed.ownerId !== campaign.ownerId) continue;
      let page: Doc<"journalPages">;
      try {
        ({ page } = await pageAccess(notesCtx, listed._id));
      } catch (error) {
        if ((error as { data?: { code?: unknown } }).data?.code === "NOTE_PAGE_NOT_FOUND") continue;
        throw error;
      }
      // pageAccess also admits the page's owner and a binner; only a present 'everyone' page is a house rule.
      if (page.visibility !== "everyone" || page.binnedAt !== undefined) continue;
      const entries = await ctx.db
        .query("journalEntries")
        .withIndex("by_page_order", (q) => q.eq("pageId", page._id))
        .take(300);
      const room = Math.min(CONTEXT_LIMITS.houseRulePageChars, CONTEXT_LIMITS.houseRuleChars - total);
      const text = entries
        .map((e) => `- ${plainText(e.text)}`)
        .join("\n")
        .slice(0, room);
      if (text.length === 0) continue;
      total += text.length;
      out.push({ title: plainText(page.title), text });
    }
  }
  return out;
}

/** The context of `user`'s question in `campaign`, with only what `user` may see (Q4, Q7). */
export const buildContext: BuildContext = async (ctx, user, campaign) => {
  const { characters, party } = await charactersAndParty(ctx, user, campaign);
  return {
    frame: contextFrame(campaign),
    characters,
    party,
    rulings: await rulingsOf(ctx, campaign),
    houseRules: await houseRulesOf(ctx, user, campaign),
  };
};
