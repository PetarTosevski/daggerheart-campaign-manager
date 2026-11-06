/**
 * The Combat HUD token (plan combat-hud H1.3): `TokenFace` and the model the classic token layers use when the switch
 * is on (`tokens/tokens-layer.tsx` for the GM's tokens and a player's PCs, `vision/vision-layer.tsx` for the non-PC
 * tokens a player sees). Unit tests: tests/unit/hud/token-face.test.tsx.
 */
export { FallBox, FallButton, fallChoiceText, useFallingDamage, type FallTarget } from "./fall";
export { TokenFace } from "./face";
export type { TokenFaceProps } from "./face";
export { refuseMove, useHudMoveLock, useHudTokens, useOptionalHud, useTokenHope } from "./hooks";
export { arcsOf, artOf, conditionName, hopeByToken, markedPhrase, moveNoticeText, otherFace, pcTokenFace, showsNumbers, toneOf } from "./model";
export type { HudTokenFace, TokenArcs, TokenArt, TokenCondition, TokenTone } from "./model";
