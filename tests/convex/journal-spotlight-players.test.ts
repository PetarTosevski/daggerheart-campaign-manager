import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

// Config JO3 (plan .omc/plans/config.yaml, user answer Q5 a): `journalTally.spotlight`, the Journal's spotlight bars,
// is a view query. The GM and co-GMs always get the bars; a player gets them only with the table setting
// `spotlightToPlayers` on (default off), else null; an outsider is NOT_FOUND. The tally tiles stay GM-only.

allowWorldEmails();

async function setup() {
  const w = await buildWorld();
  const gm = w.as("gm");
  const { campaignId } = w;
  const { sessionId } = (await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() })) as { sessionId: Id<"sessions"> };
  await gm.mutation(api.combatSpotlight.handTo, { campaignId, characterId: w.characterA, idempotencyKey: key() });
  const read = (role: Parameters<typeof w.as>[0]) => w.as(role).query(api.journalTally.spotlight, { campaignId, sessionId });
  const setSetting = (value: boolean) =>
    gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "spotlightToPlayers", value } });
  return { w, campaignId, sessionId, read, setSetting };
}

const codeOf = (p: Promise<unknown>) => p.then(() => "ok", errorCode);

describe("journalTally.spotlight for players (JO3)", () => {
  it("a player gets null with the setting off (the default)", async () => {
    const s = await setup();
    expect(await s.read("player")).toBeNull();
    expect(await s.read("otherPlayer")).toBeNull();
  });

  it("a player gets the bars with the setting on, and null again once it is off", async () => {
    const s = await setup();
    await s.setSetting(true);
    const bars = await s.read("player");
    expect(bars?.map((e) => [e.characterId, e.count, e.due])).toEqual([
      [s.w.characterA, 1, false],
      [s.w.characterB, 0, true],
    ]);
    expect(await s.read("otherPlayer")).toEqual(bars);
    await s.setSetting(false);
    expect(await s.read("player")).toBeNull();
  });

  it("the GM and a co-GM always get the bars, whatever the setting", async () => {
    const s = await setup();
    for (const value of [false, true]) {
      await s.setSetting(value);
      for (const role of ["gm", "coGm"] as const) {
        const bars = await s.read(role);
        expect(bars?.map((e) => e.count)).toEqual([1, 0]);
      }
    }
  });

  it("the tally tiles stay GM-only with the setting on", async () => {
    const s = await setup();
    await s.setSetting(true);
    expect(await codeOf(s.w.as("player").query(api.journalTally.tally, { campaignId: s.campaignId, sessionId: s.sessionId }))).toBe("FORBIDDEN");
  });

  it("an outsider gets NOT_FOUND and a signed-out caller UNAUTHENTICATED, setting on or off", async () => {
    const s = await setup();
    for (const value of [false, true]) {
      await s.setSetting(value);
      expect(await codeOf(s.read("outsider"))).toBe("NOT_FOUND");
      expect(await codeOf(s.read("anon"))).toBe("UNAUTHENTICATED");
    }
  });
});
