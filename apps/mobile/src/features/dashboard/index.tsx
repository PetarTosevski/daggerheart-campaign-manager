import { useCampaign, type LoadedCampaign } from "../../shell/campaign-provider";

/** The campaign dashboard. The live tree loads on first render, so screens that never show it skip Reanimated. */
export function DashboardScreen() {
  const campaign = useCampaign();
  return <LoadedDashboard campaign={campaign} />;
}

function LoadedDashboard({ campaign }: { campaign: LoadedCampaign }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const live = require("./live") as typeof import("./live");
  return <live.LiveDashboard campaign={campaign} />;
}
