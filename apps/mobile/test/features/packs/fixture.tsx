import type { ReactElement } from "react";

import { CampaignProvider } from "../../../src/shell/campaign-provider";
import type { Id } from "../../../src/convex";

export const campaignId = "campaign-1" as Id<"campaigns">;
export const packId = "pack-1" as Id<"spritePacks">;
export const spriteA = "sprite-a" as Id<"spritePackSprites">;
export const spriteB = "sprite-b" as Id<"spritePackSprites">;

export const emptyPacks: never[] = [];

export const onePack = [
  {
    _id: packId,
    name: "Deep halls",
    extends: { id: "dungeon", label: "Dungeon" },
    createdAt: 1,
    sprites: [
      {
        _id: spriteA,
        name: "Rune stone",
        slug: "rune-stone",
        order: 0,
        category: "object" as const,
        w: 1,
        h: 1,
        sight: "cover" as const,
        light: "none" as const,
        height: "low" as const,
        footprint: "circle" as const,
        classicKind: "rubble" as const,
        url: "https://example.test/rune.webp",
      },
      {
        _id: spriteB,
        name: "Arch",
        slug: "arch",
        order: 1,
        category: "object" as const,
        w: 2,
        h: 2,
        sight: "block" as const,
        light: "none" as const,
        height: "tall" as const,
        footprint: "rect" as const,
        classicKind: "pillar" as const,
        url: null,
      },
    ],
  },
];

export function inCampaign(ui: ReactElement) {
  return <CampaignProvider campaignId={campaignId}>{ui}</CampaignProvider>;
}

export function gmCampaign() {
  return { _id: campaignId, name: "The Table", role: "gm" as const, tier: 1 };
}

export function playerCampaign() {
  return { _id: campaignId, name: "The Table", role: "player" as const };
}
