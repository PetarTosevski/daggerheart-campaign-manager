import { api } from "../../../convex/_generated/api";
import type { Area, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: core (campaigns, members, settings, users, fear, wither, feed, history, actionLog, campaignTime) and the
 * EXEMPT list. Tracer H5 (.omc/plans/d12-hardening.yaml), docs/tasks/TASK-D12-H5.md. The world is the default
 * witherwild campaign, which has campaign time and Wither tokens. `characters:get` stays here (a worked H0 entry).
 */

/** One undoable, public actionLog row on characterA, written by the GM (a Wither token correction). */
async function gmLogRow(w: World) {
  await w.as("gm").mutation(api.wither.adjust, { campaignId: w.campaignId, characterId: w.characterA, delta: 1, idempotencyKey: freshKey() });
}

/** A pending email invite to the campaign; registers `inviteId`. */
async function pendingInvite(w: World) {
  const inviteId = await w.as("gm").mutation(api.members.invite, { campaignId: w.campaignId, email: "invitee@example.com" });
  w.set("inviteId", inviteId);
}

/** The GM deleted the campaign (restore's subject). */
async function deletedCampaign(w: World) {
  await w.as("gm").mutation(api.campaigns.remove, { campaignId: w.campaignId });
}

const area: Area = {
  area: "core",
  entries: [
    // ---- campaigns
    // Any signed-in user, acting on their own rows.
    { fn: api.campaigns.list, access: "user" },
    { fn: api.campaigns.create, access: "user", args: () => ({ name: "Another campaign" }) },
    // A raw URL segment: null for the signed-out and for strangers (no existence leak); members and the GM read it.
    { fn: api.campaigns.get, access: "maybe", args: (w) => ({ campaignId: w.campaignId }), expect: { outsider: "null", otherPlayer: "ok", grantee: "ok" } },
    // Any member records their own open; the player row is the one the acceptance asks for.
    { fn: api.campaigns.markOpened, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.campaigns.remove, access: "gm", expect: { grantee: "FORBIDDEN" } },
    // Not a campaign wrapper (a deleted campaign is missing to those): only the owner sees and restores a deleted
    // campaign; everyone else gets NOT_FOUND, members included.
    {
      fn: api.campaigns.restore,
      access: "scoped",
      setup: deletedCampaign,
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "NOT_FOUND", player: "NOT_FOUND", grantee: "NOT_FOUND", gm: "ok" },
    },
    // The caller's own deleted campaigns.
    { fn: api.campaigns.listDeleted, access: "user" },
    // Delete permanently (dcm-bxp.30): same checks as restore; a live campaign is INVALID (campaigns.test.ts).
    {
      fn: api.campaigns.purge,
      access: "scoped",
      setup: deletedCampaign,
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "NOT_FOUND", player: "NOT_FOUND", grantee: "NOT_FOUND", gm: "ok" },
    },
    { fn: api.campaigns.setOption, access: "gm", args: () => ({ option: "witherPersists", enabled: true }) },
    // Only a custom campaign has a tome: on the witherwild world the GM passes the access check and gets INVALID.
    { fn: api.campaigns.updateTome, access: "gm", args: () => ({ chapter: "overview", text: "Once upon a time" }), okCodes: ["INVALID"] },

    // ---- members
    { fn: api.members.roster, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.members.access, access: "gm", expect: { grantee: "FORBIDDEN" } },
    { fn: api.members.invite, access: "gm", args: () => ({ email: "invitee@example.com" }), expect: { grantee: "FORBIDDEN" } },
    // Takes only the invite id; the invite's campaign decides (owner only).
    {
      fn: api.members.revokeInvite,
      access: "scoped",
      setup: pendingInvite,
      args: (w) => ({ inviteId: w.ids.inviteId }),
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "FORBIDDEN", grantee: "FORBIDDEN", gm: "ok" },
    },
    // Anyone signed in may join with the code (that is what the code is for); members and the GM are no-ops.
    {
      fn: api.members.joinByCode,
      access: "scoped",
      args: (w) => ({ code: w.joinCode }),
      expect: { anon: "UNAUTHENTICATED", outsider: "ok", player: "ok", gm: "ok" },
    },
    // A member leaves; the GM cannot leave their own campaign (INVALID after the access check).
    { fn: api.members.leave, access: "view", okCodes: ["INVALID"], expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.members.removePlayer, access: "gm", args: (w) => ({ userId: w.users.otherPlayer }), expect: { grantee: "FORBIDDEN" } },
    { fn: api.members.rotateJoinCode, access: "gm", args: () => ({ replace: true }), expect: { grantee: "FORBIDDEN" } },

    // ---- settings and users (the caller's own rows)
    { fn: api.settings.get, access: "user" },
    { fn: api.settings.update, access: "user", args: () => ({ tableName: "Friday table" }) },
    { fn: api.users.viewer, access: "maybe" },

    // ---- fear
    // GM only, keyed: every default applies, the synthesizer fills campaignId, direction ("increase") and idempotencyKey.
    { fn: api.fear.adjust, access: "gm" },
    { fn: api.fear.set, access: "gm", args: () => ({ value: 3 }), expect: { grantee: "FORBIDDEN" } },

    // ---- wither
    { fn: api.wither.gain, access: "gm", expect: { grantee: "FORBIDDEN" } },
    { fn: api.wither.adjust, access: "gm", args: () => ({ delta: 1 }), expect: { grantee: "FORBIDDEN" } },

    // ---- feed, history, actionLog
    { fn: api.feed.list, access: "view", expect: { otherPlayer: "ok" } },
    { fn: api.feed.remove, access: "gm", setup: gmLogRow, expect: { grantee: "FORBIDDEN" } },
    { fn: api.feed.clear, access: "gm", expect: { grantee: "FORBIDDEN" } },
    { fn: api.history.list, access: "gm", expect: { grantee: "FORBIDDEN" } },
    // Undo is for the row's actor and the GM (`undoEntry`); the row here is the GM's, so every player is FORBIDDEN.
    {
      fn: api.actionLog.undo,
      access: "scoped",
      setup: gmLogRow,
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "FORBIDDEN", grantee: "FORBIDDEN", gm: "ok" },
    },

    // ---- campaignTime (witherwild has it)
    { fn: api.campaignTime.get, access: "view" },
    { fn: api.campaigns.fear, access: "view" },
    { fn: api.campaignTime.advance, access: "gm", expect: { grantee: "FORBIDDEN" } },
    // A new campaign starts on day 1; setDay must change the day.
    { fn: api.campaignTime.setDay, access: "gm", args: () => ({ cycleDay: 2 }), expect: { grantee: "FORBIDDEN" } },

    // ---- characters (worked H0 entry)
    // A character read: strangers get null instead of NOT_FOUND (no existence leak); party members may view.
    { fn: api.characters.get, access: "own", expect: { outsider: "null" } },
  ],
  pending: [],
  exempt: {
    "auth:signIn": "Convex Auth's sign-in action: public by design; covered by tests/e2e/auth.spec.ts and create-or-update-user.test.ts",
    "auth:signOut": "Convex Auth's sign-out action: public by design and acts only on the caller's own session; covered by tests/e2e/auth.spec.ts",
    "auth:isAuthenticated": "Convex Auth's session probe: public by design, returns only whether the caller is signed in",
  },
};

export default area;
