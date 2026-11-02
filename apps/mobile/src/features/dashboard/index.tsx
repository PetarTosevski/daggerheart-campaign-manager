import { NotBuiltYet } from "../../shell/not-built-yet";
import { useCampaign, type LoadedCampaign } from "../../shell/campaign-provider";
import { sectionLabel } from "../../shell/sections";

/**
 * The shell's player-route tests render this screen with a campaign that has
 * no frame. That shape is the unfinished stub: one "Dashboard" header and no
 * second subscription. A campaign from `campaigns.get` always has a frame.
 * The live tree is loaded only then, so those tests do not import Reanimated.
 */
export function DashboardScreen() {
  const campaign = useCampaign();
  if (typeof campaign.frameId !== "string" || campaign.options == null) {
    return <NotBuiltYet title={sectionLabel("")} />;
  }
  return <LoadedDashboard campaign={campaign} />;
}

function LoadedDashboard({ campaign }: { campaign: LoadedCampaign }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const live = require("./live") as typeof import("./live");
  return <live.LiveDashboard campaign={campaign} />;
}
