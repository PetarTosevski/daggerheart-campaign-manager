import { defineTable } from "convex/server";
import { v } from "convex/values";

export const e2eTables = {
  /**
   * The last sign-up or reset code "sent" to an email on the local e2e backend (no email is sent there). Written only
   * when `fakeCodeMode`; read only through `GET /e2e/code` behind the e2e rails (`convex/e2e.ts`). At most one row per
   * email (a new code replaces the old one), so the table is bounded by the emails the specs use and needs no cron.
   */
  e2eCodes: defineTable({
    email: v.string(),
    code: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),
};
