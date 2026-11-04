import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { gmQuery, userMutation, userQuery } from "./lib/functions";
import { campaignAccess } from "./lib/permissions";

/**
 * Online / Away (config PR1, Q11 b; docs/tasks/TASK-CONFIG-PR1.md). The `@convex-dev/presence` component keeps one
 * room per campaign (room id = the campaign id) and one presence row per user in it; this module is the only way in.
 * The functions have the shapes the component's `usePresence` hook calls (`heartbeat`, `disconnect`, and a `list` slot
 * the hook gets as `roomList`), wrapped in our builders:
 *
 * - The user is always `ctx.user` (rule 3). The hook's `userId` argument is only its label and is ignored, and the
 *   component session id is namespaced with the caller and the campaign, so a call can only ever touch the caller's
 *   own sessions.
 * - `heartbeat` needs `view` on the campaign (members and invitees; archived campaigns too, opening one beats).
 * - `disconnect` takes the handle `heartbeat` returned and acts only on the caller's own session in that room.
 * - Players never read the room: `heartbeat` hands out an empty room token, so the hook never subscribes to a list,
 *   and the GM's Players section reads `list` (GM and co-GMs only, members only).
 */
const presence = new Presence<Id<"campaigns">, Id<"users">>(components.presence);

/** The heartbeat interval the server accepts (ms); the session times out 2.5 intervals after the last beat. */
export const HEARTBEAT_MIN_MS = 10_000;
export const HEARTBEAT_MAX_MS = 60_000;
/** The hook's session id is a short JSON string; longer ones are refused. */
const SESSION_ID_MAX = 256;
/** More members than any campaign has; the list reads this many member rows at most. */
const MEMBER_READ_CAP = 200;

function clampInterval(interval: number): number {
  if (!Number.isFinite(interval)) return HEARTBEAT_MIN_MS;
  return Math.min(HEARTBEAT_MAX_MS, Math.max(HEARTBEAT_MIN_MS, Math.round(interval)));
}

/** The component's session id: the caller and the campaign come from the server, the hook's id only tells tabs apart. */
function componentSessionId(userId: Id<"users">, campaignId: Id<"campaigns">, sessionId: string): string {
  return JSON.stringify([userId, campaignId, sessionId]);
}

/** The handle the client gets as its `sessionToken`: which room and which of the caller's sessions (not a secret). */
function sessionHandle(campaignId: Id<"campaigns">, sessionId: string): string {
  return JSON.stringify([campaignId, sessionId]);
}

function parseHandle(handle: string): { campaignId: string; sessionId: string } | null {
  try {
    const parsed: unknown = JSON.parse(handle);
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [campaignId, sessionId] = parsed as unknown[];
    if (typeof campaignId !== "string" || typeof sessionId !== "string") return null;
    return { campaignId, sessionId };
  } catch {
    return null;
  }
}

/**
 * Keeps the caller present in the campaign's room for one tab. `roomId` is the campaign id; `userId` is ignored (the
 * caller is `ctx.user`). Returns the component's shape: an empty `roomToken` (the hook then skips its list) and a
 * `sessionToken` handle for `disconnect`. No access → NOT_FOUND.
 */
export const heartbeat = userMutation({
  // Read-only mode (AD10, Q31 a): presence still records, or every page load would fail.
  readOnly: "allow",
  args: { roomId: v.string(), userId: v.string(), sessionId: v.string(), interval: v.number() },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { roomId, sessionId, interval }) => {
    if (sessionId.length === 0 || sessionId.length > SESSION_ID_MAX) throw appError("INVALID");
    const campaignId = ctx.db.normalizeId("campaigns", roomId);
    const access = campaignId === null ? null : await campaignAccess(ctx, ctx.user, campaignId);
    if (access === null) throw appError("NOT_FOUND");
    const room = access.campaign._id;
    await presence.heartbeat(ctx, room, ctx.user._id, componentSessionId(ctx.user._id, room, sessionId), clampInterval(interval));
    return { roomToken: "", sessionToken: sessionHandle(room, sessionId) };
  },
});

/**
 * Ends one of the caller's sessions (the hook calls it when the tab is hidden or unmounts). The handle names a room
 * and a session id; the session acted on is always the caller's own in that room, so a handle from someone else can't
 * disconnect them. A malformed handle → INVALID; no access to the room → NOT_FOUND; not online there → nothing.
 * The hook's unload beacon carries no sign-in and is refused; the component's timeout covers that tab.
 */
export const disconnect = userMutation({
  // Read-only mode (AD10, Q31 a): presence still records, or every page load would fail.
  readOnly: "allow",
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const handle = parseHandle(sessionToken);
    if (handle === null || handle.sessionId.length === 0 || handle.sessionId.length > SESSION_ID_MAX) throw appError("INVALID");
    const campaignId = ctx.db.normalizeId("campaigns", handle.campaignId);
    const access = campaignId === null ? null : await campaignAccess(ctx, ctx.user, campaignId);
    if (access === null) throw appError("NOT_FOUND");
    const room = access.campaign._id;
    const rooms = await presence.listUser(ctx, ctx.user._id, true);
    if (!rooms.some((r) => r.roomId === room)) return null;
    // The component disconnects by its own token, which only `heartbeat` returns: look it up for the caller's session
    // (a beat creates it if that tab's session already ended), then end it. One transaction: no one sees the beat.
    const { sessionToken: token } = await presence.heartbeat(
      ctx,
      room,
      ctx.user._id,
      componentSessionId(ctx.user._id, room, handle.sessionId),
      HEARTBEAT_MIN_MS,
    );
    await presence.disconnect(ctx, token);
    return null;
  },
});

/**
 * Who is online in the campaign, for the GM's Players section (GM and co-GMs only): the creator and the member rows,
 * so a removed member or a stray session never shows. Only user ids and the online flag.
 */
export const list = gmQuery({
  args: {},
  returns: v.array(v.object({ userId: v.id("users"), online: v.boolean() })),
  handler: async (ctx) => {
    const members = await ctx.db
      .query("campaignMembers")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id))
      .take(MEMBER_READ_CAP);
    const known = new Map<string, Id<"users">>([[ctx.campaign.ownerId, ctx.campaign.ownerId]]);
    for (const member of members) known.set(member.userId, member.userId);
    const rows = await presence.listRoom(ctx, ctx.campaign._id);
    return rows.flatMap((row) => {
      const userId = known.get(row.userId);
      return userId === undefined ? [] : [{ userId, online: row.online }];
    });
  },
});

/**
 * The hook's `list` slot. `heartbeat` hands out an empty room token, so the hook never calls it; it exists so the hook
 * gets a function of the right shape, and it answers an empty list to anyone signed in.
 */
export const roomList = userQuery({
  args: { roomToken: v.string() },
  returns: v.array(v.object({ userId: v.string(), online: v.boolean(), lastDisconnected: v.number() })),
  handler: async () => [],
});

/** Removes the campaign's presence room (its rows, sessions and room token); `cleanup.purgeCampaign` calls it. */
export async function removeCampaignRoom(ctx: MutationCtx, campaignId: Id<"campaigns">): Promise<void> {
  await presence.removeRoom(ctx, campaignId);
}
