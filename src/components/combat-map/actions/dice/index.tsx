/**
 * The map dice box and mini feed (plan combat-actions CA5, U2) went with the cut-over (plan combat-hud H8.1): the HUD's
 * dice (`hud/scene/dice.tsx`) and feed (`hud/feed`) replace them. The row count stays: the adversary hit flashes read the
 * same latest feed rows (`actions/adversary/flash.tsx`).
 */

/** How many of the latest roll-feed rows are read. */
export const MINI_FEED_ROWS = 6;
