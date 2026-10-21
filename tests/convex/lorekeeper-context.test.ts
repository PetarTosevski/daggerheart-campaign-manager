import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { api } from "../../convex/_generated/api";
import { buildContext, type LorekeeperContext } from "../../convex/lib/lorekeeper/context";
import { BOOK_KEY_HOUSE_RULES } from "../../convex/lib/validators/lorekeeper";
import { fromSrd, validateCustom } from "../../src/lib/adversaries/custom";
import { formatToken } from "../../src/lib/domain/notes/mentions";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { getClass, getSubclass } from "../../src/lib/srd/index";
import { key } from "./helpers";
import { allowWorldEmails, buildWorld, type Role, type World } from "./authz/world";

/**
 * D13 L4: buildContext gives the model only what the asker may see (Q4, Q7). The canary test seeds a unique marker in
 * every kind of data a prompt must never carry (hidden codex entries, GM notes, private and chosen journal pages,
 * players' pages, custom adversaries, encounter notes, countdowns, session prep, another player's sheet, a hidden
 * entry mentioned on a shared page) and asserts that no marker reaches the context of any asker, the GM included.
 */

allowWorldEmails();

const BEAR = ADVERSARIES.find((a) => a.id === "bear")!;

type Asker = Exclude<Role, "anon" | "outsider">;
const ASKERS: Asker[] = ["player", "otherPlayer", "gm", "grantee"];

/** Markers no asker's context may contain, except the ones listed for an asker (their own sheet's name). */
const MARKERS = {
  codexHiddenName: "CANARY_CODEX_HIDDEN_NAME",
  codexHiddenDesc: "CANARY_CODEX_HIDDEN_DESC",
  codexGmNotes: "CANARY_CODEX_GM_NOTES",
  mentionName: "CANARY_MENTION_NAME",
  gmPrivateTitle: "CANARY_GM_PRIVATE_TITLE",
  gmPrivateEntry: "CANARY_GM_PRIVATE_ENTRY",
  gmChosenEntry: "CANARY_GM_CHOSEN_ENTRY",
  playerPrivateEntry: "CANARY_PLAYER_PRIVATE_ENTRY",
  playerToGmEntry: "CANARY_PLAYER_TO_GM_ENTRY",
  playerEveryoneEntry: "CANARY_PLAYER_EVERYONE_ENTRY",
  gmBinnedEntry: "CANARY_GM_BINNED_ENTRY",
  adversary: "CANARY_CUSTOM_ADVERSARY",
  encounterName: "CANARY_ENCOUNTER_NAME",
  encounterNotes: "CANARY_ENCOUNTER_NOTES",
  countdownName: "CANARY_COUNTDOWN_NAME",
  countdownSecret: "CANARY_COUNTDOWN_SECRET",
  prepHooks: "CANARY_SESSION_PREP",
  sheetBName: "CANARY_SHEET_B_NAME",
  sheetBNotes: "CANARY_SHEET_B_NOTES",
  sheetANotes: "CANARY_SHEET_A_NOTES",
  sheetADescription: "CANARY_SHEET_A_DESCRIPTION",
} as const;

const ALLOWED: Partial<Record<Asker, string[]>> = { otherPlayer: [MARKERS.sheetBName] };

const HOUSE_RULE_ENTRY = "Critical hits on a d12 deal max damage plus one die.";
const RULING = { title: "Flanking", text: "Allies on both sides give advantage." };

async function enableHouseRules(w: World, enabled = true) {
  await w.t.run(async (ctx) => {
    const bookId = await ctx.db.insert("lorekeeperBooks", {
      key: BOOK_KEY_HOUSE_RULES,
      title: "House rules",
      subtitle: "Your Notes tab",
      cover: "notes",
      pages: 0,
      chunkCount: 0,
      ingestedAt: 1,
      schemaVersion: 1,
    });
    await ctx.db.insert("lorekeeperLibrary", { campaignId: w.campaignId, bookId, enabled, updatedAt: 1 });
  });
}

/** A new page of `who`'s journal with one entry, a title and a visibility. */
async function page(w: World, who: Asker, title: string, entry: string, visibility?: "private" | "gm" | "players" | "everyone" | "chosen") {
  const c = w.as(who);
  const campaignId = w.campaignId;
  const pageId = await c.mutation(api.notes.createPage, { campaignId, kind: "collection" });
  await c.mutation(api.notes.renamePage, { campaignId, page: pageId, title });
  await c.mutation(api.notesEntries.add, { campaignId, page: pageId, kind: "note", text: entry });
  if (visibility !== undefined) await c.mutation(api.notesSharing.setVisibility, { campaignId, page: pageId, visibility });
  return pageId;
}

