import { ConvexError } from "convex/values";

import { characterMessages } from "./errors/characters";
import { codexMessages } from "./errors/codex";
import { commonMessages } from "./errors/common";
import { mapMessages } from "./errors/maps";
import { operationMessages } from "./errors/operations";
import { trackerMessages } from "./errors/trackers";

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
  operationMessages,
  trackerMessages,
  characterMessages,
  mapMessages,
  codexMessages,
);

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
