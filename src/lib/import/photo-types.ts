// Photo-import limits, zod-free (dcm-uh6r: convex/lib/files.ts checks upload types in every function bundle that
// touches files; importing them from ./draft built the draft and sheet schemas at load). ./draft re-exports them.

/** At most this many photos per import (the front and back of a sheet, twice over). */
export const MAX_PHOTOS = 4;
/** Photo types the Messages API reads; GIF is left out on purpose. */
export const PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
