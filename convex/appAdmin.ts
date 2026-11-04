import { v } from "convex/values";

import { readAppConfig } from "./lib/appConfig";
import { isAppOwner } from "./lib/appOwner";
import { appOwnerQuery, maybeUserQuery } from "./lib/functions";
import { appSettingsValidator } from "./lib/validators/admin";

/**
 * App admin, the owner's page (config AD0). Everything here but `me` is owner-only (`appOwner*` wrappers, FORBIDDEN
 * for anyone else). The client's owner check (`me`) is UX only (CF22): the functions are the gate.
 */

/**
 * Whether the caller is the app owner: decides only whether the client shows the App admin link and page. Answers
 * for the caller alone (never who the owner is or whether one is set); null when signed out.
 */
export const me = maybeUserQuery({
  args: {},
  returns: v.union(v.null(), v.object({ isOwner: v.boolean() })),
  handler: async (ctx) => (ctx.user === null ? null : { isOwner: await isAppOwner(ctx, ctx.user) }),
});

/**
 * The app's effective settings (saved values over the defaults and today's env-var numbers), for the admin pages.
 * Settings only: never a key, a secret, the owner id or any env value other than the Lorekeeper numbers.
 */
export const settings = appOwnerQuery({
  args: {},
  returns: appSettingsValidator,
  handler: async (ctx) => readAppConfig(ctx),
});
