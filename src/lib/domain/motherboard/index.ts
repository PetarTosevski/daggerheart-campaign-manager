// Motherboard campaign rules from the book (CB 301-302) that sit outside the
// Ikonis module itself (src/lib/frames/extras/motherboard.ts). Pure module:
// bundled into Convex, relative imports only.

/** CB 301: "Each PC adds a Network tether to their inventory at character creation." */
export const NETWORK_TETHER = "Network tether";

/** True when an inventory already holds a Network tether (any case). */
export function hasTether(inventory: readonly { name: string }[]): boolean {
  return inventory.some((item) => item.name.trim().toLowerCase() === NETWORK_TETHER.toLowerCase());
}

/**
 * CB 302: "In this campaign frame, gold is not used as a currency. Instead,
 * PCs can gather scrap to trade for a currency known as quantum. … All PCs
 * start with 5 quantum." A Motherboard character starts with no gold; the
 * 5 quantum live in the Ikonis module (`INITIAL_MOTHERBOARD`).
 */
export const MOTHERBOARD_STARTING_GOLD = { handfuls: 0, bags: 0, chest: false } as const;

/** CB 301: "PCs may freely swap augments they've already crafted during downtime." */
export const SWAP_NEEDS_DOWNTIME = "PCs may freely swap augments they've already crafted during downtime (CB 301). Swap them while the party rests.";
