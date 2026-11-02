/**
 * The ONE import of FearConfirm in hud/statblock (plan combat-hud H5.2, answer 6a). H5.3 builds the real one in
 * hud/fear in the same wave; until it merges this points at the local stand-in. Merge-time swap:
 *   export { FearConfirm } from "../fear";
 * and delete ./fear-shim.tsx (and its `.hsb-fc` rules in statblock.css).
 */
export { FearConfirm } from "./fear-shim";
