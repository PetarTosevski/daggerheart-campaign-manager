/**
 * Errors of the Combat Map sprite packs (plan `.omc/plans/sprite-packs.yaml`: style, setting, packs, uploads,
 * sprite and texture refs). Contract: see `actionLog.ts`; add this domain's codes here only. Every sprite-pack
 * tracer throws only these codes plus the common and combat-map ones; a code missing here means stop and ask the
 * orchestrator. Upload rejections are returned, not thrown (CF16), with the existing attach code "INVALID".
 */
export const spritePackMessages = {
  /** A pack id that is not one of this campaign's packs (deleted, or another campaign's). */
  SPRITE_PACK_NOT_FOUND: "That sprite pack isn't in this campaign anymore.",
  /** MAX_SPRITE_PACKS per campaign. */
  SPRITE_PACK_LIMIT: "This campaign already has 20 sprite packs. Delete one first.",
  /** An uploaded sprite id that is not in this campaign (deleted, or another campaign's). */
  SPRITE_NOT_FOUND: "That sprite isn't in this campaign anymore.",
  /** MAX_PACK_SPRITES per pack. */
  SPRITE_LIMIT: "This pack already has 64 sprites. Remove one first.",
  /** A built-in sprite key that is not in the built-in manifest. */
  SPRITE_UNKNOWN: "That sprite isn't in the built-in packs.",
  /** A built-in setting id that does not exist (or "common", which is not a setting). */
  SPRITE_SETTING_UNKNOWN: "That setting doesn't exist.",
  /** MAX_TEXTURE_PALETTE distinct painted textures per map. */
  SPRITE_PALETTE_FULL: "This map already uses 16 painted textures. Paint with one of those.",
} as const satisfies Record<string, string>;

export type SpritePackErrorCode = keyof typeof spritePackMessages;
