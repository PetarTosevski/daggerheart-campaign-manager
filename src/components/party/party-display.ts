// Pure display helpers for the Party roster and the dashboard party cards
// (ported from reference/designs/project/Party.dc.html and CampaignHub.dc.html).

import type { CSSProperties } from "react";

import { hopeMax } from "@/lib/domain/characters";
import { PORTRAITS } from "@/lib/srd/art";
import { CLASSES } from "@/lib/srd/classes";
import { DOMAINS } from "@/lib/srd/domains";
import { ANCESTRIES, COMMUNITIES } from "@/lib/srd/heritage";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import type { DomainId, PortraitArt } from "@/lib/srd/types";
import type { CharacterSheet } from "@/lib/validation/characters";

// CL9: SRD leaf modules, not the @/lib/srd barrel (its helpers close over every list, domain cards and all tiers).
const getAncestry = (id: string) => ANCESTRIES.find((a) => a.id === id);
const getClass = (id: string) => CLASSES.find((c) => c.id === id);
const getCommunity = (id: string) => COMMUNITIES.find((c) => c.id === id);
const getDomain = (id: string) => DOMAINS.find((d) => d.id === id);
const getSubclass = (id: string) => SUBCLASSES.find((s) => s.id === id);
const portraitFor = (opts: { subclassId?: string | null; ancestryId?: string | null }): PortraitArt | undefined =>
  (opts.subclassId ? PORTRAITS[`sub-${opts.subclassId}`] : undefined) ?? (opts.ancestryId ? PORTRAITS[`anc-${opts.ancestryId}`] : undefined);

/** Domain emblems from the Party board (`.dom-<domain>` classes), as design asset ids. */
export const DOMAIN_ICONS: Readonly<Record<string, string>> = {
  arcana: "dbed3c9d6a72831c3c1947f041778474",
  blade: "3269197f5cbf0e70936015d2d16cbbcb",
  bone: "6b9a054e5e6a373f1ff6f54c4e337612",
  codex: "851048dfc8fa331e4cd77c16c40a4167",
  grace: "da4640f852b6ab28b37e87f8910caff9",
  midnight: "00781088d1823e6e9800092acb9e2152",
  sage: "903ded076fded425a8adcea4c91e1173",
  splendor: "d5deed750bc84bc6862cdd8853d4a282",
  valor: "37376d440b57ebf60e14f9cdc002e754",
  dread: "43e1316c00829c7caebd8ca07c094984",
};

/** Resource tile art (CampaignHub `.st-hp`, `.st-stress`, `.st-hope`). */
export const TILE_ART = {
  hp: "385b2e5dbf2e03d3d350a56249c18af1",
  stress: "01faedf2925c87a23cab4d30d8272e54",
  hope: "cb6e4fcec4424c63d8bcd09160fba0c0",
} as const;

const FALLBACK_BANNER = "#5b2b2b";

/** The class banner: the two domain colours with the board's faint rings. */
export function domainBanner(domains: readonly DomainId[]): string {
  const [a, b] = [domains[0], domains[1] ?? domains[0]].map((d) => (d && getDomain(d)?.color) || FALLBACK_BANNER);
  return [
    "radial-gradient(circle at 84% 50%, rgba(255, 255, 255, 0.10) 0 16%, transparent 17%)",
    "radial-gradient(circle at 84% 50%, transparent 0 24%, rgba(255, 255, 255, 0.08) 25% 27%, transparent 28%)",
    "radial-gradient(circle at 70% 20%, transparent 0 9%, rgba(255, 255, 255, 0.07) 10% 11%, transparent 12%)",
    "radial-gradient(ellipse at 50% 120%, rgba(0, 0, 0, 0.35), transparent 60%)",
    `linear-gradient(100deg, ${a} 0%, ${a} 34%, ${b} 66%, ${b} 100%)`,
  ].join(", ");
}

type Heritage = Pick<CharacterSheet, "ancestry" | "communityId">;

/** The ancestry whose art stands in for the portrait (a mixed heritage uses the first). */
export function portraitAncestryId(ancestry: CharacterSheet["ancestry"]): string {
  if (ancestry.kind === "single") return ancestry.id;
  if (ancestry.kind === "mixed") return ancestry.first;
  return ancestry.form;
}

export function ancestryLabel(ancestry: CharacterSheet["ancestry"]): string {
  const name = (id: string) => getAncestry(id)?.name ?? id;
  if (ancestry.kind === "single") return name(ancestry.id);
  if (ancestry.kind === "mixed") return ancestry.name.trim() || `${name(ancestry.first)}/${name(ancestry.second)}`;
  return `Shapeshifter (${name(ancestry.form)})`;
}

/** "Dwarf · Ridgeborne". */
export function heritageLine(sheet: Heritage): string {
  return [ancestryLabel(sheet.ancestry), getCommunity(sheet.communityId)?.name].filter(Boolean).join(" · ");
}

export type ClassLine = Pick<CharacterSheet, "classId" | "subclassId" | "level" | "ancestry" | "communityId">;

/** Dashboard card lines: "Dwarf Warrior · Level 1" and "Call of the Brave · Ridgeborne". */
export function classLines(sheet: ClassLine): { line: string; sub: string } {
  const cls = getClass(sheet.classId)?.name ?? sheet.classId;
  return {
    line: `${ancestryLabel(sheet.ancestry)} ${cls} · Level ${sheet.level}`,
    sub: [getSubclass(sheet.subclassId)?.name, getCommunity(sheet.communityId)?.name].filter(Boolean).join(" · "),
  };
}

export type PortraitSource =
  | { kind: "upload"; storageId: string }
  | { kind: "asset"; asset: string; position: string }
  | { kind: "initial"; letter: string };

