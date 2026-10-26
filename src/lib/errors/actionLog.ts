/**
 * Errors of the action log and undo (D5 T0), and of characters who can't act.
 *
 * Contract for every D5 error module: one `as const` object per domain, code →
 * default message. `AppErrorCode` (app-error.ts) includes `keyof` each module
 * and `src/lib/convex-errors.ts` merges them, so a tracer adds a code to its
 * own module only and never edits those two files.
 *
 * ```ts
 * throw appError("UNDO_STALE");                       // in a Convex handler
 * throw new RuleError("UNDO_STALE", "Undo the newer roll first."); // domain code, converted by the wrappers
 * // tests: expect(errorCode(e)).toBe("UNDO_STALE") — never the message text
 * ```
 */
export const actionLogMessages = {
  UNDO_STALE: "That can't be undone any more: something newer happened since.",
  CHARACTER_UNAVAILABLE: "This character can't act right now (dead, away or unconscious).",
} as const satisfies Record<string, string>;
