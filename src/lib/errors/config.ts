/**
 * Errors of Part A of the config plan (campaign settings, preferences, co-GM; `.omc/plans/config.yaml`). Contract: see
 * `actionLog.ts`; add this domain's codes here only. Tests and the UI key on the code, never the text.
 */
export const configMessages = {
  /** A write to an archived campaign (Q9 a: archived = read-only for everyone until the creator restores it). */
  CAMPAIGN_ARCHIVED: "This campaign is archived. Its creator can restore it to make changes.",
  /** Promoting someone to co-GM who is not a member of the campaign (Q8 b: an invite becomes co-GM on acceptance). */
  CO_GM_NOT_MEMBER: "Only a player in this campaign can be made a co-GM.",
  /** Something only the campaign's creator may do (Q7 a: co-GMs, archive). */
  CO_GM_CREATOR_ONLY: "Only the GM who created this campaign can do that.",
  /** A settings change with an unknown key or a value that doesn't fit it. */
  SETTING_INVALID: "That setting can't take that value.",
  /** A player asking the Lorekeeper while the GM keeps it to GMs (`tableSettings.lorekeeperAsk: "gm"`). */
  LOREKEEPER_GM_ONLY: "Only the GM can ask the Lorekeeper in this campaign.",
  /** A player's out-of-range action while the GM refuses them (`tableSettings.outOfRange: "refuse"`, Q2 a). */
  COMBAT_TARGET_OUT_OF_RANGE: "That target is out of range.",
} as const satisfies Record<string, string>;

export type ConfigErrorCode = keyof typeof configMessages;
