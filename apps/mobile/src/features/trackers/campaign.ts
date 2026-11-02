import type { Id } from "../../convex";

/** The campaign fields the dashboard trackers read. Matches `CampaignSummary` on the website. */
export type TrackerCampaign = {
  _id: Id<"campaigns">;
  frameId: string;
  role: "gm" | "player";
  options?: { witherPersists?: boolean };
};
