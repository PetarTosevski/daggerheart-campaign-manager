import { describe, expect, it } from "vitest";

import { featureFearCost } from "@/lib/domain/adversaries";
import { potentialAdversariesText } from "@/lib/domain/environments";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { ENVIRONMENTS } from "@/lib/srd/environments";
import { ENVIRONMENT_TYPES, type EnvironmentDef, type EnvironmentType } from "@/lib/srd/types";

// EV1: environments by tier as the books list them, Core Rulebook p.242 and Hope & Fear p.98 ("Name (Type)").
type Listed = [name: string, type: EnvironmentType];
const CORE_LIST: Record<1 | 2 | 3 | 4, Listed[]> = {
  1: [
    ["Abandoned Grove", "Exploration"],
    ["Ambushed", "Event"],
    ["Ambushers", "Event"],
    ["Bustling Marketplace", "Social"],
    ["Cliffside Ascent", "Traversal"],
    ["Local Tavern", "Social"],
    ["Outpost Town", "Social"],
    ["Raging River", "Traversal"],
  ],
  2: [
    ["Cult Ritual", "Event"],
    ["Hallowed Temple", "Social"],
    ["Haunted City", "Exploration"],
    ["Mountain Pass", "Traversal"],
  ],
  3: [
    ["Burning Heart of the Woods", "Exploration"],
    ["Castle Siege", "Event"],
    ["Pitched Battle", "Event"],
  ],
  4: [
    ["Chaos Realm", "Traversal"],
    ["Divine Usurpation", "Event"],
    ["Imperial Court", "Social"],
    ["Necromancer’s Ossuary", "Exploration"],
  ],
};
const HF_LIST: Record<1 | 2 | 3 | 4, Listed[]> = {
  1: [
    ["Abandoned Mine", "Traversal"],
    ["Alchemist’s Abandoned Workshop", "Exploration"],
    ["Corrupted Swamp", "Traversal"],
    ["Cursed Graveyard", "Exploration"],
    ["Grand Feast", "Social"],
    ["Hold the Line", "Event"],
    ["Local Festival", "Social"],
    ["Raiding Party", "Event"],
  ],
  2: [
    ["Beach Day", "Social"],
    ["Deadly Dungeon", "Exploration"],
    ["Duel", "Event"],
    ["Heist", "Event"],
    ["Masquerade Ball", "Social"],
    ["Ocean Voyage", "Traversal"],
    ["Vast Desert", "Traversal"],
    ["Witch’s Hut", "Exploration"],
  ],
  3: [
    ["Archmage’s Tower", "Exploration"],
    ["Astral Realm", "Traversal"],
    ["Crystal Wasteland", "Traversal"],
    ["Dragon’s Lair", "Exploration"],
    ["Megastorm", "Event"],
    ["Sunken Citadel", "Exploration"],
    ["Upscale Casino", "Social"],
    ["Volcanic Eruption", "Event"],
  ],
  4: [
    ["Convergence, City of Portals", "Social"],
    ["Moon Kingdom", "Exploration"],
    ["Realm of the Dead", "Traversal"],
    ["Time Court", "Event"],
  ],
};

const bySource = (source: EnvironmentDef["source"]) => ENVIRONMENTS.filter((e) => e.source === source);
const get = (name: string) => {
  const e = ENVIRONMENTS.find((x) => x.name === name);
  if (!e) throw new Error(`no environment ${name}`);
  return e;
};

