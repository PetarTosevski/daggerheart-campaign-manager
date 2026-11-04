import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BACKUPS_NOTE, dashboardBackupsUrl, READ_ONLY_MESSAGE_MAX } from "../../convex/adminMaintenance";
import {
  campaignMutation,
  creatorMutation,
  gmMutation,
  keyedCampaignMutation,
  keyedCreatorMutation,
  keyedGmMutation,
  keyedUserMutation,
  userAction,
  userMutation,
} from "../../convex/lib/functions";
import schema from "../../convex/schema";
import { characterDraft } from "../fixtures/characters";
import { publicFunctions, wrapperOf, type Wrapper } from "./authz/inventory";
import { buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";
import { modules } from "./setup";

/**
 * Config AD10 (docs/tasks/TASK-CONFIG-AD10.md, Q31 a): with read-only mode on, every public mutation and action
 * refuses with READ_ONLY_MODE, except the app owner's and the three bookkeeping writes that pass `readOnly: "allow"`
 * (campaigns.markOpened, presence.heartbeat / disconnect). The guard lives in the wrappers, so this file proves it per
 * wrapper (a probe built with every mutation / action builder, plus a real function per builder in use) and walks the
 * inventory so a function on a new, unprobed builder, or a new `readOnly: "allow"`, fails here.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: "?raw"; import: "default" }): Record<string, () => Promise<string>>;
  }
}

const fail = (p: Promise<unknown>) => p.then(() => "resolved", errorCode);

// ---------------------------------------------------------------- probes: one function per builder

const ran = async () => "ran";
const probe = {
  userMutation: userMutation({ args: {}, handler: ran }),
  keyedUserMutation: keyedUserMutation({ args: {}, handler: ran }),
  userAction: userAction({ args: {}, handler: ran }),
  campaignMutation: campaignMutation({ need: "view", args: {}, handler: ran }),
  keyedCampaignMutation: keyedCampaignMutation({ need: "view", args: {}, handler: ran }),
  gmMutation: gmMutation({ args: {}, handler: ran }),
  keyedGmMutation: keyedGmMutation({ args: {}, handler: ran }),
  creatorMutation: creatorMutation({ args: {}, handler: ran }),
  keyedCreatorMutation: keyedCreatorMutation({ args: {}, handler: ran }),
  allowedUserMutation: userMutation({ readOnly: "allow", args: {}, handler: ran }),
  allowedCampaignMutation: campaignMutation({ need: "view", readOnly: "allow", args: {}, handler: ran }),
};
type ProbeName = keyof typeof probe;

/** The builders whose functions write, each with its probe; the owner-only builders let only the (exempt) owner in. */
const PROBED: Partial<Record<Wrapper, ProbeName>> = {
  userMutation: "userMutation",
  keyedUserMutation: "keyedUserMutation",
  userAction: "userAction",
  campaignMutation: "campaignMutation",
  keyedCampaignMutation: "keyedCampaignMutation",
  gmMutation: "gmMutation",
  keyedGmMutation: "keyedGmMutation",
  creatorMutation: "creatorMutation",
  keyedCreatorMutation: "keyedCreatorMutation",
};
const OWNER_ONLY: Wrapper[] = ["appOwnerMutation", "appOwnerAction"];

/** The only public functions that pass `readOnly: "allow"` (Q31 a). */
const ALLOWED = ["campaigns:markOpened", "presence:disconnect", "presence:heartbeat"];

type ComponentTestHelper = { default: { register: (t: unknown, name?: string) => void } };
const COMPONENT_HELPERS = ["@convex-dev/rate-limiter/test", "@convex-dev/migrations/test", "@convex-dev/presence/test"];

async function probeWorld() {
  const t = convexTest(schema, { ...modules, "../../convex/probe.ts": async () => probe });
  for (const name of COMPONENT_HELPERS) ((await import(/* @vite-ignore */ name)) as ComponentTestHelper).default.register(t);
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }),
    owner: await ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  const gm = as(ids.gm);
  const owner = as(ids.owner);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Probe", idempotencyKey: key() });
  return { t, gm, owner, campaignId };
}

type Caller = Awaited<ReturnType<typeof probeWorld>>["gm"];