/** Seeds every canary, one shared house-rule page and one ruling. */
async function seed(w: World) {
  const gm = w.as("gm");
  const campaignId = w.campaignId;

  // Codex: a hidden entry, and a known entry's GM notes.
  const { entryId: hidden } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
  await gm.mutation(api.codex.update, { entryId: hidden, patch: { name: MARKERS.codexHiddenName, pdesc: MARKERS.codexHiddenDesc, known: false } });
  const { entryId: known } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
  await gm.mutation(api.codex.update, { entryId: known, patch: { name: "Old Mag", known: true, gmn: MARKERS.codexGmNotes } });

  // Notes: the GM's private page, a page chosen for player A, a torn-out shared page; players' pages of every kind.
  await page(w, "gm", MARKERS.gmPrivateTitle, MARKERS.gmPrivateEntry);
  const chosen = await page(w, "gm", "For Ash", MARKERS.gmChosenEntry, "chosen");
  await gm.mutation(api.notesSharing.addRecipient, { campaignId, page: chosen, userId: w.users.player });
  const binned = await page(w, "gm", "Old rules", MARKERS.gmBinnedEntry, "everyone");
  await gm.mutation(api.notesBin.binPage, { campaignId, page: binned });
  await page(w, "player", "Mine", MARKERS.playerPrivateEntry, "private");
  await page(w, "player", "To the GM", MARKERS.playerToGmEntry, "gm");
  await page(w, "player", "For all", MARKERS.playerEveryoneEntry, "everyone");

  // The one house-rule page: the GM's, shared with everyone, mentioning the hidden entry.
  const shared = await page(w, "gm", "Table house rules", HOUSE_RULE_ENTRY, "everyone");
  await gm.mutation(api.notesEntries.add, { campaignId, page: shared, kind: "note", text: `Ask ${formatToken(MARKERS.mentionName, hidden)} first.` });

  // Adversaries, encounters, countdowns, session prep, Fear.
  await gm.mutation(api.customAdversaries.create, {
    campaignId,
    adversary: { ...validateCustom(fromSrd(BEAR)), name: MARKERS.adversary },
    idempotencyKey: key(),
  });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: MARKERS.encounterName, idempotencyKey: key() });
  await gm.mutation(api.encounters.setNotes, { campaignId, encounterId, notes: MARKERS.encounterNotes });
  await gm.mutation(api.countdowns.create, {
    campaignId,
    name: MARKERS.countdownName,
    description: MARKERS.countdownSecret,
    category: "threat",
    startingValue: 4,
    consequence: MARKERS.countdownSecret,
    visibility: { mode: "private" },
    idempotencyKey: key(),
  });
  const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
  await gm.mutation(api.sessionPrep.setHooks, { campaignId, sessionId, hooks: MARKERS.prepHooks });
  await gm.mutation(api.fear.set, { campaignId, value: 7, idempotencyKey: key() });

  // Sheets: player B's name and notes, player A's notes and description (never context fields).
  await w.t.run(async (ctx) => {
    const b = (await ctx.db.get("characters", w.characterB))!;
    await ctx.db.patch("characters", b._id, { sheet: { ...b.sheet, name: MARKERS.sheetBName, notes: MARKERS.sheetBNotes } });
    const a = (await ctx.db.get("characters", w.characterA))!;
    await ctx.db.patch("characters", a._id, { sheet: { ...a.sheet, notes: MARKERS.sheetANotes, description: MARKERS.sheetADescription } });
  });

  await gm.mutation(api.lorekeeperRulings.pin, { campaignId, ...RULING });
}

function contextOf(w: World, who: Asker): Promise<LorekeeperContext> {
  return w.t.run(async (ctx) => {
    const user = (await ctx.db.get("users", w.users[who]))!;
    const campaign = (await ctx.db.get("campaigns", w.campaignId))!;
    return buildContext(ctx, user, campaign);
  });
}

