import { errorMessage } from "../../../../../src/lib/convex-errors";
import { lorekeeperMessages } from "../../../../../src/lib/errors/lorekeeper";
import {
  CAP_CAMPAIGN_TEXT,
  CAP_DEPLOYMENT_TEXT,
  CAP_USER_TEXT,
  NOT_SET_UP,
  RATE_LIMITED_TEXT,
} from "../../../../../src/lib/lorekeeper/copy";
import { LOREKEEPER_LIMITS } from "../../../../../convex/lib/validators/lorekeeper";

import { errorCode } from "./answer-model";

export const QUESTION_MAX = LOREKEEPER_LIMITS.question;
export const COUNTER_FROM = 900;

export type Usage = { questionsLeft: number; campaignCapReached: boolean; deploymentCapReached: boolean };

export function usagePeriod(now: Date): { day: string; month: string } {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

export function disabledReason(available: boolean | undefined, usage: Usage | undefined): string | null {
  if (available === false) return NOT_SET_UP;
  if (usage === undefined) return null;
  if (usage.questionsLeft <= 0) return CAP_USER_TEXT;
  if (usage.campaignCapReached) return CAP_CAMPAIGN_TEXT;
  if (usage.deploymentCapReached) return CAP_DEPLOYMENT_TEXT;
  return null;
}

export function counterText(length: number): string | null {
  return length >= COUNTER_FROM ? `${length.toLocaleString("en-US")} / ${QUESTION_MAX.toLocaleString("en-US")}` : null;
}

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
