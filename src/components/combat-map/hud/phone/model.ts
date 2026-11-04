import type { HudPartyMember } from "../banners/banner";
import type { PickReach, PickState } from "../pick";

/**
 * Pure pieces of the phone shell (plan combat-hud H7.2; board PlayerPhone; HANDOFF "Phone (390)"): the mini banner's
 * bars, the resource line under the bottom sheet's handle, and the edge chips for off-screen targets.
 */

/** The phone width: the classic page's bottom-sheet breakpoint (actions/index.tsx `SHEET_QUERY`, combat-map.css). */
export const PHONE_QUERY = "(max-width: 760px)";

/** The bottom sheet's tabs (PlayerPhone 'Hand tab'; the classic sheet's Q11 tabs). */
export type PhoneTab = "hand" | "attack" | "dice" | "feed";

export const PHONE_TABS: readonly { key: PhoneTab; label: string }[] = [
  { key: "hand", label: "Hand" },
  { key: "attack", label: "Attack" },
  { key: "dice", label: "Dice" },
  { key: "feed", label: "Feed" },
];

const share = (n: number, max: number) => (max <= 0 ? 0 : Math.max(0, Math.min(1, n / max)));

/** The mini banner's two bars (PlayerPhone `.mb-bars`): red = HP left (answer 2: rings and bars show HP left), blue = Stress marked. */
export function miniBars(member: Pick<HudPartyMember, "hp" | "stress">): { hp: number; stress: number } {
  return { hp: share(member.hp.max - member.hp.marked, member.hp.max), stress: share(member.stress.marked, member.stress.max) };
}

export type ResourceItem = {
  kind: "hp" | "stress" | "hope" | "armor";
  /** What the line shows: "2/6". */
  text: string;
  /** What a screen reader hears: "2 of 6 Hit Points marked" (answer 2: the numbers read as marked). */
  label: string;
};

/**
 * The resource line (PlayerPhone `.mres`): HP, Stress and Armor as marked of max (answer 2: numbers read "n of 6
 * marked", as the banners say them), Hope as value of max. Armor only when the character has an armor score.
 */
export function resourceItems(member: Pick<HudPartyMember, "hp" | "stress" | "hope" | "armor">): ResourceItem[] {
  const items: ResourceItem[] = [
    { kind: "hp", text: `${member.hp.marked}/${member.hp.max}`, label: `${member.hp.marked} of ${member.hp.max} Hit Points marked` },
    { kind: "stress", text: `${member.stress.marked}/${member.stress.max}`, label: `${member.stress.marked} of ${member.stress.max} Stress marked` },
    { kind: "hope", text: `${member.hope.value}/${member.hope.max}`, label: `Hope ${member.hope.value} of ${member.hope.max}` },
  ];
  if (member.armor.max > 0) {
    items.push({ kind: "armor", text: `${member.armor.marked}/${member.armor.max}`, label: `${member.armor.marked} of ${member.armor.max} Armor Slots marked` });
  }
  return items;
}

// ---------------------------------------------------------------- edge chips

/** Which screen edge a chip hangs on, and the arrow it points with. */
export type EdgeSide = "left" | "right";
export type EdgeArrow = "←" | "→" | "↑" | "↓";

export type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Where an off-screen ring's chip goes, or null when the ring's centre is on screen. `view` is the visible map (the
 * viewport less the strip on top and any bottom sheet below), in the same coordinates as `centre`; `y` is clamped into
 * it so the chip stays readable. The chip hangs on the side the ring is on (right when it is only above or below and
 * right of the middle), and its arrow points the main way to it.
 */
export function edgePlace(centre: { x: number; y: number }, view: Rect, chipHeight = 28): { side: EdgeSide; arrow: EdgeArrow; y: number } | null {
  const offX = centre.x < view.left ? centre.x - view.left : centre.x > view.right ? centre.x - view.right : 0;
  const offY = centre.y < view.top ? centre.y - view.top : centre.y > view.bottom ? centre.y - view.bottom : 0;
  if (offX === 0 && offY === 0) return null;
  const side: EdgeSide = offX < 0 || (offX === 0 && centre.x < (view.left + view.right) / 2) ? "left" : "right";
  const arrow: EdgeArrow = Math.abs(offX) >= Math.abs(offY) ? (offX < 0 ? "←" : "→") : offY < 0 ? "↑" : "↓";
  const low = view.top + 4;
  const high = Math.max(low, view.bottom - chipHeight - 4);
  const y = Math.round(Math.max(low, Math.min(high, centre.y - chipHeight / 2)));
  return { side, arrow, y };
}

/**
 * Keeps chips on one edge from covering each other: top to bottom, each starts at least one chip (plus a 4 px gap)
 * below the one before it. Order and sides are kept; only `y` moves down.
 */
export function stackChips<T extends { side: EdgeSide; y: number }>(chips: readonly T[], chipHeight = 28): T[] {
  const out = chips.map((c) => ({ ...c }));
  for (const side of ["left", "right"] as const) {
    let next = -Infinity;
    for (const chip of out.filter((c) => c.side === side).sort((a, b) => a.y - b.y)) {
      chip.y = Math.max(chip.y, next);
      next = chip.y + chipHeight + 4;
    }
  }
  return out;
}

/**
 * A chip's words (PlayerPhone `.edge`): "Sniper · Very Far · GM →" out of range (the GM approves, hard rule 3),
 * "Bandit · can’t see →" without line of sight, else the name and its band ("Lieutenant · Far →"). Never a number
 * (hard rule 2).
 */
export function edgeText(row: { name: string; band: string | null; reach: PickReach }, state: PickState, arrow: EdgeArrow): string {
  const parts = [row.name];
  if (state === "los" || row.reach === "los") parts.push("can’t see");
  else {
    if (row.band) parts.push(row.band);
    if (row.reach === "out") parts.push("GM");
  }
  return `${parts.join(" · ")} ${arrow}`;
}

/** The chip's tone: amber out of range, salmon without sight, gold otherwise (picked or in reach). */
export function edgeTone(row: { reach: PickReach }, state: PickState): "out" | "los" | "in" {
  if (state === "los" || row.reach === "los") return "los";
  return row.reach === "out" ? "out" : "in";
}
