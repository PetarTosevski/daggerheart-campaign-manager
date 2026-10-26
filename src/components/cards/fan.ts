import type { CSSProperties } from "react";

/**
 * The fanned hand of domain cards (the board's Party.dc.html loadout, `.dk-hand-card` on the sheet's felt table),
 * shared by the sheet's Domains tab and the Combat Map's Hand (plan hand-fan HF1, dcm-bxp.99.30): each card turns
 * `FAN_STEP_DEG` per step from the middle and drops by the square of its offset, as a hand of cards held in a digital
 * card game. A used card is turned further and sinks a little (CB p.101: "turn it on its side"); hover and focus still
 * straighten it to read. Pure: no React state, so the unit tests read the numbers directly.
 */

/** Degrees each card turns per step from the middle of the hand. */
export const FAN_STEP_DEG = 7;
/** Pixels the drop grows by, times the square of the offset from the middle. */
export const FAN_DROP_PX = 7;
/** How much further a used (exhausted) card turns, and sinks. */
export const TURNED_DEG = 16;
export const TURNED_DROP_PX = 14;

/** One card's place in the fan: its turn in degrees, its drop in pixels and its stacking order (left under right). */
export type FanPose = { rot: number; ty: number; z: number };

/** The pose of card `i` of `n` (0 = leftmost); `turned` for a used card. */
export function fanPose(i: number, n: number, turned = false): FanPose {
  const off = i - (n - 1) / 2;
  return { rot: off * FAN_STEP_DEG + (turned ? TURNED_DEG : 0), ty: off * off * FAN_DROP_PX + (turned ? TURNED_DROP_PX : 0), z: i + 1 };
}

/** The pose as the CSS the fans read: `--rot`, `--ty` and the z-index. */
export function fan(i: number, n: number, turned = false): CSSProperties {
  const { rot, ty, z } = fanPose(i, n, turned);
  return { "--rot": `${rot}deg`, "--ty": `${ty}px`, zIndex: z } as CSSProperties;
}

/** Card backs per domain (board `cb-*`), for the vault deck's stack; `GENERIC_BACK` for a domain without one. */
export const GENERIC_BACK = "5bb6a224f710a73fa7d826fa6616fa4d";
export const CARD_BACKS: Readonly<Record<string, string>> = {
  arcana: "441cbcb568c811cfa8cc0a651f8f5752",
  blade: "27c8715ef459943156831f0e3c127f38",
  bone: "8c20795f8598bcf81e2f2b55c7c8ac3b",
  codex: "579e104068411cf05c61eaeed505b377",
  dread: "0dd77e7e8b4429d3db87d24a0572de31",
  grace: "644d29b2887b48454029477addb6e286",
  midnight: "58b2cb9a99716b7fdb31aa94614c4017",
  sage: "10d9bc629f16468099536863f2db622b",
  splendor: "4482af05fe6a1c75febf11dab6da1510",
  valor: "4c7f9d2c0b0c64af54dbf902ac891ffe",
};

/**
 * The three backs of the vault deck, top first: the domains of the last three vault cards, else the class's domains
 * in turn (`fallback`), else the generic back.
 */
export function deckBacks(vaultDomains: readonly string[], fallback: readonly string[] = []): string[] {
  return [0, 1, 2].map((i) => CARD_BACKS[vaultDomains[vaultDomains.length - 1 - i] ?? fallback[i % fallback.length] ?? ""] ?? GENERIC_BACK);
}
