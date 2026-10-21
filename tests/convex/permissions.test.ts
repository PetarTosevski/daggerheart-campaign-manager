import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { permissionFor, upsertGrant, type Permission } from "../../convex/lib/permissions";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const OUTSIDER = "outsider@example.com";
const OTHER_GM = "othergm@example.com";
const OTHER_PLAYER = "otherplayer@example.com";

describe("grants", () => {
  useAllowlist(`${GM},${OUTSIDER},${OTHER_GM},${OTHER_PLAYER}`);

  async function setup() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
      otherGm: await ctx.db.insert("users", { email: OTHER_GM, emailVerificationTime: 1 }),
      otherPlayer: await ctx.db.insert("users", { email: OTHER_PLAYER, emailVerificationTime: 1 }),
    }));
    const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
    const gm = as(ids.gm);
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Shared", idempotencyKey: key() });
    const visible = await gm.mutation(api.maps.addToken, { campaignId, type: "village", x: 10, y: 10, idempotencyKey: key() });
    const hidden = await gm.mutation(api.maps.addToken, { campaignId, type: "cave", x: 20, y: 20, idempotencyKey: key() });
    await gm.mutation(api.maps.updateToken, { campaignId, id: visible.id, patch: { notes: "GM secret" } });
    await gm.mutation(api.maps.updateToken, { campaignId, id: hidden.id, patch: { name: "Wyrm lair", hidden: true } });
    // Another campaign with its own GM and player.
    const otherGm = as(ids.otherGm);
    const { campaignId: other } = await otherGm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    await otherGm.mutation(api.members.invite, { campaignId: other, email: OTHER_PLAYER });
    await as(ids.otherPlayer).mutation(api.campaigns.markOpened, { campaignId: other });
    return { t, ids, gm, outsider: as(ids.outsider), otherPlayer: as(ids.otherPlayer), campaignId, other, visible };
  }

  type Grant = Pick<Doc<"grants">, "resourceType" | "resourceId" | "principalKind" | "principalId" | "permission" | "createdBy">;

  it("without grants an outsider has no access", async () => {
    const { outsider, campaignId } = await setup();
    expect(errorData(await outsider.query(api.maps.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await outsider.query(api.codex.list, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorCode(await outsider.query(api.characters.listByCampaign, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("a view grant to another campaign's user gives the player-filtered map, read-only", async () => {
    const { t, ids, outsider, campaignId, visible } = await setup();
    await t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "map", resourceId: campaignId, principalKind: "user", principalId: ids.outsider, permission: "view", createdBy: ids.gm }),
    );
    const view = await outsider.query(api.maps.get, { campaignId });
    expect(view.role).toBe("player");
    expect(view.state.tokens).toEqual([{ id: visible.id, type: "village", x: 10, y: 10, name: "Village", notes: "", hidden: false, location: false }]);
    expect(JSON.stringify(view)).not.toMatch(/Wyrm lair|GM secret/);
    expect(errorData(await outsider.mutation(api.maps.addToken, { campaignId, type: "camp", x: 1, y: 1, idempotencyKey: key() }).catch((e) => e))).toBe("FORBIDDEN");
    // The grant is on the map only: the codex stays hidden.
    expect(errorData(await outsider.query(api.codex.list, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("a view grant to a campaign reaches its members", async () => {
    const { t, ids, otherPlayer, campaignId, other } = await setup();
    await t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "map", resourceId: campaignId, principalKind: "campaign", principalId: other, permission: "view", createdBy: ids.gm }),
    );
    const view = await otherPlayer.query(api.maps.get, { campaignId });
    expect(view.role).toBe("player");
    expect(JSON.stringify(view)).not.toMatch(/Wyrm lair|GM secret/);
  });

  it("an edit grant allows map edits and gives the GM view", async () => {
    const { t, ids, outsider, campaignId } = await setup();
    const grant: Grant = { resourceType: "map", resourceId: campaignId, principalKind: "user", principalId: ids.outsider, permission: "view", createdBy: ids.gm };
    await t.run((ctx) => upsertGrant(ctx, grant));
    await t.run((ctx) => upsertGrant(ctx, { ...grant, permission: "edit" }));
    // One row per (resource, principal): the second grant replaced the first.
    expect(await t.run(async (ctx) => (await ctx.db.query("grants").collect()).map((g) => g.permission))).toEqual(["edit"]);

    const view = await outsider.query(api.maps.get, { campaignId });
    expect(view.role).toBe("gm");
    expect(JSON.stringify(view)).toMatch(/Wyrm lair/);
    const { id } = await outsider.mutation(api.maps.addToken, { campaignId, type: "camp", x: 1, y: 1, idempotencyKey: key() });
    expect((await outsider.query(api.maps.get, { campaignId })).state.tokens.some((tok) => tok.id === id)).toBe(true);
  });
});

describe("permissionFor read cost", () => {
  useAllowlist(`${GM},${OUTSIDER},${OTHER_PLAYER}`);

  /** Runs permissionFor on the campaign's map with a ctx.db that counts get/query calls. */
  async function readsFor(t: ReturnType<typeof makeTest>, userId: Id<"users">, campaignId: Id<"campaigns">, need: Permission) {
    return t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      const user = (await ctx.db.get("users", userId))!;
      let reads = 0;
      const db = new Proxy(ctx.db, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (prop === "get" || prop === "query") reads++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const permission = await permissionFor({ ...ctx, db }, user, { type: "map", campaign }, need);
      return { permission, reads };
    });
  }

  it("short-circuits on the role and never reads the caller's other campaigns", async () => {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
      player: await ctx.db.insert("users", { email: OTHER_PLAYER, emailVerificationTime: 1 }),
    }));
    const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
    const { campaignId } = await as(ids.gm).mutation(api.campaigns.create, { frameId: "witherwild", name: "Cost", idempotencyKey: key() });
    await as(ids.gm).mutation(api.members.invite, { campaignId, email: OTHER_PLAYER });
    await as(ids.player).mutation(api.campaigns.markOpened, { campaignId });

    expect(await readsFor(t, ids.gm, campaignId, "owner")).toEqual({ permission: "owner", reads: 0 });
    expect(await readsFor(t, ids.player, campaignId, "view")).toEqual({ permission: "view", reads: 1 });

    // No access: role (membership, invite) plus, per target, one user grant and one campaign-grant range.
    const before = await readsFor(t, ids.outsider, campaignId, "owner");
    expect(before).toEqual({ permission: null, reads: 6 });
    for (let i = 0; i < 5; i++) {
      await as(ids.outsider).mutation(api.campaigns.create, { frameId: "witherwild", name: `Mine ${i}`, idempotencyKey: key() });
    }
    expect(await readsFor(t, ids.outsider, campaignId, "owner")).toEqual(before);
  });
});

// ---------------------------------------------------------------- D11 journal pages (N0)

const OWNER = "owner@example.com";
const CHOSEN = "chosen@example.com";
const UNCHOSEN = "unchosen@example.com";

describe("journal pages (D11): visibility x reader x departure", () => {
  useAllowlist(`${GM},${OWNER},${CHOSEN},${UNCHOSEN},${OUTSIDER}`);

  const PLAYER_VISIBILITIES = ["gm", "private", "players", "everyone", "chosen"] as const;
  const GM_VISIBILITIES = ["private", "everyone", "chosen"] as const;
  type Reader = "owner" | "gm" | "chosen" | "unchosen" | "outsider";
  const READERS: Reader[] = ["owner", "gm", "chosen", "unchosen", "outsider"];
  type State = "present" | "removed" | "dead" | "retired" | "away" | "rejoined";
  const STATES: State[] = ["present", "removed", "dead", "retired", "away", "rejoined"];

  /**
   * A campaign with a GM, three players who joined by code (the owner, a chosen player, a player not chosen) and an
   * outsider. The owner's character journal has one page per player visibility; the 'chosen' page names the chosen
   * player. The GM's journal has one page per GM visibility; its 'chosen' page names the chosen player too.
   */
  async function setup() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      owner: await ctx.db.insert("users", { email: OWNER, emailVerificationTime: 1 }),
      chosen: await ctx.db.insert("users", { email: CHOSEN, emailVerificationTime: 1 }),
      unchosen: await ctx.db.insert("users", { email: UNCHOSEN, emailVerificationTime: 1 }),
      outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
    }));
    const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
    const gm = as(ids.gm);
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Journals", idempotencyKey: key() });
    const join = async (id: Id<"users">) => {
      const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
      expect(await as(id).mutation(api.members.joinByCode, { code })).toEqual({ ok: true, campaignId });
    };
    for (const id of [ids.owner, ids.chosen, ids.unchosen]) await join(id);
    const made = await t.run(async (ctx) => {
      const now = Date.now();
      const characterId = await ctx.db.insert("characters", { campaignId, ownerId: ids.owner, createdBy: ids.owner, status: "active", sheet: {}, createdAt: now, updatedAt: now });
      const counts = { pageCount: 0, entryCount: 0, openCount: 0, createdAt: now, updatedAt: now };
      const playerJournal = await ctx.db.insert("journals", { campaignId, userId: ids.owner, characterId, ...counts });
      const gmJournal = await ctx.db.insert("journals", { campaignId, userId: ids.gm, ...counts });
      const page = (journalId: Id<"journals">, ownerId: Id<"users">, visibility: Doc<"journalPages">["visibility"]) =>
        ctx.db.insert("journalPages", { campaignId, journalId, ownerId, kind: "collection", title: visibility, tape: 0, visibility, entryCount: 0, openCount: 0, createdAt: now, updatedAt: now });
      const playerPages = {} as Record<(typeof PLAYER_VISIBILITIES)[number], Id<"journalPages">>;
      for (const vis of PLAYER_VISIBILITIES) playerPages[vis] = await page(playerJournal, ids.owner, vis);
      const gmPages = {} as Record<(typeof GM_VISIBILITIES)[number], Id<"journalPages">>;
      for (const vis of GM_VISIBILITIES) gmPages[vis] = await page(gmJournal, ids.gm, vis);
      for (const pageId of [playerPages.chosen, gmPages.chosen]) {
        await ctx.db.insert("journalPageRecipients", { campaignId, pageId, userId: ids.chosen, addedAt: now });
      }
      return { characterId, playerJournal, gmJournal, playerPages, gmPages };
    });

    /** Puts the owner (and their character) into a departure state. */
    async function enter(state: State) {
      if (state === "removed" || state === "rejoined") await gm.mutation(api.members.removePlayer, { campaignId, userId: ids.owner });
      if (state === "rejoined") await join(ids.owner);
      if (state === "dead" || state === "retired" || state === "away") {
        await t.run((ctx) => ctx.db.patch("characters", made.characterId, { status: state }));
      }
    }

    /** permissionFor of one reader on a page. */
    async function read(pageId: Id<"journalPages">, reader: Reader) {
      return t.run(async (ctx) => {
        const campaign = (await ctx.db.get("campaigns", campaignId))!;
        const page = (await ctx.db.get("journalPages", pageId))!;
        const journal = (await ctx.db.get("journals", page.journalId))!;
        const user = (await ctx.db.get("users", ids[reader]))!;
        return permissionFor(ctx, user, { type: "journalPage", campaign, journal, page });
      });
    }
    return { t, ids, gm, as, campaignId, ...made, enter, read, join };
  }

  /** The analysis 3.1 table for a player's page (A3, A4, A5, Q2, Q4, D4, Q12). */
  function expectedPlayerPage(visibility: (typeof PLAYER_VISIBILITIES)[number], reader: Reader, state: State): Permission | null {
    if (reader === "outsider") return null;
    if (reader === "owner") return state === "removed" ? null : "owner";
    if (visibility === "private") return null;
    if (state === "removed" || state === "dead" || state === "retired") return "view";
    if (visibility === "everyone") return "view";
    if (visibility === "gm") return reader === "gm" ? "view" : null;
    if (visibility === "players") return reader === "gm" ? null : "view";
    return reader === "chosen" ? "view" : null;
  }

  /** A GM's page: the GM owns it and it never departs (the owner's state does not touch it). */
  function expectedGmPage(visibility: (typeof GM_VISIBILITIES)[number], reader: Reader, state: State): Permission | null {
    if (reader === "outsider") return null;
    if (reader === "gm") return "owner";
    // The removed owner is an outsider now.
    if (reader === "owner" && state === "removed") return null;
    if (visibility === "private") return null;
    if (visibility === "everyone") return "view";
    return reader === "chosen" ? "view" : null;
  }

  for (const state of STATES) {
    it(`every visibility x reader, owner ${state}`, async () => {
      const s = await setup();
      await s.enter(state);
      const got: Record<string, Permission | null> = {};
      const want: Record<string, Permission | null> = {};
      for (const vis of PLAYER_VISIBILITIES) {
        for (const reader of READERS) {
          got[`player:${vis}:${reader}`] = await s.read(s.playerPages[vis], reader);
          want[`player:${vis}:${reader}`] = expectedPlayerPage(vis, reader, state);
        }
      }
      for (const vis of GM_VISIBILITIES) {
        for (const reader of READERS) {
          got[`gm:${vis}:${reader}`] = await s.read(s.gmPages[vis], reader);
          want[`gm:${vis}:${reader}`] = expectedGmPage(vis, reader, state);
        }
      }
      expect(got).toEqual(want);
    });
  }

  it("a GM 'chosen' page reaches the chosen player only", async () => {
    const s = await setup();
    expect(await Promise.all(READERS.map((r) => s.read(s.gmPages.chosen, r)))).toEqual([null, "owner", "view", null, null]);
  });

  it("a player's 'chosen' page is hidden from the GM until the GM is a recipient (D4)", async () => {
    const s = await setup();
    expect(await s.read(s.playerPages.chosen, "gm")).toBeNull();
    await s.t.run((ctx) => ctx.db.insert("journalPageRecipients", { campaignId: s.campaignId, pageId: s.playerPages.chosen, userId: s.ids.gm, addedAt: Date.now() }));
    expect(await s.read(s.playerPages.chosen, "gm")).toBe("view");
    expect(await s.read(s.playerPages.chosen, "unchosen")).toBeNull();
  });

  it("a departed player's 'players' page reaches the GM, its 'private' page stays the owner's; a rejoin hides it again", async () => {
    const s = await setup();
    expect(await s.read(s.playerPages.players, "gm")).toBeNull();
    await s.gm.mutation(api.members.removePlayer, { campaignId: s.campaignId, userId: s.ids.owner });
    expect(await s.read(s.playerPages.players, "gm")).toBe("view");
    expect(await s.read(s.playerPages.private, "gm")).toBeNull();
    expect(await s.read(s.playerPages.private, "chosen")).toBeNull();
    await s.join(s.ids.owner);
    expect(await s.read(s.playerPages.players, "gm")).toBeNull();
    expect(await s.read(s.playerPages.players, "unchosen")).toBe("view");
    expect(await s.read(s.playerPages.private, "owner")).toBe("owner");
  });

  it("a status set back to 'active' restores the previous visibility", async () => {
    const s = await setup();
    await s.enter("dead");
    expect(await s.read(s.playerPages.players, "gm")).toBe("view");
    await s.t.run((ctx) => ctx.db.patch("characters", s.characterId, { status: "active" }));
    expect(await s.read(s.playerPages.players, "gm")).toBeNull();
  });

  it("the character moving to another account or vanishing is a departure, and so is leaving", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch("characters", s.characterId, { ownerId: s.ids.chosen }));
    expect(await s.read(s.playerPages.players, "gm")).toBe("view");
    await s.t.run((ctx) => ctx.db.patch("characters", s.characterId, { ownerId: s.ids.owner }));
    expect(await s.read(s.playerPages.players, "gm")).toBeNull();
    await s.t.run((ctx) => ctx.db.delete("characters", s.characterId));
    expect(await s.read(s.playerPages.gm, "unchosen")).toBe("view");

    const fresh = await setup();
    await fresh.as(fresh.ids.owner).mutation(api.members.leave, { campaignId: fresh.campaignId });
    expect(await fresh.read(fresh.playerPages.gm, "unchosen")).toBe("view");
    expect(await fresh.read(fresh.playerPages.gm, "owner")).toBeNull();
  });

  it("a torn-out page is readable only by its owner and by the GM who tore it out", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch("journalPages", s.playerPages.everyone, { binnedAt: Date.now(), binnedBy: s.ids.owner }));
    expect(await Promise.all(READERS.map((r) => s.read(s.playerPages.everyone, r)))).toEqual(["owner", null, null, null, null]);
    // A departed journal's page the GM tore out (D2): the GM reads it in the bin, other members do not.
    await s.enter("retired");
    await s.t.run((ctx) => ctx.db.patch("journalPages", s.playerPages.gm, { binnedAt: Date.now(), binnedBy: s.ids.gm }));
    expect(await Promise.all(READERS.map((r) => s.read(s.playerPages.gm, r)))).toEqual(["owner", "view", null, null, null]);
    // The binner keeps it only while they would read it unbinned: a 'players' page the GM tore out of the retired
    // journal is out of the GM's reach once the character is active again (N1 canRestore).
    await s.t.run((ctx) => ctx.db.patch("journalPages", s.playerPages.players, { binnedAt: Date.now(), binnedBy: s.ids.gm }));
    expect(await s.read(s.playerPages.players, "gm")).toBe("view");
    await s.t.run((ctx) => ctx.db.patch("characters", s.characterId, { status: "active" }));
    expect(await s.read(s.playerPages.players, "gm")).toBeNull();
    expect(await s.read(s.playerPages.gm, "gm")).toBe("view");
  });

  it("an unattached player journal departs only with its owner's role; the GM's journal never departs", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch("journals", s.playerJournal, { characterId: undefined }));
    await s.enter("dead");
    expect(await s.read(s.playerPages.players, "gm")).toBeNull();
    await s.enter("removed");
    expect(await s.read(s.playerPages.players, "gm")).toBe("view");
    // Even with the GM journal pointing at a dead character, the GM's private page stays private.
    await s.t.run((ctx) => ctx.db.patch("journals", s.gmJournal, { characterId: s.characterId }));
    expect(await s.read(s.gmPages.private, "chosen")).toBeNull();
    expect(await s.read(s.gmPages.chosen, "unchosen")).toBeNull();
  });

  it("a page whose campaign or journal does not match is nobody's", async () => {
    const s = await setup();
    const { campaignId: other } = await s.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Elsewhere", idempotencyKey: key() });
    const result = await s.t.run(async (ctx) => {
      const elsewhere = (await ctx.db.get("campaigns", other))!;
      const home = (await ctx.db.get("campaigns", s.campaignId))!;
      const page = (await ctx.db.get("journalPages", s.gmPages.everyone))!;
      const journal = (await ctx.db.get("journals", page.journalId))!;
      const mismatched = (await ctx.db.get("journals", s.playerJournal))!;
      const user = (await ctx.db.get("users", s.ids.gm))!;
      return [
        await permissionFor(ctx, user, { type: "journalPage", campaign: elsewhere, journal, page }),
        await permissionFor(ctx, user, { type: "journalPage", campaign: home, journal: mismatched, page }),
      ];
    });
    expect(result).toEqual([null, null]);
  });

  it("a grant on the campaign gives no journal page", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "campaign", resourceId: s.campaignId, principalKind: "user", principalId: s.ids.outsider, permission: "owner", createdBy: s.ids.gm }),
    );
    expect(await s.read(s.gmPages.everyone, "outsider")).toBeNull();
    expect(await s.read(s.playerPages.everyone, "outsider")).toBeNull();
  });
});
