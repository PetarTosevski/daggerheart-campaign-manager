import { errorMessage } from "@/lib/convex-errors";
import { lorekeeperMessages } from "@/lib/errors/lorekeeper";
import { CAP_CAMPAIGN_TEXT, CAP_DEPLOYMENT_TEXT, CAP_USER_TEXT, NOT_SET_UP, RATE_LIMITED_TEXT } from "@/lib/lorekeeper/copy";

import { LOREKEEPER_LIMITS } from "../../../../convex/lib/validators/lorekeeper";
import { errorCode } from "../answer/model";

/** Pure helpers of the composer (D13 L6). Unit-tested in tests/unit/lorekeeper-ui. */

export const QUESTION_MAX = LOREKEEPER_LIMITS.question;
/** The character count shows from here on ('<n> / 1,000'), near the end of the limit. */
export const COUNTER_FROM = 900;

/** `lorekeeperUsage.mine`'s answer. */
export type Usage = { questionsLeft: number; campaignCapReached: boolean; deploymentCapReached: boolean };

/** The current UTC day and month `lorekeeperUsage.mine` takes (CF10: coarse, so the query stays cached). */
export function usagePeriod(now: Date): { day: string; month: string } {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

/** Why the composer is disabled, or null: not set up, then the caps (L5 order: user, campaign, server). */
export function disabledReason(available: boolean | undefined, usage: Usage | undefined): string | null {
  if (available === false) return NOT_SET_UP;
  if (usage === undefined) return null;
  if (usage.questionsLeft <= 0) return CAP_USER_TEXT;
  if (usage.campaignCapReached) return CAP_CAMPAIGN_TEXT;
  if (usage.deploymentCapReached) return CAP_DEPLOYMENT_TEXT;
  return null;
}

/** '<n> / 1,000' near the end of the limit, else null. */
export function counterText(length: number): string | null {
  return length >= COUNTER_FROM ? `${length.toLocaleString("en-US")} / ${QUESTION_MAX.toLocaleString("en-US")}` : null;
}

/** What the composer says when `ask` fails; `newConversation` offers 'Start a new conversation' (L3 note). */
export function askFailure(error: unknown): { text: string; newConversation: boolean } {
  switch (errorCode(error)) {
    case "RATE_LIMITED":
      return { text: RATE_LIMITED_TEXT, newConversation: false };
    case "LOREKEEPER_CAP_USER":
      return { text: CAP_USER_TEXT, newConversation: false };
    case "LOREKEEPER_CAP_CAMPAIGN":
      return { text: CAP_CAMPAIGN_TEXT, newConversation: false };
    case "LOREKEEPER_CAP_DEPLOYMENT":
      return { text: CAP_DEPLOYMENT_TEXT, newConversation: false };
    case "LOREKEEPER_UNAVAILABLE":
      return { text: NOT_SET_UP, newConversation: false };
    case "LOREKEEPER_CONVERSATION_FULL":
      return { text: lorekeeperMessages.LOREKEEPER_CONVERSATION_FULL, newConversation: true };
    default:
      return { text: errorMessage(error), newConversation: false };
  }
}

/** Enter sends; Shift+Enter (and Enter while an IME composes) types a new line. */
export function sendsOnKey(event: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
