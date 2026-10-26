import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// PF10 (.omc/plans/performance.yaml): server reads stay bounded at scale. Each query is measured inside one transaction
// with `ctx.meta.getTransactionMetrics`: `documentsRead` (documents returned by gets and index ranges) and
// `databaseQueries` (gets plus index ranges, the count Convex caps at 4,096 per transaction).
//
// Measured with the campaign below (600 pages per journal; MAX_PAGES caps what a query reads of one journal at 200),
// documents / database queries, before PF10 (rebuild 5e8b0bc) -> after:
//
// - GM `notesSharing.shared` players: 1,492 / 895 -> 1,052 / 216
// - GM `journalView` of a player journal: 1,207 / 1,008 -> 447 / 9
// - player `notesSharing.shared` players: 1,609 / 1,012 -> 1,170 / 214
// - player `journalView` of a departed journal: 1,609 / 1,410 -> 210 / 11
// - player `feed.list` with 0 / 10 / 300 campaign grants: 3 / 23 / 603 documents -> 3 / 6 / 6
//
// Full table: docs/tasks/TASK-PF-PF10.md. Before, the Notes lists ran `permissionFor` and `departed` per page with no
// per-journal memo; a player's `feed.list` read two more documents for every grant to a campaign on the campaign.

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const P3 = "p3@example.com";
const PAGES = 600;
const BUDGET = 1_500;
const VISIBILITIES: Doc<"journalPages">["visibility"][] = ["gm", "players", "everyone", "chosen", "private"];

type T = ReturnType<typeof makeTest>;
type RunCtx = Parameters<Parameters<T["run"]>[0]>[0];
type Reads = { documentsRead: number; databaseQueries: number };

/** Reads of one query call, as `who`, in a transaction of its own. */
async function reads<R>(t: T, who: Id<"users">, run: (ctx: RunCtx) => Promise<R>): Promise<Reads & { result: R }> {
  return t.withIdentity({ subject: `${who}|s` }).run(async (ctx) => {
    const before = await ctx.meta.getTransactionMetrics();
    const result = await run(ctx);
    const after = await ctx.meta.getTransactionMetrics();
    return {
      result,
      documentsRead: after.documentsRead.used - before.documentsRead.used,
      databaseQueries: after.databaseQueries.used - before.databaseQueries.used,
    };
  });
}

async function campaign() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1, name: "Gwen" }),
    p1: await ctx.db.insert("users", { email: P1, emailVerificationTime: 1, name: "Petra" }),
    p2: await ctx.db.insert("users", { email: P2, emailVerificationTime: 1, name: "Quinn" }),
    p3: await ctx.db.insert("users", { email: P3, emailVerificationTime: 1, name: "Rae" }),
  }));
  const as = (who: keyof typeof ids) => t.withIdentity({ subject: `${ids[who]}|s` });
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Scale", idempotencyKey: key() });
  for (const who of ["p1", "p2", "p3"] as const) {
    const code = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
    await as(who).mutation(api.members.joinByCode, { code });
  }
  return { t, ids, as, campaignId };
}

/** A journal of `owner` with PAGES pages cycling through the visibilities; chosen pages tick p3 and the GM. */
async function journal(t: T, campaignId: Id<"campaigns">, owner: Id<"users">, ticked: Id<"users">[], characterId?: Id<"characters">) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const journalId = await ctx.db.insert("journals", {
      campaignId,
      userId: owner,
      ...(characterId === undefined ? {} : { characterId }),
      pageCount: PAGES,
      entryCount: 0,
      openCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < PAGES; i++) {
      const visibility = VISIBILITIES[i % VISIBILITIES.length];
      const pageId = await ctx.db.insert("journalPages", {
        campaignId,
        journalId,
        ownerId: owner,
        kind: "collection",
        title: `Page ${i}`,
        tape: 0,
        visibility,
        entryCount: 0,
        openCount: 0,
        createdAt: now + i,
        updatedAt: now + i,
      });
      if (visibility === "chosen") {
        for (const userId of ticked) if (userId !== owner) await ctx.db.insert("journalPageRecipients", { campaignId, pageId, userId, addedAt: now });
      }
    }
    return journalId;
  });
}

