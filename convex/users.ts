import { v } from "convex/values";

import { maybeUserQuery } from "./lib/functions";

/** The signed-in user, for the app shell; null when signed out. */
export const viewer = maybeUserQuery({
  args: {},
  returns: v.union(v.object({ email: v.union(v.string(), v.null()), name: v.union(v.string(), v.null()) }), v.null()),
  handler: async (ctx) => (ctx.user === null ? null : { email: ctx.user.email ?? null, name: ctx.user.name ?? null }),
});
