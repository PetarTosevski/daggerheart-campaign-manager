/**
 * A PC token's portrait (C6). Split out of `../combatTokens` (dcm-uh6r) so the HUD and vision queries that show
 * portraits do not load the token mutations, the areas and the card runner with them; `../combatTokens` re-exports
 * `pcPortrait`.
 */
import { v, type Infer } from "convex/values";

import { PORTRAITS } from "../../src/lib/srd/art";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { readSheet } from "./characterSheet";
import { ownFileUrl } from "./ownFiles";
import { portraitFrameValidator } from "./validators/characters";

/**
 * A token's portrait: an uploaded image or rulebook art (url), the chosen or default design art (an asset id), or none
 * (initials). `frame` (plan portrait-frame, PZ2; widened, optional): a PC's saved close-up, `sheet.portraitFrame`, which
 * every site draws through `portraitFrameStyle`; absent for adversaries and for a PC without one (today's framing).
 */
export const tokenPortraitValidator = v.union(
  v.null(),
  v.object({ kind: v.literal("url"), url: v.string(), frame: v.optional(portraitFrameValidator) }),
  v.object({ kind: v.literal("asset"), asset: v.string(), position: v.string(), frame: v.optional(portraitFrameValidator) }),
);
export type TokenPortrait = Infer<typeof tokenPortraitValidator>;

/**
 * A PC's portrait (CharacterPortrait's order: upload, chosen art, default art by subclass then ancestry), with the
 * sheet's saved close-up as `frame` when it has one (no frame: exactly the shape of before).
 */
export async function pcPortrait(ctx: QueryCtx, characterId: Id<"characters">, sheet: ReturnType<typeof readSheet>): Promise<TokenPortrait> {
  const saved = sheet.portraitFrame;
  const frame = saved ? { frame: { zoom: saved.zoom, x: saved.x, y: saved.y } } : {};
  if (sheet.portrait?.kind === "upload") {
    const url = await ownFileUrl(ctx, "portrait", characterId, sheet.portrait.storageId);
    return url === null ? null : { kind: "url", url, ...frame };
  }
  if (sheet.portrait?.kind === "asset") return { kind: "asset", asset: sheet.portrait.asset, position: "center 30%", ...frame };
  const ancestry = sheet.ancestry.kind === "single" ? sheet.ancestry.id : sheet.ancestry.kind === "mixed" ? sheet.ancestry.first : sheet.ancestry.form;
  const art = PORTRAITS[`sub-${sheet.subclassId}`] ?? PORTRAITS[`anc-${ancestry}`];
  return art ? { kind: "asset", asset: art.asset, position: art.position, ...frame } : null;
}
