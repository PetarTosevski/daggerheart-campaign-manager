// GENERATED FILE, do not edit by hand. Generator: scripts/srd/extract-environment-art.mjs (plan
// .omc/plans/env-actions.yaml, EA1). Rerun locally with the two rulebook PDFs from .reference-private/.
// Environment id -> its illustration from the rulebook's environment chapter (credit = book and printed page).
// Pure data: no framework imports.

import type { AdversaryArt } from "./adversary-art";

export type EnvironmentArt = AdversaryArt;

/** Illustrations per book: Core Rulebook 13, Hope & Fear 16. */
export const ENVIRONMENT_ART_COUNT = {"core":13,"hope-and-fear":16} as const;

export const ENVIRONMENT_ART: Readonly<Record<string, EnvironmentArt>> = {
  "abandoned-mine": { src: "/environment-art/abandoned-mine.webp", width: 1800, height: 1281, credit: "HF p.98" },
  "alchemists-abandoned-workshop": { src: "/environment-art/alchemists-abandoned-workshop.webp", width: 1800, height: 881, credit: "HF p.99" },
  "archmages-tower": { src: "/environment-art/archmages-tower.webp", width: 1650, height: 1760, credit: "HF p.107" },
  "astral-realm": { src: "/environment-art/astral-realm.webp", width: 1550, height: 1388, credit: "HF p.107" },
  "burning-heart-of-the-woods": { src: "/environment-art/burning-heart-of-the-woods.webp", width: 1800, height: 4345, credit: "CB p.248" },
  "castle-siege": { src: "/environment-art/castle-siege.webp", width: 1800, height: 1464, credit: "CB p.249" },
  "chaos-realm": { src: "/environment-art/chaos-realm.webp", width: 1800, height: 858, credit: "CB p.250" },
  "cliffside-ascent": { src: "/environment-art/cliffside-ascent.webp", width: 1694, height: 2256, credit: "CB p.244" },
  "corrupted-swamp": { src: "/environment-art/corrupted-swamp.webp", width: 1524, height: 1252, credit: "HF p.100" },
  "crystal-wasteland": { src: "/environment-art/crystal-wasteland.webp", width: 1800, height: 766, credit: "HF p.108" },
  "cult-ritual": { src: "/environment-art/cult-ritual.webp", width: 1800, height: 1128, credit: "CB p.246" },
  "cursed-graveyard": { src: "/environment-art/cursed-graveyard.webp", width: 1666, height: 1398, credit: "HF p.100" },
  "deadly-dungeon": { src: "/environment-art/deadly-dungeon.webp", width: 1800, height: 1073, credit: "HF p.103" },
  "hallowed-temple": { src: "/environment-art/hallowed-temple.webp", width: 1800, height: 1292, credit: "CB p.246" },
  "haunted-city": { src: "/environment-art/haunted-city.webp", width: 1800, height: 1114, credit: "CB p.247" },
  "heist": { src: "/environment-art/heist.webp", width: 1800, height: 1084, credit: "HF p.104" },
  "hold-the-line": { src: "/environment-art/hold-the-line.webp", width: 1800, height: 814, credit: "HF p.101" },
  "local-festival": { src: "/environment-art/local-festival.webp", width: 1800, height: 855, credit: "HF p.102" },
  "local-tavern": { src: "/environment-art/local-tavern.webp", width: 1800, height: 1221, credit: "CB p.244" },
  "masquerade-ball": { src: "/environment-art/masquerade-ball.webp", width: 1800, height: 1001, credit: "HF p.105" },
  "mountain-pass": { src: "/environment-art/mountain-pass.webp", width: 1800, height: 1569, credit: "CB p.247" },
  "necromancers-ossuary": { src: "/environment-art/necromancers-ossuary.webp", width: 1800, height: 923, credit: "CB p.251" },
  "outpost-town": { src: "/environment-art/outpost-town.webp", width: 1800, height: 1150, credit: "CB p.245" },
  "pitched-battle": { src: "/environment-art/pitched-battle.webp", width: 1800, height: 1538, credit: "CB p.249" },
  "raging-river": { src: "/environment-art/raging-river.webp", width: 1800, height: 2267, credit: "CB p.245" },
  "realm-of-the-dead": { src: "/environment-art/realm-of-the-dead.webp", width: 1800, height: 997, credit: "HF p.112" },
  "sunken-citadel": { src: "/environment-art/sunken-citadel.webp", width: 1800, height: 820, credit: "HF p.109" },
  "volcanic-eruption": { src: "/environment-art/volcanic-eruption.webp", width: 1800, height: 869, credit: "HF p.110" },
  "witchs-hut": { src: "/environment-art/witchs-hut.webp", width: 1800, height: 717, credit: "HF p.106" },
};

/** The art for an environment id, if the rulebook illustrates it. */
export function environmentArt(id: string | undefined): EnvironmentArt | undefined {
  return id === undefined ? undefined : ENVIRONMENT_ART[id];
}
