/**
 * The world every authz-matrix row runs in (analysis 2.4): one campaign with a GM, two players who each own a character,
 * a player with an edit grant on the campaign, and an outsider. Built through the public API wherever one exists
 * (campaign, join code, joins, characters); users and the grant have no public API and are inserted directly.
 *
 * Area files add their own state (a combat map, an encounter, a session...) in `setup`, register the ids they create
 * with `w.set(name, id)` and, when a table holds several rows, pick the one argument synthesis uses with
 * `w.use(table, id)`.
 */
import type { TestConvex } from "convex-test";
import { afterEach, beforeEach } from "vitest";

import { api } from "../../../convex/_generated/api";
import type { Id, TableNames } from "../../../convex/_generated/dataModel";
import type schema from "../../../convex/schema";
import type { FrameId } from "../../../src/lib/frames/index";
import { characterDraft } from "../../fixtures/characters";
import { key } from "../helpers";
import { makeTest } from "../setup";

/** Who calls: signed out, a stranger, playerA (owns characterA), playerB (owns characterB), the edit-grant player, the GM. */
export type Role = "anon" | "outsider" | "player" | "otherPlayer" | "grantee" | "gm";

/** The order rows run in (a shared query world sees the refused calls first). */
export const ROLES: readonly Role[] = ["anon", "outsider", "otherPlayer", "player", "grantee", "gm"];

export const WORLD_EMAILS = {
  gm: "gm@example.com",
  player: "player-a@example.com",
  otherPlayer: "player-b@example.com",
  grantee: "grantee@example.com",
  outsider: "outsider@example.com",
} as const;

/** Allowlists the world's accounts for each test of the calling file (the allowlist is re-read on every call). */
export function allowWorldEmails() {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.ALLOWED_EMAILS;
    process.env.ALLOWED_EMAILS = Object.values(WORLD_EMAILS).join(",");
  });
  afterEach(() => {
    process.env.ALLOWED_EMAILS = previous;
  });
}

type Test = TestConvex<typeof schema>;
/** A caller: the test instance with (or, for `anon`, without) an identity. */
export type Client = Pick<Test, "query" | "mutation" | "action">;

export type WorldOptions = {
  /** The campaign's frame (default `witherwild`, which has campaign time and wither). */
  frameId?: FrameId;
  /** Extra `characters.create` arguments per player, for frames whose creation needs more (a Motherboard Ikonis). */
  characterArgs?: (who: "player" | "otherPlayer") => Record<string, unknown>;
  /** Class of both characters (default `warrior`). */
  classId?: string;
};

export type World = {
  t: Test;
  frameId: FrameId;
  campaignId: Id<"campaigns">;
  joinCode: string;
  users: Record<Exclude<Role, "anon">, Id<"users">>;
  /** playerA's character. */
  characterA: Id<"characters">;
  /** playerB's character. */
  characterB: Id<"characters">;
  /** The caller for a role. */
  as(role: Role): Client;
  /** Named ids an area's setup registered (`w.set("pyreId", id)`); NAME_HINTS resolvers read them. */
  ids: Record<string, string>;
  set(name: string, id: string): void;
  /** Makes `id` the row of `table` that argument synthesis uses. */
  use(table: TableNames, id: string): void;
  /**
   * The id argument synthesis uses for a table: the one chosen with `use`, else the table's first document. Throws,
   * naming the table, when the world has none (the area's setup must create one).
   */
  idOf(table: TableNames): Promise<string>;
};

/** Builds a fresh world on its own convex-test instance. The calling file must `allowWorldEmails()`. */
export async function buildWorld(options: WorldOptions = {}): Promise<World> {
  const frameId = options.frameId ?? "witherwild";
  const t = makeTest();
  const users = await t.run(async (ctx) => {
    const insert = (email: string) => ctx.db.insert("users", { email, emailVerificationTime: 1 });
    return {
      gm: await insert(WORLD_EMAILS.gm),
      player: await insert(WORLD_EMAILS.player),
      otherPlayer: await insert(WORLD_EMAILS.otherPlayer),
      grantee: await insert(WORLD_EMAILS.grantee),
      outsider: await insert(WORLD_EMAILS.outsider),
    };
  });
  const clients = new Map<Role, Client>([["anon", t]]);
  for (const [role, id] of Object.entries(users)) clients.set(role as Role, t.withIdentity({ subject: `${id}|session` }));
  const as = (role: Role) => clients.get(role)!;

  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId, name: "Matrix", idempotencyKey: key() });
  const joinCode = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
  for (const role of ["player", "otherPlayer", "grantee"] as const) await as(role).mutation(api.members.joinByCode, { code: joinCode });

  const create = async (who: "player" | "otherPlayer", name: string) =>
    (
      await as(who).mutation(api.characters.create, {
        campaignId,
        draft: characterDraft(name, options.classId),
        idempotencyKey: key(),
        ...options.characterArgs?.(who),
      })
    ).characterId;
  const characterA = await create("player", "Ash");
  const characterB = await create("otherPlayer", "Bryn");

  // Grants have no public API yet (`upsertGrant` is the only writer): the grantee gets edit on the whole campaign.
  await t.run((ctx) =>
    ctx.db.insert("grants", {
      resourceType: "campaign",
      resourceId: campaignId,
      principalKind: "user",
      principalId: users.grantee,
      permission: "edit",
      createdBy: users.gm,
      createdAt: Date.now(),
    }),
  );

  const chosen = new Map<string, string>([
    ["campaigns", campaignId],
    ["characters", characterA],
    ["users", users.player],
  ]);
  const ids: Record<string, string> = {};
  return {
    t,
    frameId,
    campaignId,
    joinCode,
    users,
    characterA,
    characterB,
    as,
    ids,
    set: (name, id) => {
      ids[name] = id;
    },
    use: (table, id) => {
      chosen.set(table, id);
    },
    idOf: async (table) => {
      const picked = chosen.get(table);
      if (picked !== undefined) return picked;
      const first = await t.run(async (ctx) => (await ctx.db.query(table).first())?._id ?? null);
      if (first === null) throw new Error(`The world has no "${table}" document: create one in the area's or the entry's setup.`);
      return first;
    },
  };
}
