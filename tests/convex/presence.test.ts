/**
 * Config PR1 (Q11 b; docs/tasks/TASK-CONFIG-PR1.md): Online / Away through the `@convex-dev/presence` component,
 * wrapped in convex/presence.ts. The caller is always `ctx.user`; only the GM and co-GMs read the room, and only its
 * members show. Access rows for every role are in tests/convex/authz/config-presence.entries.ts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { HEARTBEAT_MAX_MS } from "../../convex/presence";
import { buildWorld, type Role, type World } from "./authz/world";

type Beat = { sessionToken: string; roomToken: string };

function beat(w: World, role: Role, sessionId = `tab-${role}`, roomId: string = w.campaignId): Promise<Beat> {
  return w.as(role).mutation(api.presence.heartbeat, { roomId, userId: "label only", sessionId, interval: 10_000 });
}

function online(w: World, role: Role = "gm") {
  return w.as(role).query(api.presence.list, { campaignId: w.campaignId });
}

async function code(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code ?? "not a ConvexError";
  }
}

const row = (userId: Id<"users">, isOnline: boolean) => ({ userId, online: isOnline });

describe("presence (config PR1)", () => {
  test("a member's beat puts them online for the GM and the co-GM; the hook gets no room token", async () => {
    const w = await buildWorld();
    const result = await beat(w, "player");
    expect(result.roomToken).toBe("");
    expect(typeof result.sessionToken).toBe("string");
    await beat(w, "gm");
    const gmView = await online(w);
    expect(gmView).toHaveLength(2);
    expect(gmView).toEqual(expect.arrayContaining([row(w.users.player, true), row(w.users.gm, true)]));
    expect(await online(w, "coGm")).toEqual(gmView);
  });

  test("players and strangers never read the room", async () => {
    const w = await buildWorld();
    await beat(w, "player");
    expect(await code(online(w, "player"))).toBe("FORBIDDEN");
    expect(await code(online(w, "otherPlayer"))).toBe("FORBIDDEN");
    expect(await code(online(w, "outsider"))).toBe("NOT_FOUND");
    expect(await w.as("player").query(api.presence.roomList, { roomToken: w.campaignId })).toEqual([]);
  });

  test("the user is the caller, whatever userId the client sends", async () => {
    const w = await buildWorld();
    await w.as("player").mutation(api.presence.heartbeat, {
      roomId: w.campaignId,
      userId: w.users.gm,
      sessionId: "forged",
      interval: 10_000,
    });
    expect(await online(w)).toEqual([row(w.users.player, true)]);
  });

  test("strangers, signed-out callers and unknown rooms are refused", async () => {
    const w = await buildWorld();
    expect(await code(beat(w, "outsider"))).toBe("NOT_FOUND");
    expect(await code(beat(w, "anon"))).toBe("UNAUTHENTICATED");
    expect(await code(beat(w, "player", "tab", "not-a-campaign"))).toBe("NOT_FOUND");
    expect(await code(beat(w, "player", ""))).toBe("INVALID");
    expect(await code(beat(w, "player", "x".repeat(300)))).toBe("INVALID");
    expect(await online(w)).toEqual([]);
  });

  test("an archived campaign still records presence (opening it beats)", async () => {
    const w = await buildWorld();
    await w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId, { archivedAt: Date.now() }));
    await beat(w, "player");
    expect(await online(w)).toEqual([row(w.users.player, true)]);
  });

  test("disconnect ends the caller's tab; the user stays online while another tab beats", async () => {
    const w = await buildWorld();
    const first = await beat(w, "player", "tab-1");
    const second = await beat(w, "player", "tab-2");
    await w.as("player").mutation(api.presence.disconnect, { sessionToken: first.sessionToken });
    expect(await online(w)).toEqual([row(w.users.player, true)]);
    await w.as("player").mutation(api.presence.disconnect, { sessionToken: second.sessionToken });
    expect(await online(w)).toEqual([row(w.users.player, false)]);
    // Again, and for a room the caller isn't online in: nothing to do.
    await w.as("player").mutation(api.presence.disconnect, { sessionToken: second.sessionToken });
    expect(await online(w)).toEqual([row(w.users.player, false)]);
  });

  test("someone else's session handle never disconnects them", async () => {
    const w = await buildWorld();
    const victim = await beat(w, "player");
    await beat(w, "otherPlayer");
    await w.as("otherPlayer").mutation(api.presence.disconnect, { sessionToken: victim.sessionToken });
    const view = await online(w);
    expect(view).toEqual(expect.arrayContaining([row(w.users.player, true)]));
    // The thief's own session in that room is untouched too (the handle names the victim's tab id, not theirs).
    expect(view).toEqual(expect.arrayContaining([row(w.users.otherPlayer, true)]));
    expect(await code(w.as("outsider").mutation(api.presence.disconnect, { sessionToken: victim.sessionToken }))).toBe("NOT_FOUND");
    expect(await code(w.as("player").mutation(api.presence.disconnect, { sessionToken: "not json" }))).toBe("INVALID");
    expect(await code(w.as("player").mutation(api.presence.disconnect, { sessionToken: "[1,2]" }))).toBe("INVALID");
  });

  test("a removed member no longer shows, even while their tab still beats", async () => {
    const w = await buildWorld();
    await beat(w, "otherPlayer");
    await beat(w, "player");
    await w.as("gm").mutation(api.members.removePlayer, { campaignId: w.campaignId, userId: w.users.otherPlayer });
    expect(await online(w)).toEqual([row(w.users.player, true)]);
    // And they can't beat any more.
    expect(await code(beat(w, "otherPlayer"))).toBe("NOT_FOUND");
  });

  describe("timeouts", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("a tab that stops beating goes Away after 2.5 intervals; a huge interval is capped", async () => {
      const w = await buildWorld();
      await w.as("player").mutation(api.presence.heartbeat, {
        roomId: w.campaignId,
        userId: "label",
        sessionId: "tab",
        interval: 24 * 60 * 60 * 1000,
      });
      expect(await online(w)).toEqual([row(w.users.player, true)]);
      // The server caps the interval at HEARTBEAT_MAX_MS, so the session ends 2.5 of those later, not a day later.
      vi.advanceTimersByTime(HEARTBEAT_MAX_MS * 2.5 + 5_000);
      await w.t.finishInProgressScheduledFunctions();
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(5_000);
        await w.t.finishInProgressScheduledFunctions();
      }
      expect(await online(w)).toEqual([row(w.users.player, false)]);
    });
  });
});
