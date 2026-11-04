"use client";

import usePresence from "@convex-dev/presence/react";
import type { ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import type { PresenceBeatProps } from "./slots";

/**
 * The hook's three functions (docs/tasks/TASK-CONFIG-PR1.md). `list` is the `roomList` stub: `heartbeat` hands back an
 * empty room token, so the hook never subscribes to it and a player's tab never reads the room.
 */
const PRESENCE_API = { heartbeat: api.presence.heartbeat, disconnect: api.presence.disconnect, list: api.presence.roomList };

/**
 * The hook's user label. The server ignores it and takes the user from the sign-in (rule 3); it only feeds the hook's
 * per-tab session id, which is unique per mount anyway.
 */
const USER_LABEL = "me";

/**
 * Keeps the signed-in user present in the campaign's room while this tab is open (config U3p, Q11 b), mounted once per
 * campaign page by the shell (`ConfigMounts`). The component's `usePresence` hook owns the heartbeat timer, stops
 * beating and disconnects while the tab is hidden, and disconnects on unmount (rule 13: no mutation from our own
 * effect). Renders nothing; the GM reads Online / Away in Campaign settings, Players.
 */
export function PresenceBeat({ campaignId }: PresenceBeatProps): ReactNode {
  usePresence(PRESENCE_API, campaignId, USER_LABEL);
  return null;
}
