import { ConvexError } from "convex/values";

/** Errors of photo import (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const photoImportMessages = {
  PHOTO_IMPORT_RULE: "That photo import isn't allowed.",
  PHOTO_IMPORT_UNAVAILABLE: "Photo import isn't set up on this server.",
  PHOTO_IMPORT_FILE: "Photos must be JPEG, PNG or WebP images of at most 3.5 MB.",
  PHOTO_IMPORT_TOO_MANY: "Upload at most 4 photos per import.",
  // PHOTO_IMPORT_FAILED is gone (PS2): a reply that arrives always opens the review form.
  /**
   * PS2 (dcm-ccnm): the Messages API couldn't be reached or refused the call. The payload also carries `reason` (an
   * `UnreachableReason`) and the full `message` from `unreachableMessage`; the photos are kept so Try again can read
   * them again. A reply that arrives is never an error any more: it is salvaged into the review form.
   */
  PHOTO_IMPORT_UNREACHABLE: "Importer can't be reached.",
} as const satisfies Record<string, string>;

/** Why the importer couldn't reach Claude (PS2). Tests assert these keys, never the texts. */
export const UNREACHABLE_REASONS = ["overloaded", "timeout", "credits", "key", "rateLimited", "network", "other"] as const;
export type UnreachableReason = (typeof UNREACHABLE_REASONS)[number];

/** The reason as the GM reads it, after "Importer can't be reached: " (user 2026-11-13). */
export const unreachableReasonText: Record<UnreachableReason, string> = {
  overloaded: "the API is overloaded",
  timeout: "the request timed out",
  credits: "the API credits are used up",
  key: "the API key was refused",
  rateLimited: "rate limited (too many requests)",
  network: "network error",
  other: "the API refused the request (a problem on our side)",
};

/** "Importer can't be reached: <reason>." */
export function unreachableMessage(reason: UnreachableReason): string {
  return `Importer can't be reached: ${unreachableReasonText[reason]}.`;
}

/** The payload of a PHOTO_IMPORT_UNREACHABLE `ConvexError`: the `AppError` shape plus `reason`. */
export type PhotoImportUnreachable = { code: "PHOTO_IMPORT_UNREACHABLE"; message: string; reason: UnreachableReason };

/** The reason of a PHOTO_IMPORT_UNREACHABLE error (the photos were kept: offer Try again), else null. */
export function unreachableReasonOf(error: unknown): UnreachableReason | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return null;
  const { code, reason } = data as { code?: unknown; reason?: unknown };
  if (code !== "PHOTO_IMPORT_UNREACHABLE") return null;
  return (UNREACHABLE_REASONS as readonly unknown[]).includes(reason) ? (reason as UnreachableReason) : "other";
}