async function character(t: T, campaignId: Id<"campaigns">, owner: Id<"users">, status: Doc<"characters">["status"], name: string) {
  const now = Date.now();
  return t.run((ctx) => ctx.db.insert("characters", { campaignId, ownerId: owner, createdBy: owner, status, sheet: { name }, createdAt: now, updatedAt: now }));
}

describe("PF10: Notes lists stay under the read budget with 600 pages per journal", () => {
  useAllowlist(`${GM},${P1},${P2},${P3}`);

  it(`every Notes list query stays under ${BUDGET} documents and ${BUDGET} database queries`, { timeout: 180_000 }, async () => {
    const { t, ids, campaignId } = await campaign();
    const ash = await character(t, campaignId, ids.p1, "active", "Ash");
    const bram = await character(t, campaignId, ids.p2, "dead", "Bram"); // p2's journal is departed (D1)
    await character(t, campaignId, ids.p3, "active", "Cole");
    const gmJournal = await journal(t, campaignId, ids.gm, [ids.p1, ids.p3]);
    const p1Journal = await journal(t, campaignId, ids.p1, [ids.gm, ids.p3], ash);
    const p2Journal = await journal(t, campaignId, ids.p2, [ids.gm, ids.p3], bram);

    const measured: Record<string, Reads> = {};
    const measure = async (name: string, who: Id<"users">, run: (ctx: RunCtx) => Promise<unknown>) => {
      const { documentsRead, databaseQueries } = await reads(t, who, run);
      measured[name] = { documentsRead, databaseQueries };
    };
    for (const [who, label] of [
      [ids.gm, "gm"],
      [ids.p3, "p3"],
    ] as const) {
      await measure(`${label} shared players`, who, (c) => c.runQuery(api.notesSharing.shared, { campaignId, tab: "players" }));
      await measure(`${label} shared gm`, who, (c) => c.runQuery(api.notesSharing.shared, { campaignId, tab: "gm" }));
      await measure(`${label} playerJournals`, who, (c) => c.runQuery(api.notesJournals.playerJournals, { campaignId }));
      await measure(`${label} pastJournals`, who, (c) => c.runQuery(api.notesJournals.pastJournals, { campaignId }));
      await measure(`${label} bin`, who, (c) => c.runQuery(api.notesBin.bin, { campaignId }));
      for (const [journalId, name] of [
        [gmJournal, "gm"],
        [p1Journal, "p1"],
        [p2Journal, "p2"],
      ] as const) {
        if (label === "p3" && name !== "p2") {
          // dcm-bxp.109: a player opens only their own and departed journals; the GM's and p1's present ones are refused.
          const refused = await t
            .withIdentity({ subject: `${who}|s` })
            .query(api.notesJournals.journalView, { campaignId, journalId })
            .then(() => "ok", errorCode);
          expect(refused, `${label} journalView ${name}`).toBe("NOT_FOUND");
          continue;
        }
        await measure(`${label} journalView ${name}`, who, (c) => c.runQuery(api.notesJournals.journalView, { campaignId, journalId }));
      }
    }
    console.info("PF10 Notes reads", measured);
    for (const [name, used] of Object.entries(measured)) {
      expect.soft(used.documentsRead, `${name} documents`).toBeLessThan(BUDGET);
      expect.soft(used.databaseQueries, `${name} database queries`).toBeLessThan(BUDGET);
    }
  });
});