describe("SRD environments (EV1)", () => {
  it("holds 47 environments: 19 Core and 28 Hope & Fear, none frame-exclusive", () => {
    expect(ENVIRONMENTS).toHaveLength(47);
    expect(bySource("core")).toHaveLength(19);
    expect(bySource("hope-and-fear")).toHaveLength(28);
    expect(ENVIRONMENTS.filter((e) => e.frameId)).toEqual([]);
  });

  it.each([
    ["core", CORE_LIST],
    ["hope-and-fear", HF_LIST],
  ] as const)("%s: names, tiers and types equal the book's list", (source, list) => {
    for (const tier of [1, 2, 3, 4] as const) {
      const got = bySource(source)
        .filter((e) => e.tier === tier)
        .map((e) => [e.name, e.type])
        .sort();
      expect(got).toEqual([...list[tier]].sort());
    }
  });

  it("has unique slug ids", () => {
    const ids = ENVIRONMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("gives every block its fields: description, impulses, difficulty, potential adversaries, features with questions", () => {
    for (const e of ENVIRONMENTS) {
      expect(ENVIRONMENT_TYPES).toContain(e.type);
      expect(e.description.length, e.name).toBeGreaterThan(10);
      expect(e.impulses.length, e.name).toBeGreaterThan(5);
      expect(e.potentialAdversaries.length, e.name).toBeGreaterThan(0);
      expect(e.features.length, e.name).toBeGreaterThanOrEqual(2);
      expect(e.page, e.name).toBeGreaterThan(0);
      if (typeof e.difficulty === "string") expect(e.difficulty).toBe("Special (see “Relative Strength”)");
      for (const f of e.features) {
        expect(["passive", "action", "reaction"], `${e.name}: ${f.name}`).toContain(f.kind);
        expect(f.text.length, `${e.name}: ${f.name}`).toBeGreaterThan(10);
        // Every feature in both books prints its italic questions (checked against the PDFs' italic runs).
        expect(f.questions, `${e.name}: ${f.name}`).toMatch(/\?[”"]?$/);
      }
    }
  });

  it("stores Difficulty as a number, and the printed text only for the three Relative Strength events", () => {
    expect(get("Raging River").difficulty).toBe(10);
    expect(get("Mountain Pass").difficulty).toBe(15);
    expect(get("Necromancer’s Ossuary").difficulty).toBe(19);
    expect(ENVIRONMENTS.filter((e) => typeof e.difficulty === "string").map((e) => e.name).sort()).toEqual(["Ambushed", "Ambushers", "Duel"]);
  });

  it("stores the Fear cost the text names and the countdown printed at the start of a feature", () => {
    for (const e of ENVIRONMENTS) {
      for (const f of e.features) {
        expect(f.fearCost ?? null, `${e.name}: ${f.name}`).toBe(featureFearCost(f.text));
        expect(f.text, `${e.name}: ${f.name}`).not.toMatch(/^(?:[A-Z][\w-]* )*Countdown/);
      }
    }
    const pass = get("Mountain Pass").features.find((f) => f.name === "Icy Winds")!;
    expect(pass).toMatchObject({ kind: "reaction", countdown: "Countdown (Loop 4)" });
    expect(pass.text.startsWith("When the PCs enter the mountain pass")).toBe(true);
    // The two digits the Core text lost, read from the rendered pages (CB pp.248, 250).
    expect(get("Burning Heart of the Woods").features.find((f) => f.name === "Choking Ash")!.countdown).toBe("Countdown (Loop 6)");
    expect(get("Chaos Realm").features.find((f) => f.name.startsWith("Everything You Are"))!.countdown).toBe("Countdown (Loop 1d4)");
    expect(get("Castle Siege").features.find((f) => f.name === "Siege Weapons (Environment Change)")!.countdown).toBe("Consequence Countdown (6)");
    expect(get("Divine Usurpation").features.find((f) => f.name === "Godslayer")!.fearCost).toBe(3);
  });

  it("keeps Raging River verbatim (CB p.245)", () => {
    const river = get("Raging River");
    expect(river).toMatchObject({
      tier: 1,
      type: "Traversal",
      description: "A swift-moving river without a bridge crossing, deep enough to sweep away most people.",
      impulses: "Bar crossing, carry away the unready, divide the land",
      difficulty: 10,
      source: "core",
      page: 245,
    });
    expect(potentialAdversariesText(river.potentialAdversaries)).toBe(
      "Beasts (Bear, Glass Snake), Jagged Knife Bandits (Hexer, Kneebreaker, Lackey, Lieutenant, Shadow, Sniper)",
    );
    expect(river.features[1]).toEqual({
      name: "Undertow",
      kind: "action",
      text: "Spend a Fear to catch a PC in the undertow. They must make an Agility Reaction Roll. On a failure, they take 1d6+1 physical damage and are moved a Close distance down the river, becoming Vulnerable until they get out of the river. On a success, they must mark a Stress.",
      fearCost: 1,
      questions: "What trinkets and baubles lie along the bottom of the riverbed? Do predators swim these rivers?",
    });
  });

  it("keeps Hope & Fear verbatim: Abandoned Mine (HF p.99)", () => {
    const mine = get("Abandoned Mine");
    expect(mine).toMatchObject({ tier: 1, type: "Traversal", difficulty: 11, source: "hope-and-fear", page: 99 });
    expect(mine.description).toBe("A twisting warren of disused tunnels carved out of the bedrock by a doomed mining outfit.");
    const labyrinth = mine.features.find((f) => f.name === "Labyrinth")!;
    expect(labyrinth.text.split("\n")).toEqual([
      "The party must complete a Progress Countdown (4) to find their way through the mines. Each time a PC rolls with Hope while finding their way through, they discover one of the curiosities below.",
      "- An unmined vein of precious metals or gemstones",
      "- Various mining tools, including a broken (but mendable) mine cart made of adamantine",
      "- Psychic echoes of the miners’ tragic end",
      "- The desiccated corpses of miners who lost their way in the tunnels",
      "- Tattered remnants of darkweave spider silk",
    ]);
    expect(mine.features.find((f) => f.name === "Impending Collapse")).toMatchObject({ kind: "reaction", countdown: "Countdown (2)" });
  });

  it("links potential adversaries to SRD adversaries that exist, by group where the book abbreviates", () => {
    const ids = new Set(ADVERSARIES.map((a) => a.id));
    const refs = ENVIRONMENTS.flatMap((e) => e.potentialAdversaries.flatMap((r) => [r, ...(r.members ?? [])]));
    for (const r of refs) if (r.adversaryId) expect(ids, r.name).toContain(r.adversaryId);
    expect(refs.filter((r) => r.adversaryId).length).toBeGreaterThan(190);
    const river = get("Raging River").potentialAdversaries[1]!;
    expect(river.members!.map((m) => m.adversaryId)).toEqual([
      "jagged-knife-hexer",
      "jagged-knife-kneebreaker",
      "jagged-knife-lackey",
      "jagged-knife-lieutenant",
      "jagged-knife-shadow",
      "jagged-knife-sniper",
    ]);
    expect(get("Chaos Realm").potentialAdversaries[0]!.members!.map((m) => m.adversaryId)).toEqual([
      "outer-realms-abomination",
      "outer-realms-corruptor",
      "outer-realms-thrall",
    ]);
    expect(get("Bustling Marketplace").potentialAdversaries.map((r) => r.adversaryId ?? null)).toEqual([null, "masked-thief", "merchant"]);
    for (const e of ENVIRONMENTS) expect(potentialAdversariesText(e.potentialAdversaries).length, e.name).toBeGreaterThan(2);
  });

  it("has no ligature splits, private-use characters or stray line breaks in prose", () => {
    for (const e of ENVIRONMENTS) {
      const prose = [e.name, e.description, e.impulses, ...e.features.flatMap((f) => [f.name, f.questions ?? ""])];
      for (const s of prose) {
        expect(s, e.name).not.toMatch(/\b(fi|fl) [a-z]|[-]/);
        expect(s, e.name).not.toContain("\n");
      }
      for (const f of e.features) expect(f.text, `${e.name}: ${f.name}`).not.toMatch(/\b(fi|fl) [a-z]|[-]|\n\n/);
    }
  });
});
