/** Errors of photo import (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const photoImportMessages = {
  PHOTO_IMPORT_RULE: "That photo import isn't allowed.",
  PHOTO_IMPORT_UNAVAILABLE: "Photo import isn't set up on this server.",
} as const satisfies Record<string, string>;
