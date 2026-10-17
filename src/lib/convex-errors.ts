import { ConvexError } from "convex/values";

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  FORBIDDEN: "This account can't use the campaign ledger.",
  NOT_FOUND: "That campaign no longer exists.",
  TRACKER_CORRUPT: "This tracker's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  CHARACTER_CORRUPT: "This character's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  MAP_CORRUPT: "This campaign's map data is damaged. Nothing was changed; ask the developer to repair it.",
  CODEX_CORRUPT: "This entry's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  MECHANIC_DISABLED: "That rule isn't part of this campaign's frame.",
  IDEMPOTENCY_MISMATCH: "That request clashed with an earlier one. Try again.",
};

/** A message for the GM from an error thrown by a Convex function. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string") return MESSAGES[data] ?? "Something went wrong.";
    if (typeof data === "object" && data !== null && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  }
  return "Something went wrong. Check your connection and try again.";
}
