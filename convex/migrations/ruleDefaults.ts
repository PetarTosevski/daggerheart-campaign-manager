import type { FrameId } from "../../src/lib/frames";
import { migrations } from "../lib/migrations";

/**
 * RD1 (rule-switches plan, epic dcm-jh6d, bead dcm-bxp.134): pins today's value of the four optional frame rules on
 * every existing campaign before RD2 makes new campaigns start with them off (user answer Q1 (a), 2026-11-05: running
 * campaigns keep what they have today; only new campaigns start off). No field changes shape; only the default
 * changes, and that waits until this has run (CD4 widen -> migrate -> narrow). Run once per deployment, before the
 * deploy that ships RD2 (see `run.ts`). Idempotent, so `reset: true` is safe.
 *   npx convex run migrations/run:run '{fn: "migrations/ruleDefaults:pinFrameOptions", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/ruleDefaults:pinFrameOptions"}'
 */

/**
 * Each pinned option, the one frame that offers it (`src/lib/frames/options.ts`) and its effective default there
 * before RD2: `defaultFor(frame)` returned true in the offering frame for all four. Fixed here, not read from
 * `CAMPAIGN_OPTIONS`, so the migration keeps pinning today's value after RD2 changes those defaults.
 */
export const PINNED_FRAME_OPTIONS: readonly { option: string; frameId: FrameId; value: boolean }[] = [
  { option: "lessLethal", frameId: "castle-high", value: true },
  { option: "transformations", frameId: "dark-heart-of-andaluria", value: true },
  { option: "enduranceCountdowns", frameId: "journey-to-horizon", value: true },
  { option: "remnantCorruption", frameId: "motherboard", value: true },
];

/**
 * For every campaign (deleted and archived ones too, so a restored campaign behaves as before) whose frame offers one
 * of the four options and whose `options` lacks that key, writes the key with today's default. Keys the GM already set
 * and every other option stay as they are; a campaign with nothing to pin is not written.
 */
export const pinFrameOptions = migrations.define({
  table: "campaigns",
  migrateOne: (_ctx, row) => {
    const missing = PINNED_FRAME_OPTIONS.filter((p) => p.frameId === row.frameId && row.options?.[p.option] === undefined);
    if (missing.length === 0) return;
    return { options: { ...(row.options ?? {}), ...Object.fromEntries(missing.map((p) => [p.option, p.value])) } };
  },
});
