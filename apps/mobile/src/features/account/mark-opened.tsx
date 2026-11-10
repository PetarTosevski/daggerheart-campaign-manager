import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";

import { api, type Id } from "../../convex";

/**
 * Records that the caller opened the campaign (`campaigns.markOpened`): it accepts a pending email or co-GM invite and
 * orders Continue and Load Campaign. Mount once in the campaign layout with the loaded campaign (null while loading).
 *
 * Rule 13 / CL6 exception, the same as the website's campaign shell (`campaign-shell.tsx`): the write starts from an
 * effect, guarded by a ref so it fires once per campaign id, and it changes only `lastOpenedAt` (no campaign screen
 * reads it). The owner's read-only view never records the open (config AU7). A failure is ignored: nothing on screen
 * depends on it, and the next open records it.
 */
export function useMarkOpened(campaign: { _id: string; ownerView: boolean } | null): void {
  const markOpened = useMutation(api.campaigns.markOpened);
  const marked = useRef<string | null>(null);
  const campaignId = campaign && !campaign.ownerView ? campaign._id : null;
  useEffect(() => {
    if (campaignId === null || marked.current === campaignId) return;
    marked.current = campaignId;
    void Promise.resolve(markOpened({ campaignId: campaignId as Id<"campaigns"> })).catch(() => undefined);
  }, [campaignId, markOpened]);
}

/** `useMarkOpened` as a component that renders nothing, for a layout that mounts it beside its screens. */
export function MarkOpened({ campaign }: { campaign: { _id: string; ownerView: boolean } | null }) {
  useMarkOpened(campaign);
  return null;
}
