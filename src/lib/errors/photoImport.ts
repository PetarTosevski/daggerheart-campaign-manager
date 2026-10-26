/** Errors of photo import (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const photoImportMessages = {
  PHOTO_IMPORT_RULE: "That photo import isn't allowed.",
  PHOTO_IMPORT_UNAVAILABLE: "Photo import isn't set up on this server.",
  PHOTO_IMPORT_FILE: "Photos must be JPEG, PNG or WebP images of at most 3.5 MB.",
  PHOTO_IMPORT_TOO_MANY: "Upload at most 4 photos per import.",
  PHOTO_IMPORT_FAILED: "Claude couldn't read the photos. Try again, or create the character by hand.",
} as const satisfies Record<string, string>;
