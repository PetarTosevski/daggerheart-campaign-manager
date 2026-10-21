import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: core (campaigns, members, settings, users, fear, wither, feed, history, actionLog, campaignTime) and the
 * EXEMPT list. Filled by tracer H5 (.omc/plans/d12-hardening.yaml). H0 moved three worked entries out of `pending`, one
 * per common shape, so the runner is exercised from the start; `characters:get` stays here (H7 may move it to
 * characters.entries.ts).
 */
const area: Area = {
  area: "core",
  entries: [
    // GM only, keyed: every default applies, the synthesizer fills campaignId, direction ("increase") and idempotencyKey.
    { fn: api.fear.adjust, access: "gm" },
    // Any signed-in user, acting on their own rows.
    { fn: api.campaigns.list, access: "user" },
    // A character read: strangers get null instead of NOT_FOUND (no existence leak); party members may view.
    { fn: api.characters.get, access: "own", expect: { outsider: "null" } },
  ],
  pending: [
    "actionLog:undo",
    "campaigns:create",
    "campaigns:get",
    "campaigns:markOpened",
    "campaigns:remove",
    "campaigns:restore",
    "campaigns:setOption",
    "campaigns:updateTome",
    "campaignTime:advance",
    "campaignTime:get",
    "campaignTime:setDay",
    "fear:set",
    "feed:clear",
    "feed:list",
    "feed:remove",
    "history:list",
    "members:access",
    "members:invite",
    "members:joinByCode",
    "members:leave",
    "members:removePlayer",
    "members:revokeInvite",
    "members:roster",
    "members:rotateJoinCode",
    "settings:get",
    "settings:update",
    "users:viewer",
    "wither:adjust",
    "wither:gain",
  ],
  exempt: {
    "auth:signIn": "Convex Auth's sign-in action: public by design; covered by tests/e2e/auth.spec.ts and create-or-update-user.test.ts",
    "auth:signOut": "Convex Auth's sign-out action: public by design and acts only on the caller's own session; covered by tests/e2e/auth.spec.ts",
    "auth:isAuthenticated": "Convex Auth's session probe: public by design, returns only whether the caller is signed in",
  },
};

export default area;
