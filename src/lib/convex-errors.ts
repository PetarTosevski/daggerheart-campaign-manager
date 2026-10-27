import { ConvexError } from "convex/values";

import { actionLogMessages } from "./errors/actionLog";
import { adversaryActionMessages } from "./errors/adversaryActions";
import { authMessages } from "./errors/auth";
import { campaignMessages } from "./errors/campaigns";
import { characterMessages } from "./errors/characters";
import { classFeatureMessages } from "./errors/classFeatures";
import { codexMessages } from "./errors/codex";
import { combatActionMessages } from "./errors/combatActions";
import { combatFeatureMessages } from "./errors/combatFeatures";
import { combatMapMessages } from "./errors/combatMap";
import { commonMessages } from "./errors/common";
import { deathMessages } from "./errors/death";
import { diceMessages } from "./errors/dice";
import { encounterMessages } from "./errors/encounters";
import { levelUpMessages } from "./errors/levelUp";
import { lorekeeperMessages } from "./errors/lorekeeper";
import { mapMessages } from "./errors/maps";
import { noteMessages } from "./errors/notes";
import { operationMessages } from "./errors/operations";
import { photoImportMessages } from "./errors/photoImport";
import { restMessages } from "./errors/rests";
import { sessionMessages } from "./errors/sessions";
import { spritePackMessages } from "./errors/spritePacks";
import { trackerMessages } from "./errors/trackers";
import { witherMessages } from "./errors/wither";

/** Combines each domain's messages (`src/lib/errors/<domain>.ts`); a code defined twice is a bug. */
export function mergeMessages(...domains: Record<string, string>[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const messages of domains) {
    for (const [code, message] of Object.entries(messages)) {
      if (code in merged) throw new Error(`Error code ${code} is defined by two domains.`);
      merged[code] = message;
    }
  }
  return merged;
}

const MESSAGES = mergeMessages(
  commonMessages,
  authMessages,
  campaignMessages,
  operationMessages,
  trackerMessages,
  characterMessages,
  mapMessages,
  codexMessages,
  actionLogMessages,
  diceMessages,
  levelUpMessages,
  restMessages,
  deathMessages,
  witherMessages,
  classFeatureMessages,
  photoImportMessages,
  encounterMessages,
  combatMapMessages,
  combatActionMessages,
  combatFeatureMessages,
  adversaryActionMessages,
  sessionMessages,
  spritePackMessages,
  noteMessages,
  lorekeeperMessages,
);

/**
 * A message for the GM from an error thrown by a Convex function. Every
 * server error is `ConvexError<AppError>` (`{ code, message? }`, CF13): the
 * message when present, else the code's text.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "object" && data !== null) {
      const { message, code } = data as { message?: unknown; code?: unknown };
      if (typeof message === "string" && message) return message;
      if (typeof code === "string") return MESSAGES[code] ?? "Something went wrong.";
    }
  }
  return "Something went wrong. Check your connection and try again.";
}
