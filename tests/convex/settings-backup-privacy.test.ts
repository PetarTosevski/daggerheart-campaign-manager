import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { parseSettingsBackup, settingsBackupText } from "../../src/lib/validation/settings-backup";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// dcm-bxp.101: the D12 backup may carry only notes pages the GM may read, never a player's private, players-only or
// unticked chosen pages. The backup that shipped (H17, option A, user answers Q1/Q2 2026-10-21) is settings-only: it
// carries no notes at all, so it can never carry a page the GM may not read. These tests pin that down, so a later
// campaign export (analysis option B) has to be a new format with its own permissionFor checks.

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";

const PLAYER_SECRET = "PLAYER-PRIVATE-7f3a";
const PLAYERS_ONLY = "PLAYERS-ONLY-2c9e";
const CHOSEN_NO_GM = "CHOSEN-WITHOUT-GM-5b1d";
const GM_SECRET = "GM-OWN-NOTE-9d4c";

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1, name: "Gwen" }),
    p1: await ctx.db.insert("users", { email: P1, emailVerificationTime: 1, name: "Petra" }),
    p2: await ctx.db.insert("users", { email: P2, emailVerificationTime: 1, name: "Quinn" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const p1 = t.withIdentity({ subject: `${ids.p1}|s` });
  const p2 = t.withIdentity({ subject: `${ids.p2}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Backup", idempotencyKey: key() });
  for (const who of [p1, p2]) {
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await who.mutation(api.members.joinByCode, { code });
  }
  return { t, ids, gm, p1, p2, campaignId };
}

describe("settings backup carries no notes (dcm-bxp.101)", () => {
  useAllowlist(`${GM},${P1},${P2}`);

  it("the backup of every member holds only the envelope and the settings, never a journal page or entry", async () => {
    const { t, ids, gm, p1, p2, campaignId } = await setup();
    // A private page, a players-only page and a page chosen for P2 without the GM, each with an entry.
    const pages: [typeof p1, "private" | "players" | "chosen", string][] = [
      [p1, "private", PLAYER_SECRET],
      [p1, "players", PLAYERS_ONLY],
      [p1, "chosen", CHOSEN_NO_GM],
      [gm, "private", GM_SECRET],
    ];
    for (const [who, visibility, text] of pages) {
      const page = await who.mutation(api.notes.createPage, { campaignId, kind: "collection" });
      await who.mutation(api.notesSharing.setVisibility, { campaignId, page, visibility });
      if (visibility === "chosen") await who.mutation(api.notesSharing.addRecipient, { campaignId, page, userId: ids.p2 });
      await who.mutation(api.notesEntries.add, { campaignId, page, kind: "note", text });
      await who.mutation(api.notes.renamePage, { campaignId, page, title: `${text} title` });
    }
    await gm.mutation(api.settings.update, { tableName: "Thursday Crew" });
    expect(await t.run((ctx) => ctx.db.query("journalEntries").collect())).toHaveLength(4);

    for (const who of [gm, p1, p2]) {
      const text = settingsBackupText(await who.query(api.settings.get, {}));
      for (const secret of [PLAYER_SECRET, PLAYERS_ONLY, CHOSEN_NO_GM, GM_SECRET]) expect(text).not.toContain(secret);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(["daggerheartBackup", "kind", "schemaVersion", "settings"]);
      expect(parsed.kind).toBe("settings");
      expect(Object.keys(parsed.settings as object).every((k) => ["tableName", "gmName", "accent", "expansions", "defaultMapStyle"].includes(k))).toBe(true);
      expect(text).not.toMatch(/journal|page|entr(y|ies)|notes/i);
      // What a member can copy, they can restore; the round trip is the same settings.
      expect(parseSettingsBackup(text)).toEqual(parsed.settings);
    }
  });

  it("a pasted backup with notes in it is refused (INVALID) and changes neither settings nor notes", async () => {
    const { t, gm, campaignId } = await setup();
    const page = await gm.mutation(api.notes.createPage, { campaignId, kind: "collection" });
    await gm.mutation(api.notesEntries.add, { campaignId, page, kind: "note", text: GM_SECRET });
    await gm.mutation(api.settings.update, { tableName: "Before" });
    const settings = await gm.query(api.settings.get, {});
    const good = JSON.parse(settingsBackupText(settings)) as Record<string, unknown>;

    const withNotes = [
      { ...good, journal: [{ title: "Smuggled", entries: [{ text: PLAYER_SECRET }] }] },
      { ...good, settings: { ...(good.settings as object), notes: [PLAYER_SECRET] } },
      { ...good, kind: "campaign", pages: [] },
    ];
    for (const backup of withNotes) {
      const failure = await gm.mutation(api.settings.restore, { text: JSON.stringify(backup) }).catch((e: unknown) => e);
      expect(errorCode(failure)).toBe("INVALID");
    }
    expect((await gm.query(api.settings.get, {})).tableName).toBe("Before");
    const entries = await t.run((ctx) => ctx.db.query("journalEntries").collect());
    expect(entries.map((e) => e.text)).toEqual([GM_SECRET]);
  });
});
