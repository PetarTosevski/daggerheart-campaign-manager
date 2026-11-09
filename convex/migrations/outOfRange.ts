import { migrations } from "../lib/migrations";

/**
 * W3S0 (rule switches wave 3, epic dcm-jh6d part A, bead dcm-bxp.134; user answer Q12 a, 2026-11-09): M4 Out-of-range
 * targets moves from Campaign settings > At the table (`campaigns.tableSettings.outOfRange`, `ask` / `refuse`, unset =
 * `ask`) into House rules (`campaigns.ruleModes.outOfRange`, `book` = Ask the GM / `refuse` / `manual`, unset = `book`).
 * Widen -> migrate -> narrow (CD4): W3S0 widened `ruleModes`; this copies the table setting; tracer WF then switches
 * the readers to `ruleMode(campaign, "outOfRange")` and removes the table setting, after this has run.
 *
 * Until WF merges, the table setting is the only one a GM can change (the House rules row says "Coming soon"), so this
 * mirrors it: `ruleModes.outOfRange` ends as `refuse` when the table setting is `refuse`, otherwise Book. A row that
 * already matches is not written. Idempotent, so rerun it (`reset: true`) right before the deploy that ships WF, to
 * pick up any table setting changed since the first run.
 *   npx convex run migrations/run:run '{fn: "migrations/outOfRange:copyTableSetting", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/outOfRange:copyTableSetting"}'
 */
export const copyTableSetting = migrations.define({
  table: "campaigns",
  migrateOne: (_ctx, row) => {
    const wanted: "book" | "refuse" = row.tableSettings?.outOfRange === "refuse" ? "refuse" : "book";
    const current = row.ruleModes?.outOfRange ?? "book";
    if (current === wanted) return;
    return { ruleModes: { ...(row.ruleModes ?? {}), outOfRange: wanted } };
  },
});
