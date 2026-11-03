import { useQuery } from "convex/react";

import { api } from "../../convex";
import type { Id } from "../../convex";
import type { SessionListItem } from "../../../../../convex/sessionRecords";

export function useSessionList(campaignId: Id<"campaigns">): SessionListItem[] | undefined {
  return useQuery(api.sessionRecords.list, { campaignId });
}

export function useDefaultSessionId(campaignId: Id<"campaigns">): Id<"sessions"> | null | undefined {
  const sessions = useSessionList(campaignId);
  return sessions === undefined ? undefined : (sessions[0]?._id ?? null);
}
