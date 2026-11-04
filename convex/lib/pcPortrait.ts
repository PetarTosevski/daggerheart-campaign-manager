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

/** A token's portrait: an uploaded image or rulebook art (url), the chosen or default design art (an asset id), or none (initials). */
export const tokenPortraitValidator = v.union(
  v.null(),
  v.object({ kind: v.literal("url"), url: v.string() }),
  v.object({ kind: v.literal("asset"), asset: v.string(), position: v.string() }),
);
export type TokenPortrait = Infer<typeof tokenPortraitValidator>;

/** A PC's portrait (CharacterPortrait's order: upload, chosen art, default art by subclass then ancestry). */
export async function pcPortrait(ctx: QueryCtx, characterId: Id<"characters">, sheet: ReturnType<typeof readSheet>): Promise<TokenPortrait> {
  if (sheet.portrait?.kind === "upload") {
    const url = await ownFileUrl(ctx, "portrait", characterId, sheet.portrait.storageId);
    return url === null ? null : { kind: "url", url };
  }
  if (sheet.portrait?.kind === "asset") return { kind: "asset", asset: sheet.portrait.asset, position: "center 30%" };
  const ancestry = sheet.ancestry.kind === "single" ? sheet.ancestry.id : sheet.ancestry.kind === "mixed" ? sheet.ancestry.first : sheet.ancestry.form;
  const art = PORTRAITS[`sub-${sheet.subclassId}`] ?? PORTRAITS[`anc-${ancestry}`];
  return art ? { kind: "asset", asset: art.asset, position: art.position } : null;
}