/** Uploaded image → chosen design art → default art by subclass/ancestry → the name's initial. */
export function portraitSource(sheet: Pick<CharacterSheet, "portrait" | "subclassId" | "ancestry" | "name" | "classId">): PortraitSource {
  if (sheet.portrait?.kind === "upload") return { kind: "upload", storageId: sheet.portrait.storageId };
  if (sheet.portrait?.kind === "asset") return { kind: "asset", asset: sheet.portrait.asset, position: "center 30%" };
  const art = portraitFor({ subclassId: sheet.subclassId, ancestryId: portraitAncestryId(sheet.ancestry) });
  if (art) return { kind: "asset", asset: art.asset, position: art.position };
  return { kind: "initial", letter: (sheet.name || getClass(sheet.classId)?.name || "?").charAt(0).toUpperCase() };
}

export type Owner = { ownerId: string; mine: boolean };
export type Table = { gm: { userId: string; name: string }; players: readonly { userId: string; name: string }[] };

/** The owner badge: "Unassigned" while the GM holds it, else "Yours" or the player's name. */
export function ownerLabel(character: Owner, table: Table | undefined): string {
  if (table && character.ownerId === table.gm.userId) return "Unassigned";
  if (character.mine) return "Yours";
  const player = table?.players.find((p) => p.userId === character.ownerId);
  return player?.name ?? (table ? "Former player" : "…");
}

/** Shrinks an image to fit within `max` on its longer side, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export { applyResourceDelta, type Resource } from "@/lib/domain/characters";

export type TileKey = "hp" | "stress" | "hope";

export type Tile = {
  key: TileKey;
  label: string;
  /** Marked HP/Stress slots, or Hope held. */
  value: number;
  max: number;
  /** Scars: Hope slots lost, drawn as broken segments after the max. */
  broken: number;
  color: string;
  hint: string;
};

/**
 * The three tiles. HP and Stress show marked slots out of the maximum, as the
 * sheet tracks them (the Hub board's convention, used on the roster too); Hope
 * shows Hope held out of 6 (+1 with Light in the Dark) − scars.
 */
export function resourceTiles(
  sheet: Pick<CharacterSheet, "hp" | "hpMax" | "stress" | "stressMax" | "hope" | "scars"> & { hopeSlotBonus?: number },
): Tile[] {
  const hope = hopeMax(sheet.scars, sheet.hopeSlotBonus ?? 0);
  return [
    { key: "hp", label: "HP", value: Math.min(sheet.hp, sheet.hpMax), max: sheet.hpMax, broken: 0, color: "#e0605a", hint: sheet.hp >= sheet.hpMax ? "Down" : "marked" },
    {
      key: "stress",
      label: "Stress",
      value: Math.min(sheet.stress, sheet.stressMax),
      max: sheet.stressMax,
      broken: 0,
      color: "#b9a3f5",
      hint: sheet.stress >= sheet.stressMax ? "Breaking" : "marked",
    },
    {
      key: "hope",
      label: "Hope",
      value: Math.min(sheet.hope, hope),
      max: hope,
      broken: sheet.scars,
      color: "#f0cf8a",
      hint: sheet.scars ? `${sheet.scars} scar${sheet.scars > 1 ? "s" : ""}` : "held",
    },
  ];
}

/** Tile look by fill ratio `t` (0–1): HP drains, Stress glows violet, Hope brightens. */
export function tileLook(key: TileKey, t: number): { tile: CSSProperties; overlay: CSSProperties } {
  const f = (n: number) => n.toFixed(2);
  if (key === "hp") {
    return {
      tile: { filter: `saturate(${f(1 - t * 0.7)}) brightness(${f(1 - t * 0.45)})`, boxShadow: `0 0 0 1px rgba(224, 96, 90, ${f(0.3 + t * 0.6)})` },
      overlay: {
        left: 0,
        right: 0,
        bottom: 0,
        height: `${Math.round(t * 100)}%`,
        background: "linear-gradient(0deg, rgba(120, 10, 10, 0.75), rgba(60, 0, 0, 0.35))",
        mixBlendMode: "multiply",
        transition: "height .3s",
      },
    };
  }
  if (key === "stress") {
    return {
      tile: {
        filter: `contrast(${f(1 + t * 0.5)}) hue-rotate(${Math.round(t * 25)}deg) brightness(${f(0.8 + t * 0.3)})`,
        boxShadow: `0 0 ${Math.round(t * 16)}px rgba(170, 140, 255, ${f(t * 0.8)}), 0 0 0 1px rgba(185, 163, 245, ${f(0.3 + t * 0.6)})`,
      },
      overlay: { inset: 0, boxShadow: `inset 0 0 ${Math.round(4 + t * 30)}px rgba(170, 140, 255, ${f(0.15 + t * 0.7)})` },
    };
  }
  return {
    tile: {
      filter: `grayscale(${f(1 - t)}) brightness(${f(0.45 + t * 0.65)})`,
      boxShadow: `0 0 ${Math.round(t * 18)}px rgba(240, 207, 138, ${f(t * 0.7)}), 0 0 0 1px rgba(240, 207, 138, ${f(0.3 + t * 0.6)})`,
    },
    overlay: { inset: 0, background: `radial-gradient(circle at 50% 35%, rgba(255, 215, 120, ${f(t * 0.45)}) 0%, transparent 65%)` },
  };
}

/** Segment states under a tile: filled, empty, or broken (a scar). */
export function segments(value: number, max: number, broken = 0): ("on" | "off" | "broken")[] {
  return Array.from({ length: max + broken }, (_, k) => (k >= max ? "broken" : k < value ? "on" : "off"));
}