describe("PF10: a player's permission check does not grow with the campaign's grants", () => {
  useAllowlist(`${GM},${P1},${P2},${P3}`);

  it("feed.list reads the same for 10 and 300 grants to other campaigns", { timeout: 120_000 }, async () => {
    const { t, ids, campaignId } = await campaign();
    let granted = 0;
    /** Grants on the campaign to `n` more campaigns run by p2 (p1 acts for none of them). */
    const grantTo = (n: number) =>
      t.run(async (ctx) => {
        for (let i = 0; i < n; i++) {
          const other = await ctx.db.insert("campaigns", {
            ownerId: ids.p2,
            frameId: "witherwild",
            name: `Other ${granted}`,
            nameKey: `other ${granted}`,
            tier: 1,
            level: 1,
            createdAt: 0,
            lastOpenedAt: 0,
          });
          granted += 1;
          await ctx.db.insert("grants", {
            resourceType: "campaign",
            resourceId: campaignId,
            principalKind: "campaign",
            principalId: other,
            permission: "edit",
            createdBy: ids.gm,
            createdAt: 0,
          });
        }
      });
    const feed = () => reads(t, ids.p1, (c) => c.runQuery(api.feed.list, { campaignId, paginationOpts: { numItems: 20, cursor: null } }));
    const none = await feed();
    await grantTo(10);
    const few = await feed();
    await grantTo(290);
    const many = await feed();
    console.info("PF10 feed.list reads (0 / 10 / 300 grants)", [none, few, many].map(({ documentsRead, databaseQueries }) => ({ documentsRead, databaseQueries })));
    expect(many.documentsRead).toBe(few.documentsRead);
    expect(many.databaseQueries).toBe(few.databaseQueries);
    // Any grant costs a fixed probe plus the player's own campaigns (one membership and its campaign here).
    expect(few.documentsRead - none.documentsRead).toBeLessThanOrEqual(3);
    expect(few.databaseQueries - none.databaseQueries).toBeLessThanOrEqual(4);
  });

  it("a grant to a campaign the player belongs to still raises their permission", async () => {
    const { t, ids, as, campaignId } = await campaign();
    // p1 also plays in a second campaign; the first campaign grants that campaign 'owner'.
    const { campaignId: second } = await as("p2").mutation(api.campaigns.create, { frameId: "witherwild", name: "Second", idempotencyKey: key() });
    const code = await as("p2").mutation(api.members.rotateJoinCode, { campaignId: second });
    await as("p1").mutation(api.members.joinByCode, { code });
    const viewer = async () => (await reads(t, ids.p1, (c) => c.runQuery(api.members.roster, { campaignId }))).result.viewer;
    expect(await viewer()).toBe("player");
    await t.run((ctx) =>
      ctx.db.insert("grants", {
        resourceType: "campaign",
        resourceId: campaignId,
        principalKind: "campaign",
        principalId: second,
        permission: "owner",
        createdBy: ids.gm,
        createdAt: 0,
      }),
    );
    expect(await viewer()).toBe("gm");
    // A deleted campaign is no principal.
    await t.run((ctx) => ctx.db.patch("campaigns", second, { deletedAt: 1 }));
    expect(await viewer()).toBe("player");
  });
});

describe("PF10: per-row reads of the roster and the combat map list", () => {
  useAllowlist(`${GM},${P1},${P2},${P3}`);

  it("members.roster and combatMaps.list read one row per member or map", async () => {
    const { t, ids, as, campaignId } = await campaign();
    for (let i = 0; i < 3; i++) await as("gm").mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    const roster = await reads(t, ids.p1, (c) => c.runQuery(api.members.roster, { campaignId }));
    const maps = await reads(t, ids.gm, (c) => c.runQuery(api.combatMaps.list, { campaignId }));
    console.info("PF10 roster / combatMaps.list reads", {
      roster: { documentsRead: roster.documentsRead, databaseQueries: roster.databaseQueries },
      maps: { documentsRead: maps.documentsRead, databaseQueries: maps.databaseQueries },
    });
    expect(roster.result.players).toHaveLength(3);
    expect(maps.result).toHaveLength(3);
    // Before PF10: 10 documents (campaign, caller's membership twice, GM's user row, 3 member rows, 3 user rows).
    expect(roster.documentsRead).toBeLessThanOrEqual(10);
    // Before PF10: 5 documents, 3 index ranges (campaign, the maps range, one file lookup per map with no image).
    expect(maps.documentsRead).toBeLessThanOrEqual(5);
    expect(maps.databaseQueries).toBeLessThanOrEqual(3);
  });
});
