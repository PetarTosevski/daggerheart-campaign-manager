/**
 * A campaign's table settings (plan config S0; the Campaign settings slide-over, reference/designs/config/Settings.dc.html).
 * Stored as `campaigns.tableSettings`, a typed object of optional fields (convex/lib/validators/campaigns.ts): an unset
 * field uses the default below. This table is the one source of the defaults for the server and the UI.
 *
 * No clock field: the user kept the day and night clock manual (config Q4 d).
 */

export const OUT_OF_RANGE_CHOICES = ["ask", "refuse"] as const;
export const LOREKEEPER_ASK_CHOICES = ["everyone", "gm"] as const;
export const FEAR_AT_START_CHOICES = ["carry", "pcs"] as const;
export const SESSION_OPENS_ON_CHOICES = ["journal", "combatMap"] as const;

export type OutOfRange = (typeof OUT_OF_RANGE_CHOICES)[number];
export type LorekeeperAsk = (typeof LOREKEEPER_ASK_CHOICES)[number];
export type FearAtStart = (typeof FEAR_AT_START_CHOICES)[number];
export type SessionOpensOn = (typeof SESSION_OPENS_ON_CHOICES)[number];

/** Every table setting, resolved. */
export type TableSettings = {
  /** At the table: players see the GM's Fear pool (Q3: off = every pool number shows "?"). */
  playersSeeFear: boolean;
  /** At the table: a player's out-of-range action asks the GM (today's pending request) or is refused (Q2 a). */
  outOfRange: OutOfRange;
  /** At the table: players see the Journal's spotlight balance (Q5 a). */
  spotlightToPlayers: boolean;
  /** Lorekeeper: may search the internet when the books don't say (the campaign's gate on `webSearch`). */
  lorekeeperWeb: boolean;
  /** Lorekeeper: who may ask. */
  lorekeeperAsk: LorekeeperAsk;
  /** Sessions: GM Fear at session start: carry over, or one per PC (CB p.154). */
  fearAtStart: FearAtStart;
  /** Sessions: where a new session opens. */
  sessionOpensOn: SessionOpensOn;
  /** Sessions: write the session log from the Combat Map. */
  autoSessionLog: boolean;
};

/** What a campaign stores: any field may be unset. */
export type StoredTableSettings = Partial<TableSettings>;

export type TableSettingKey = keyof TableSettings;

/** The defaults: each one is today's behaviour where the setting already exists in practice. */
export const TABLE_SETTING_DEFAULTS: Readonly<TableSettings> = Object.freeze({
  playersSeeFear: true,
  outOfRange: "ask",
  spotlightToPlayers: false,
  lorekeeperWeb: true,
  lorekeeperAsk: "everyone",
  fearAtStart: "carry",
  sessionOpensOn: "journal",
  autoSessionLog: true,
});

export const TABLE_SETTING_KEYS = Object.keys(TABLE_SETTING_DEFAULTS) as TableSettingKey[];

/** The campaign's settings: each stored field, or its default when unset. */
export function resolveTableSettings(stored: StoredTableSettings | null | undefined): TableSettings {
  const resolved = { ...TABLE_SETTING_DEFAULTS } as Record<TableSettingKey, TableSettings[TableSettingKey]>;
  if (stored) {
    for (const key of TABLE_SETTING_KEYS) {
      const value = stored[key];
      if (value !== undefined) resolved[key] = value;
    }
  }
  return resolved as TableSettings;
}

/**
 * Where a freshly started session takes the GM (config JO1): `null` = stay on the Journal and open the session there
 * (the page is already the Journal), else the Combat Map's path. Players never start a session, so they never move.
 */
export function sessionOpensOnHref(campaignId: string, opensOn: SessionOpensOn): string | null {
  return opensOn === "combatMap" ? `/campaigns/${campaignId}/combat-map` : null;
}
