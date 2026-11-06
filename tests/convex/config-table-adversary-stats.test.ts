import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

// Plan config U1: the Campaign settings row "Show adversary HP, Stress and Difficulty to players" is locked "Always
// off" (no setting). This backs the lock: a player's combat queries, with a running encounter and adversaries on the
// live map, never carry an adversary's HP, Stress or Difficulty. A row that names an adversary (by token id, instance
// id or name) must have none of those fields anywhere inside it.

const BEAR = { kind: "srd" as const, adversaryId: "bear" };
const STAT_KEY = /^(hp|hpMax|hpMarked|stress|stressMax|stressMarked|difficulty|thresholds|major|severe)$/i;

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0]!.id,
    ancestry: { kind: "single" as const, id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

/** Every stat key found inside an object that names an adversary (`marks`), with its path. */
function leaks(value: unknown, marks: ReadonlySet<string>, path = "$", inside = false): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => leaks(item, marks, `${path}[${i}]`, inside));
  if (value === null || typeof value !== "object") return [];
  const entries = Object.entries(value as Record<string, unknown>);
  const names = inside || entries.some(([, v]) => typeof v === "string" && marks.has(v));
  const found: string[] = [];
  for (const [k, v] of entries) {
    if (names && STAT_KEY.test(k)) found.push(`${path}.${k}`);
    found.push(...leaks(v, marks, `${path}.${k}`, names));
  }
  return found;
}

describe("config U1: adversary HP, Stress and Difficulty are always off for players", () => {
  useAllowlist("gm@example.com,other@example.com");

  it("no player combat query returns an adversary's HP, Stress or Difficulty", async () => {
    const { t, gm, other: player, campaignId } = await setupWithCampaign("witherwild");
    const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await player.mutation(api.members.joinByCode, { code: joinCode });
    const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
    const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
    const { instanceIds } = await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() });
    await gm.mutation(api.encounters.start, { campaignId, encounterId });
    await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: key() });
    const { tokenId: bandit } = await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 3, side: "enemy", idempotencyKey: key() });

    const tokens = await gm.query(api.combatTokensReads.list, { campaignId, mapId });
    const place = (tokenId: Id<"combatTokens">, x: number, y: number, face = 0) => t.run((c) => c.db.patch("combatTokens", tokenId, { x, y, face }));
    const ashToken = tokens.find((tk) => tk.name === "Ash")!._id;
    const bear = tokens.find((tk) => tk.name !== "Ash" && tk._id !== bandit)!;
    // Ash looks east at the Bear (Melee-ish) and the Bandit, in daylight.
    await place(ashToken, 5, 10, 0);
    await place(bear._id, 7, 10, Math.PI);
    await place(bandit, 9, 10, Math.PI);

    const marks = new Set<string>([bear._id, bandit, bear.name, "Bandit", ...instanceIds.map(String)]);
    const reads: Record<string, () => Promise<unknown>> = {
      "combatVision.playerView": () => player.query(api.combatVision.playerView, { campaignId }),
      "combatVision.doors": () => player.query(api.combatVision.doors, { campaignId }),
      "combatHud.party": () => player.query(api.combatHud.party, { campaignId, mapId }),
      "combatHud.scene": () => player.query(api.combatHud.scene, { campaignId }),
      "combatHud.sheet": () => player.query(api.combatHud.sheet, { characterId: ash }),
      "combatTokensReads.party": () => player.query(api.combatTokensReads.party, { campaignId, mapId }),
      "combatActionsReads.targets": () => player.query(api.combatActionsReads.targets, { campaignId, characterId: ash, mapId }),
      "combatActionsReads.riders": () => player.query(api.combatActionsReads.riders, { campaignId, characterId: ash }),
      "combatSpotlight.state": () => player.query(api.combatSpotlight.state, { campaignId }),
      "combatMaps.live": () => player.query(api.combatMaps.live, { campaignId }),
      "combatAreas.list": () => player.query(api.combatAreas.list, { campaignId, mapId }),
      "combatCardsReads.pending": () => player.query(api.combatCardsReads.pending, { campaignId }),
      "combatFeaturesReads.drawer": () => player.query(api.combatFeaturesReads.drawer, { campaignId, characterId: ash }),
      "combatFeaturesReads.pending": () => player.query(api.combatFeaturesReads.pending, { campaignId }),
      "combatRequestsReads.mine": () => player.query(api.combatRequestsReads.mine, { campaignId }),
      "combatRequestsReads.difficulties": () => player.query(api.combatRequestsReads.difficulties, { campaignId }),
      "combatRequestsReads.forcedAttacks": () => player.query(api.combatRequestsReads.forcedAttacks, { campaignId }),
      "adversaryActionsReads.pending": () => player.query(api.adversaryActionsReads.pending, { campaignId, characterId: ash }),
    };

    const found: Record<string, string[]> = {};
    for (const [name, read] of Object.entries(reads)) {
      const result = await read().catch((e: unknown) => ({ failed: errorCode(e) ?? String(e) }));
      expect([name, result]).not.toEqual([name, expect.objectContaining({ failed: expect.anything() })]);
      const hit = leaks(result, marks);
      if (hit.length > 0) found[name] = hit;
    }
    expect(found).toEqual({});

    // The test sees the adversaries at all: the player's vision and target list name them.
    const view = await player.query(api.combatVision.playerView, { campaignId });
    expect(view.state === "ok" && view.others.map((o) => o.name).sort()).toEqual(["Bandit", bear.name].sort());
    const targets = JSON.stringify(await reads["combatActionsReads.targets"]!());
    expect(targets).toContain(bear._id);
    // The leak finder does catch stats next to an adversary's name (the GM's own token list carries HP).
    expect(leaks(await gm.query(api.combatTokensReads.list, { campaignId, mapId }), marks).length).toBeGreaterThan(0);
  });
});