/** Calls the probe `name` with the arguments its builder consumes. */
function callProbe(caller: Caller, name: ProbeName, campaignId: Id<"campaigns">): Promise<unknown> {
  const args: Record<string, unknown> = {};
  if (name !== "userMutation" && name !== "keyedUserMutation" && name !== "userAction" && name !== "allowedUserMutation") {
    args.campaignId = campaignId;
  }
  if (name.startsWith("keyed")) args.idempotencyKey = key();
  if (name === "userAction") return caller.action(makeFunctionReference<"action">("probe:userAction"), args);
  return caller.mutation(makeFunctionReference<"mutation">(`probe:${name}`), args);
}

// ---------------------------------------------------------------- source scan

const sources = import.meta.glob("../../convex/**/*.ts", { query: "?raw", import: "default" });

/** Whether `<module>:<export>`'s definition passes `readOnly: "allow"` among its options (before `handler`). */
async function passesAllow(name: string): Promise<boolean> {
  const [module, exportName] = name.split(":");
  const load = Object.entries(sources).find(([path]) => path.replace(/^.*\/convex\//, "").replace(/\.ts$/, "") === module)?.[1];
  if (load === undefined) return false;
  const source = await load();
  const start = source.search(new RegExp(`export const ${exportName} = \\w+\\(`));
  if (start === -1) return false;
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport /);
  const body = next === -1 ? rest : rest.slice(0, next);
  const options = body.slice(0, Math.max(0, body.indexOf("handler")) || body.length);
  return /\breadOnly:\s*"allow"/.test(options);
}

// ---------------------------------------------------------------- tests

describe("read-only mode covers every write (config AD10)", () => {
  it("every public mutation and action is built on a probed builder, and only the Q31 three pass readOnly: allow", async () => {
    const writes = (await publicFunctions()).filter((f) => f.kind !== "query");
    const unprobed: string[] = [];
    const allowed: string[] = [];
    for (const f of writes) {
      const info = await wrapperOf(f.name);
      // Convex Auth's own actions (sign-in writes sessions, allowed in Q31 a; sign-ups are AD4's).
      if (info === null && f.name.startsWith("auth:")) continue;
      if (info === null || (PROBED[info.wrapper] === undefined && !OWNER_ONLY.includes(info.wrapper))) {
        unprobed.push(`${f.name} (${info?.wrapper ?? "no known builder"})`);
      }
      if (await passesAllow(f.name)) allowed.push(f.name);
    }
    expect(unprobed, "writes on a builder this file does not probe: add it to PROBED").toEqual([]);
    expect(allowed.sort()).toEqual(ALLOWED);
  }, 120_000);

  it("every mutation builder and userAction refuses with READ_ONLY_MODE while it is on, and runs again once it is off", async () => {
    const { gm, owner, campaignId } = await probeWorld();
    for (const name of Object.values(PROBED)) expect(await callProbe(gm, name, campaignId), name).toBe("ran");
    await owner.mutation(api.adminMaintenance.setReadOnly, { on: true, message: "Back soon" });
    for (const name of Object.values(PROBED)) expect(await fail(callProbe(gm, name, campaignId)), name).toBe("READ_ONLY_MODE");
    await owner.mutation(api.adminMaintenance.setReadOnly, { on: false });
    for (const name of Object.values(PROBED)) expect(await callProbe(gm, name, campaignId), name).toBe("ran");
  });

  it("readOnly: allow runs anyway; the app owner is exempt; access is checked first", async () => {
    const { t, gm, owner, campaignId } = await probeWorld();
    await owner.mutation(api.adminMaintenance.setReadOnly, { on: true });
    expect(await callProbe(gm, "allowedUserMutation", campaignId)).toBe("ran");
    expect(await callProbe(gm, "allowedCampaignMutation", campaignId)).toBe("ran");
    // The owner's own writes (user builders) run; on a campaign they are not in, they are still an outsider.
    for (const name of ["userMutation", "keyedUserMutation", "userAction"] as const) expect(await callProbe(owner, name, campaignId)).toBe("ran");
    expect(await fail(callProbe(owner, "gmMutation", campaignId))).toBe("NOT_FOUND");
    // Signed out is still UNAUTHENTICATED, never READ_ONLY_MODE.
    expect(await fail(t.mutation(makeFunctionReference<"mutation">("probe:userMutation"), {}))).toBe("UNAUTHENTICATED");
    expect(await fail(t.action(makeFunctionReference<"action">("probe:userAction"), {}))).toBe("UNAUTHENTICATED");
  });
});

describe("read-only mode on real functions (config AD10)", () => {
  async function readOnlyWorld(message?: string): Promise<World> {
    const w = await buildWorld();
    await w.as("appOwner").mutation(api.adminMaintenance.setReadOnly, { on: true, message });
    return w;
  }

  it("refuses a sample write per builder in use and changes nothing", async () => {
    const w = await readOnlyWorld();
    const campaignId = w.campaignId;
    const fearBefore = await w.as("gm").query(api.campaigns.fear, { campaignId });
    const cases: [string, Promise<unknown>][] = [
      ["keyedGmMutation", w.as("gm").mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() })],
      ["keyedGmMutation (co-GM)", w.as("coGm").mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() })],
      ["gmMutation", w.as("gm").mutation(api.campaigns.setPlayersSeeHands, { campaignId, enabled: false })],
      ["campaignMutation", w.as("grantee").mutation(api.campaigns.setTimeOfDay, { campaignId, timeOfDay: "night" })],
      ["creatorMutation", w.as("gm").mutation(api.members.setCoGm, { campaignId, userId: w.users.player, coGm: true })],
      [
        "keyedCampaignMutation",
        w.as("player").mutation(api.characters.create, { campaignId, draft: characterDraft("Cael"), idempotencyKey: key() }),
      ],
      ["keyedUserMutation", w.as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "New", idempotencyKey: key() })],
      ["userMutation", w.as("outsider").mutation(api.members.joinByCode, { code: w.joinCode })],
      ["userAction", w.as("gm").action(api.photoImport.read, { campaignId })],
    ];
    for (const [wrapper, call] of cases) expect(await fail(call), wrapper).toBe("READ_ONLY_MODE");
    expect(await w.as("gm").query(api.campaigns.fear, { campaignId })).toEqual(fearBefore);
  });

  it("checks sign-in and access first: signed out UNAUTHENTICATED, a stranger NOT_FOUND, a player FORBIDDEN", async () => {
    const w = await readOnlyWorld();
    const args = { campaignId: w.campaignId, direction: "increase" as const };
    expect(await fail(w.as("anon").mutation(api.fear.adjust, { ...args, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
    expect(await fail(w.as("outsider").mutation(api.fear.adjust, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect(await fail(w.as("player").mutation(api.fear.adjust, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
  });

  it("exempts opening a campaign and presence (Q31 a), and queries keep reading", async () => {
    const w = await readOnlyWorld();
    const campaignId = w.campaignId;
    await w.as("player").mutation(api.campaigns.markOpened, { campaignId });
    const beat = await w.as("player").mutation(api.presence.heartbeat, { roomId: campaignId, userId: "me", sessionId: "tab-1", interval: 20_000 });
    expect(await w.as("gm").query(api.presence.list, { campaignId })).toContainEqual({ userId: w.users.player, online: true });
    await w.as("player").mutation(api.presence.disconnect, { sessionToken: beat.sessionToken });
    expect(await w.as("gm").query(api.presence.list, { campaignId })).toContainEqual({ userId: w.users.player, online: false });
    expect((await w.as("player").query(api.campaigns.list, {})).map((c) => c._id)).toContain(campaignId);
  });

  it("exempts the app owner (Q31 a): their writes run and they turn the mode off", async () => {
    const w = await readOnlyWorld();
    const owner = w.as("appOwner");
    const { campaignId } = await owner.mutation(api.campaigns.create, { frameId: "witherwild", name: "Owner's", idempotencyKey: key() });
    await owner.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() });
    await owner.mutation(api.adminMaintenance.setReadOnly, { on: false });
    await w.as("gm").mutation(api.fear.adjust, { campaignId: w.campaignId, direction: "increase", idempotencyKey: key() });
  });

  it("only the owner toggles it: everyone else is refused and the mode stays as it was", async () => {
    const w = await readOnlyWorld();
    expect(await fail(w.as("anon").mutation(api.adminMaintenance.setReadOnly, { on: false }))).toBe("UNAUTHENTICATED");
    for (const role of ["outsider", "player", "coGm", "gm"] as const) {
      expect(await fail(w.as(role).mutation(api.adminMaintenance.setReadOnly, { on: false })), role).toBe("FORBIDDEN");
    }
    expect(await w.as("anon").query(api.appStatus.get, {})).toEqual({ readOnly: true, message: null });
  });
});

describe("appStatus.get and adminMaintenance.setReadOnly (config AD10)", () => {
  it("everyone reads the banner, signed out included; null while off", async () => {
    const w = await buildWorld();
    expect(await w.as("anon").query(api.appStatus.get, {})).toBeNull();
    await w.as("appOwner").mutation(api.adminMaintenance.setReadOnly, { on: true, message: "  Upgrading the dice tables  " });
    for (const role of ["anon", "outsider", "player", "gm", "appOwner"] as const) {
      expect(await w.as(role).query(api.appStatus.get, {}), role).toEqual({ readOnly: true, message: "Upgrading the dice tables" });
    }
    await w.as("appOwner").mutation(api.adminMaintenance.setReadOnly, { on: false, message: "ignored while off" });
    expect(await w.as("anon").query(api.appStatus.get, {})).toBeNull();
    const row = await w.t.run((ctx) => ctx.db.query("appStatus").withIndex("by_key", (q) => q.eq("key", "app")).unique());
    expect(row).toMatchObject({ readOnly: false });
    expect(row?.message).toBeUndefined();
  });

  it("caps the message at 200 characters and audits every change", async () => {
    const w = await buildWorld();
    const owner = w.as("appOwner");
    expect(await fail(owner.mutation(api.adminMaintenance.setReadOnly, { on: true, message: "x".repeat(READ_ONLY_MESSAGE_MAX + 1) }))).toBe(
      "INVALID",
    );
    expect(await owner.query(api.appStatus.get, {})).toBeNull();
    await owner.mutation(api.adminMaintenance.setReadOnly, { on: true, message: "x".repeat(READ_ONLY_MESSAGE_MAX) });
    await owner.mutation(api.adminMaintenance.setReadOnly, { on: false });
    const audit = await w.t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
    expect(audit.filter((a) => a.action === "readOnly.set")).toMatchObject([
      { actorId: w.users.appOwner, field: "readOnly", from: false, to: true },
      { actorId: w.users.appOwner, field: "readOnly", from: true, to: false },
    ]);
  });
});

describe("adminMaintenance.keys and backups (config AD10, Q29 a)", () => {
  const SECRETS: Record<string, string> = {
    ANTHROPIC_API_KEY: "sk-ant-secret-value-123",
    AUTH_RESEND_KEY: "re_secret_value_456",
    MAIL_FROM: "secret-sender@example.com",
    SITE_URL: "https://secret-site.example.com",
    AUTH_GOOGLE_ID: "google-client-id-789.apps.googleusercontent.com",
    AUTH_GOOGLE_SECRET: "GOCSPX-google-secret-000",
    CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud",
  };
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(Object.keys(SECRETS).map((name) => [name, process.env[name]]));
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** Every string anywhere in a value. */
  const strings = (value: unknown): string[] =>
    typeof value === "string" ? [value] : value !== null && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

  it("returns booleans only, never a value", async () => {
    const w = await buildWorld();
    Object.assign(process.env, SECRETS);
    const keys = await w.as("appOwner").query(api.adminMaintenance.keys, {});
    expect(keys).toEqual({ database: true, anthropicKey: true, resendKey: true, mailFrom: true, siteUrl: true, google: true });
    const backups = await w.as("appOwner").query(api.adminMaintenance.backups, {});
    const envValues = Object.values(process.env).filter((value): value is string => typeof value === "string" && value !== "");
    for (const returned of [...strings(keys), ...strings(backups)]) expect(envValues).not.toContain(returned);
  });

  it("reports missing and blank keys as false; Google needs both its id and secret", async () => {
    const w = await buildWorld();
    for (const name of Object.keys(SECRETS)) delete process.env[name];
    process.env.MAIL_FROM = "   ";
    process.env.AUTH_GOOGLE_ID = SECRETS.AUTH_GOOGLE_ID;
    expect(await w.as("appOwner").query(api.adminMaintenance.keys, {})).toEqual({
      database: true,
      anthropicKey: false,
      resendKey: false,
      mailFrom: false,
      siteUrl: false,
      google: false,
    });
  });

  it("links this deployment's dashboard backups page with no fake last-backup time", async () => {
    const w = await buildWorld();
    process.env.CONVEX_CLOUD_URL = SECRETS.CONVEX_CLOUD_URL;
    expect(await w.as("appOwner").query(api.adminMaintenance.backups, {})).toEqual({
      dashboardUrl: "https://dashboard.convex.dev/d/happy-otter-123/settings/backups",
      note: BACKUPS_NOTE,
    });
    expect(dashboardBackupsUrl("http://127.0.0.1:3210")).toBeNull();
    expect(dashboardBackupsUrl(undefined)).toBeNull();
    expect(dashboardBackupsUrl("not a url")).toBeNull();
  });
});
