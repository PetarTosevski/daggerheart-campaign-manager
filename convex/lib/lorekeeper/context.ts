import { getPublishedFrame } from "../../../src/lib/frames/index";
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

/**
 * The campaign context a question may use (Q4, analysis 5.4): the frame, the asker's own characters, the party's
 * classes, the table rulings and (when the GM switched the house-rules book on, Q7) GM pages shared with everyone.
 * Never GM-only data, for anyone. L0 stub with the final signature: L4 replaces the body (and only the body).
 */

export type ContextFrame = { id: string; name: string };

/** One of the asker's characters (permissionFor >= edit). */
export type ContextCharacter = {
  name: string;
  className: string;
  subclass: string;
  level: number;
  /** Ancestry and community names. */
  heritage: string[];
  domainCards: string[];
  features: string[];
};

/** A party member's class line, visible to every member on the Party page. */
export type ContextPartyMember = { className: string; subclass: string };

export type ContextRuling = { title: string; text: string };

/** A GM journal page with visibility 'everyone' (Q7), read as the asker. */
export type ContextHouseRule = { title: string; text: string };

export type LorekeeperContext = {
  frame: ContextFrame;
  characters: ContextCharacter[];
  party: ContextPartyMember[];
  rulings: ContextRuling[];
  houseRules: ContextHouseRule[];
};

/** The context of `user`'s question in `campaign`, with only what `user` may see. */
export type BuildContext = (ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">) => Promise<LorekeeperContext>;

/** The campaign's frame id and name. */
export function contextFrame(campaign: Doc<"campaigns">): ContextFrame {
  return { id: campaign.frameId, name: getPublishedFrame(campaign.frameId)?.name ?? "Custom frame" };
}

/** Stub: the frame only. */
export const buildContext: BuildContext = async (_ctx, _user, campaign) => ({
  frame: contextFrame(campaign),
  characters: [],
  party: [],
  rulings: [],
  houseRules: [],
});
