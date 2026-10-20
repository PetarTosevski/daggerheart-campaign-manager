import { ConvexError } from "convex/values";

import { actionLogMessages } from "./actionLog";
import { classFeatureMessages } from "./classFeatures";
import { combatMapMessages } from "./combatMap";
import { commonMessages } from "./common";
import { deathMessages } from "./death";
import { diceMessages } from "./dice";
import { encounterMessages } from "./encounters";
import { levelUpMessages } from "./levelUp";
import { photoImportMessages } from "./photoImport";
import { restMessages } from "./rests";
import { sessionMessages } from "./sessions";
import { witherMessages } from "./wither";

/**
 * Every error code a Convex function may throw, shared by server and client.
 * Common codes come from `common.ts`; the rest are each domain's codes, which
 * move into their own `as const` module as each domain is converted. A D5
 * module's new code joins this union by itself (`keyof typeof` its module).
 */
export type AppErrorCode =
  | keyof typeof commonMessages
  | keyof typeof actionLogMessages
  | keyof typeof diceMessages
  | keyof typeof levelUpMessages
  | keyof typeof restMessages
  | keyof typeof deathMessages
  | keyof typeof witherMessages
  | keyof typeof classFeatureMessages
  | keyof typeof photoImportMessages
  | keyof typeof encounterMessages
  | keyof typeof combatMapMessages
  | keyof typeof sessionMessages
  | "IDEMPOTENCY_MISMATCH"
  | "NAME_TAKEN"
  | "OBJECTIVE_LIMIT"
  | "ECHO_RANGE"
  | "FEAR_RANGE"
  | "COUNTDOWN_RULE"
  | "DOOM_RULE"
  | "EXTRA_RULE"
  | "TIME_RULE"
  | "TRACKER_RULE"
  | "WEEK_RULE"
  | "CHARACTER_CORRUPT"
  | "CODEX_CORRUPT"
  | "MAP_CORRUPT"
  | "TRACKER_CORRUPT";

/** The one payload shape of every `ConvexError` (CF13). The client shows `message` when present. */
export type AppError = { code: AppErrorCode; message?: string };

/**
 * An expected rule violation (Fear out of range, a countdown already done).
 * The Convex wrappers turn it into `ConvexError<AppError>`; any other `Error`
 * is a bug and is rethrown unchanged (CF14).
 */
export class RuleError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuleError";
  }
}

/**
 * A `ConvexError<AppError>` to throw. Without a `message`, a common code
 * carries its standard text, so the client can show it as is.
 */
export function appError(code: AppErrorCode, message?: string): ConvexError<AppError> {
  const text = message ?? (commonMessages as Partial<Record<AppErrorCode, string>>)[code];
  return new ConvexError<AppError>(text === undefined ? { code } : { code, message: text });
}
