import { v, type Infer } from "convex/values";

/**
 * Validators and caps of the Sessions board (D10, plan `.omc/plans/d10-sessions.yaml`). S0 defines every stored
 * shape once here; the tables (convex/tables/sessions.ts) and the later tracers' `args` / `returns` reuse these.
 * Typed fields only: no blob, no `schemaVersion` (rule 7 applies only to untyped JSON). Widen only.
 */

// ---------------------------------------------------------------- caps (checked with an index `.take`)

/** Sessions per campaign (`by_campaign_n` `.take(MAX_SESSIONS)`). */
export const MAX_SESSIONS = 300;
/** Planned scenes per session (`sessionPrep.scenes`, an array, so the cap keeps the prep row small). */
export const MAX_SCENES = 20;
/** Log entries per session (`by_session_at` `.take(MAX_LOG_ENTRIES)`). */
export const MAX_LOG_ENTRIES = 500;

/** Text caps in characters (after trimming). The UI sets the same `maxLength`. */
export const SESSION_TEXT_MAX = {
  title: 120,
  scene: 300,
  log: 300,
  hooks: 4000,
  recap: 6000,
  loot: 2000,
  threads: 4000,
} as const;
export type SessionTextField = keyof typeof SESSION_TEXT_MAX;

// ---------------------------------------------------------------- values

/** B1: Planned / Live / Played. At most one `live` session per campaign (B6). */
export const SESSION_STATUSES = ["planned", "live", "played"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const sessionStatusValidator = v.union(...SESSION_STATUSES.map((s) => v.literal(s)));

/** B3: a planned scene's type (board labels Combat / Social / Exploration / Downtime). */
export const SESSION_SCENE_TYPES = ["combat", "social", "exploration", "downtime"] as const;
export type SessionSceneType = (typeof SESSION_SCENE_TYPES)[number];
export const sessionSceneTypeValidator = v.union(...SESSION_SCENE_TYPES.map((s) => v.literal(s)));

/** One planned scene (B3). `id` is a server-made UUID, so edits name the scene, never its index. */
export const sessionSceneValidator = v.object({
  id: v.string(),
  type: sessionSceneTypeValidator,
  text: v.string(),
});
export type SessionScene = Infer<typeof sessionSceneValidator>;

/**
 * Q3: the session tally, counted from the Fear history and the finished rests of the session's finished live
 * windows (S3 adds each window at end). The open window is added on read (S5), never stored.
 */
export const sessionTallyValidator = v.object({
  fearGained: v.number(),
  fearSpent: v.number(),
  shortRests: v.number(),
  longRests: v.number(),
});
export type SessionTally = Infer<typeof sessionTallyValidator>;

/** A calendar date without a time, 'YYYY-MM-DD' (B1). Checked by `assertSessionDate` (convex/lib/sessions.ts). */
export const sessionDateValidator = v.string();

// ---------------------------------------------------------------- tables

/**
 * `sessions`: one row per session, only the fields a player may read (Q4: number, title, date, status, recap and
 * the times). Planned sessions are still GM-only; the query filters them out for players.
 */
export const sessionFields = {
  campaignId: v.id("campaigns"),
  /** Highest + 1 on create; gaps after a delete are kept (B1). */
  n: v.number(),
  title: v.optional(v.string()),
  date: v.optional(sessionDateValidator),
  status: sessionStatusValidator,
  /** The latest start (B7: a played session can start again). */
  startedAt: v.optional(v.number()),
  /** The latest end. */
  endedAt: v.optional(v.number()),
  /** Wrap-up recap: the dashboard's Last Session (B5, B9). */
  recap: v.optional(v.string()),
  /** When the GM called 'Milestone reached: the party levels up' (Q5, one way). */
  milestoneAt: v.optional(v.number()),
  /** Counts of the finished live windows (Q3); absent until the first end. */
  tally: v.optional(sessionTallyValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/**
 * `sessionPrep`: one row per session, GM-only (K10, Q4). Kept apart from `sessions` so the GM's typing never re-runs
 * the players' and the dashboard's queries (CD10). Created lazily by the first prep write.
 */
export const sessionPrepFields = {
  campaignId: v.id("campaigns"),
  sessionId: v.id("sessions"),
  /** At most MAX_SCENES (B3). */
  scenes: v.array(sessionSceneValidator),
  /** 'Hooks & loose threads' (B3). */
  hooks: v.optional(v.string()),
  /** Wrap-up 'Loot & gold' (B5); GM-only (Q4). */
  loot: v.optional(v.string()),
  /** Wrap-up 'Countdowns & threads' (B5); GM-only (Q4). */
  threads: v.optional(v.string()),
  /**
   * Q1: the session's one D8 encounter. The encounter row is untouched (D8 stays its only writer); a deleted
   * encounter leaves this id dangling, so readers treat a missing encounter as none.
   */
  encounterId: v.optional(v.id("encounters")),
  updatedAt: v.number(),
};

/** `sessionLog`: one row per log line (growing, CD8), at most MAX_LOG_ENTRIES per session (B4, B10). */
export const sessionLogFields = {
  campaignId: v.id("campaigns"),
  sessionId: v.id("sessions"),
  at: v.number(),
  text: v.string(),
  by: v.id("users"),
  /** A start / end stamp written by S3 ('Session started.', B10), not typed by the GM. */
  auto: v.boolean(),
};

/** `sessionSpotlights`: one row per (session, character), so a tap writes one small document (B4). */
export const sessionSpotlightFields = {
  campaignId: v.id("campaigns"),
  sessionId: v.id("sessions"),
  characterId: v.id("characters"),
  count: v.number(),
};
