import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

/**
 * Retention jobs (CD17), daily (photo-import expiry hourly) at odd minutes so
 * they never land on the top of the hour. Each one reschedules itself until its backlog is gone.
 */
const crons = cronJobs();

crons.cron("expire operations", "17 3 * * *", internal.cleanup.expireOperations, {});
// Campaign purge is deliberately not scheduled (user decision 2026-10-18): a
// deleted campaign stays restorable until a GM chooses "Delete permanently",
// which will reuse internal.cleanup.purgeCampaign. Enabling the timer is this line:
// crons.cron("purge deleted campaigns", "37 3 * * *", internal.cleanup.purgeDeletedCampaigns, {});
crons.cron("sweep orphan uploads", "53 3 * * *", internal.cleanup.sweepOrphanUploads, {});
// Abandoned photo-import photos (D5 R3, review M4): hourly, so none outlives
// its one-hour TTL by more than another hour.
crons.cron("expire photo imports", "41 * * * *", internal.cleanup.expirePhotoImports, {});

export default crons;