describe("buildContext canaries (Q4: no GM-only data in any prompt)", () => {
  test("no marker reaches the context of player A, player B, the GM or an edit grantee, with house rules on", async () => {
    const w = await buildWorld();
    await enableHouseRules(w);
    await seed(w);
    for (const who of ASKERS) {
      const json = JSON.stringify(await contextOf(w, who));
      const leaked = Object.values(MARKERS).filter((m) => json.includes(m) && !(ALLOWED[who] ?? []).includes(m));
      expect({ who, leaked }).toEqual({ who, leaked: [] });
    }
  });

  test("what each asker does get: frame, own sheet, party classes, rulings, the GM's shared page", async () => {
    const w = await buildWorld();
    await enableHouseRules(w);
    await seed(w);
    const warrior = getClass("warrior")!;
    const sub = getSubclass(warrior.subclasses[0]!)!;

    const player = await contextOf(w, "player");
    expect(Object.keys(player).sort()).toEqual(["characters", "frame", "houseRules", "party", "rulings"]);
    expect(player.frame).toEqual({ id: "witherwild", name: expect.any(String) });
    expect(player.characters).toHaveLength(1);
    expect(player.characters[0]).toMatchObject({ name: "Ash", className: warrior.name, subclass: sub.name, level: 1 });
    expect(player.characters[0]!.features).toContain(warrior.hopeFeature.name);
    expect(player.characters[0]!.domainCards.length).toBeGreaterThan(0);
    expect(player.characters[0]!.heritage.length).toBe(2);
    expect(player.party).toEqual([
      { className: warrior.name, subclass: sub.name },
      { className: warrior.name, subclass: sub.name },
    ]);
    expect(player.rulings).toEqual([{ id: expect.any(String), ...RULING }]);
    expect(player.houseRules).toHaveLength(1);
    expect(player.houseRules[0]!.title).toBe("Table house rules");
    expect(player.houseRules[0]!.text).toContain(HOUSE_RULE_ENTRY);
    expect(player.houseRules[0]!.text).toContain("Ask (a codex entry) first.");

    const other = await contextOf(w, "otherPlayer");
    expect(other.characters.map((c) => c.name)).toEqual([MARKERS.sheetBName]);
    expect(other.houseRules).toHaveLength(1);

    // The GM edits every sheet but owns none of them: no player sheet in the GM's context.
    const gm = await contextOf(w, "gm");
    expect(gm.characters).toEqual([]);
    expect(JSON.stringify(gm)).not.toContain("Ash");
    expect(gm.party).toHaveLength(2);
    expect(gm.houseRules).toHaveLength(1);

    // A member with an edit grant on the whole campaign edits every sheet too, and still gets no one else's.
    const grantee = await contextOf(w, "grantee");
    expect(grantee.characters).toEqual([]);
    expect(grantee.houseRules).toHaveLength(1);
  });

  test("house rules stay out until the GM switches the book on (Q7), and with the switch off", async () => {
    const w = await buildWorld();
    await seed(w);
    for (const who of ASKERS) expect((await contextOf(w, who)).houseRules).toEqual([]);
    await enableHouseRules(w, false);
    for (const who of ASKERS) expect((await contextOf(w, who)).houseRules).toEqual([]);
  });

  test("the GM's own character is theirs; dead characters leave the party", async () => {
    const w = await buildWorld();
    await w.t.run(async (ctx) => {
      const a = (await ctx.db.get("characters", w.characterA))!;
      await ctx.db.insert("characters", { ...withoutSystemFields(a), ownerId: w.users.gm, sheet: { ...a.sheet, name: "Gm Hero" } });
      await ctx.db.patch("characters", w.characterB, { status: "dead" });
    });
    const gm = await contextOf(w, "gm");
    expect(gm.characters.map((c) => c.name)).toEqual(["Gm Hero"]);
    expect(gm.party).toHaveLength(2);
    expect((await contextOf(w, "otherPlayer")).characters).toEqual([]);
  });

  test("rulings: the newest 50, newest first", async () => {
    const w = await buildWorld();
    await w.t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) {
        await ctx.db.insert("lorekeeperRulings", {
          campaignId: w.campaignId,
          title: `R${i}`,
          text: "t",
          pinnedBy: w.users.gm,
          pinnedAt: i,
          updatedAt: i,
        });
      }
    });
    const rulings = (await contextOf(w, "player")).rulings;
    expect(rulings).toHaveLength(50);
    expect(rulings[0]!.title).toBe("R49");
  });
});

function withoutSystemFields<T extends { _id: unknown; _creationTime: unknown }>(doc: T): Omit<T, "_id" | "_creationTime"> {
  const { _id, _creationTime, ...rest } = doc;
  void _id;
  void _creationTime;
  return rest;
}

describe("context.ts reads nothing GM-only (structural)", () => {
  const source = readFileSync(resolve(__dirname, "../../convex/lib/lorekeeper/context.ts"), "utf8");

  test("imports only the characters, notes-page, permission, frame, SRD and lorekeeper modules", () => {
    const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports.sort()).toEqual(
      [
        "../../../src/lib/domain/notes/mentions",
        "../../../src/lib/frames/index",
        "../../../src/lib/srd/index",
        "../../../src/lib/validation/characters",
        "../../_generated/dataModel",
        "../../_generated/server",
        "../characterSheet",
        "../notes",
        "../permissions",
        "../validators/lorekeeper",
      ].sort(),
    );
    for (const banned of [/codex/i, /encounter/i, /adversar/i, /countdown/i, /session/i, /fear/i, /journalState/, /notesJournals/]) {
      expect(imports.filter((i) => banned.test(i))).toEqual([]);
    }
  });

  test("reads only the rulings, the house-rules switch and the GM's journal pages and entries", () => {
    const tables = [...source.matchAll(/\.(?:query|get)\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]!);
    expect([...new Set(tables)].sort()).toEqual(
      ["journalEntries", "journalPages", "journals", "lorekeeperBooks", "lorekeeperLibrary", "lorekeeperRulings"].sort(),
    );
  });
});

