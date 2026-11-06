import { v } from "convex/values";

import { maybeUserQuery, readAppStatus } from "./lib/functions";

/**
 * Read-only mode's banner (config AD10, Q31 a; docs/tasks/TASK-CONFIG-AD10.md). Everyone reads it, signed out
 * included: the banner shows on every page while the owner has the app in read-only mode. The owner turns it on and
 * off with `adminMaintenance.setReadOnly`; the write guard itself lives in the wrappers (`convex/lib/functions.ts`).
 */

/** `{ readOnly: true, message }` while read-only mode is on (message: the owner's banner text, or null); null when off. */
export const get = maybeUserQuery({
  args: {},
  returns: v.union(v.null(), v.object({ readOnly: v.literal(true), message: v.union(v.string(), v.null()) })),
  handler: async (ctx) => {
    const status = await readAppStatus(ctx);
    return status.readOnly ? { readOnly: true as const, message: status.message } : null;
  },
});
