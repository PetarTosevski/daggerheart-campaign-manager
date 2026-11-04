import { describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FeatureMode } from "../../src/lib/admin/config";
import { FEATURE_KEYS } from "../../src/lib/admin/features";
import { GM_EMAIL, OTHER_EMAIL, setupWithCampaign } from "./helpers";

// Config AF1: a feature switched off for a user is off for them on the server. The Lorekeeper's internet search is
// the one switch with server code: the answer run skips the web pass (`prepare` answers webSearch false) and
// `setWebSearch` keeps the conversation's toggle off. Journal and Share links are inert (N2 a): switching them changes
// nothing. docs/tasks/TASK-CONFIG-AF1.md.

vi.mock("../../convex/lib/lorekeeper/retrieve", () => ({ retrieve: async () => [] }));

async function setup() {
  const s = await setupWithCampaign();
  const { t, gm, campaignId } = s;
  await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
  // The GM is the app owner here, so 'Only me' leaves the feature on for the GM and off for the player.
  await t.mutation(internal.adminSetup.setOwner, { email: GM_EMAIL });
  const userId = (email: string) => t.run(async (c) => (await c.db.query("users").take(5)).find((u) => u.email === email)!._id);
  const ids = { gm: await userId(GM_EMAIL), player: await userId(OTHER_EMAIL) };

  /** A conversation of `who` with the web toggle on and one pending answer, as `ask` leaves it (without its run). */
  const pendingAnswer = (who: Id<"users">) =>
    t.run(async (c) => {
      const conversationId = await c.db.insert("lorekeeperConversations", { campaignId, userId: who, title: "Web", visibility: "campaign", webSearch: true, messageCount: 2, lastAt: 1, createdAt: 1 });
      const base = { conversationId, campaignId, userId: who, createdAt: 1, updatedAt: 1 };
      await c.db.insert("lorekeeperMessages", { ...base, role: "question", status: "done", text: "Can a Ranger dual wield?" });
      const answerId = await c.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "pending", text: "" });
      return { conversationId, answerId };
    });
  const webPass = async (who: Id<"users">) => {
    const { answerId } = await pendingAnswer(who);
    return (await t.query(internal.lorekeeperRun.prepare, { answerId }))?.webSearch;
  };
  const setMode = (key: (typeof FEATURE_KEYS)[number], mode: FeatureMode) => gm.mutation(api.features.setMode, { key, mode });
  return { ...s, player: s.other, ids, pendingAnswer, webPass, setMode };
}

// The first answer run loads the frame and SRD modules `buildContext` reads, slow on a cold, loaded machine.
describe("Lorekeeper internet search switch (AF1)", { timeout: 60_000 }, () => {
  it("with no switch saved, the web pass runs for everyone (what ships today)", async () => {
    const s = await setup();
    expect(await s.webPass(s.ids.player)).toBe(true);
    expect(await s.webPass(s.ids.gm)).toBe(true);
  });

  it("Off skips the web pass for everyone, the owner included", async () => {
    const s = await setup();
    await s.setMode("lorekeeperWeb", "off");
    expect(await s.webPass(s.ids.player)).toBe(false);
    expect(await s.webPass(s.ids.gm)).toBe(false);
  });

  it("Only me keeps it for the owner and skips it for the player", async () => {
    const s = await setup();
    await s.setMode("lorekeeperWeb", "owner");
    expect(await s.webPass(s.ids.gm)).toBe(true);
    expect(await s.webPass(s.ids.player)).toBe(false);
  });

  it("Testers turns it on for a tester again", async () => {
    const s = await setup();
    await s.setMode("lorekeeperWeb", "testers");
    expect(await s.webPass(s.ids.player)).toBe(false);
    await s.t.run((c) => c.db.insert("appTesters", { userId: s.ids.player, addedAt: 1, addedBy: s.ids.gm }));
    expect(await s.webPass(s.ids.player)).toBe(true);
  });

  it("setWebSearch keeps the toggle off while the switch is off for the caller, and turns it on once it is on", async () => {
    const s = await setup();
    const { conversationId } = await s.pendingAnswer(s.ids.player);
    const toggle = async (webSearch: boolean) => {
      await s.player.mutation(api.lorekeeper.setWebSearch, { campaignId: s.campaignId, conversationId, webSearch });
      return (await s.t.run((c) => c.db.get("lorekeeperConversations", conversationId)))!.webSearch;
    };
    await s.setMode("lorekeeperWeb", "off");
    expect(await toggle(false)).toBe(false);
    expect(await toggle(true)).toBe(false);
    await s.setMode("lorekeeperWeb", "everyone");
    expect(await toggle(true)).toBe(true);
  });

  it("other switches do not touch the web pass", async () => {
    const s = await setup();
    for (const key of ["dice3d", "phoneLayout", "spriteTokens"] as const) await s.setMode(key, "off");
    expect(await s.webPass(s.ids.player)).toBe(true);
  });
});

describe("inert switches (N2 a)", { timeout: 60_000 }, () => {
  it("switching Journal and Share links off changes nothing: still on for everyone, and the web pass is untouched", async () => {
    const s = await setup();
    const before = await s.player.query(api.features.mine, {});
    await s.setMode("journal", "off");
    await s.setMode("shareLinks", "off");
    const after = await s.player.query(api.features.mine, {});
    expect(after).toEqual(before);
    expect([after.journal, after.shareLinks]).toEqual([true, true]);
    expect(await s.t.query(api.features.mine, {})).toEqual(Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])));
    expect(await s.webPass(s.ids.player)).toBe(true);
  });
});
