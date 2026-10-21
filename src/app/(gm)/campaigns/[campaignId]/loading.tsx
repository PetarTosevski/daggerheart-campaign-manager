import { CampaignSectionLoading } from "./campaign-shell";

/**
 * Instant feedback on a campaign tab click (PF1): this Suspense fallback renders inside the campaign shell (header and
 * nav stay) until the tab's server payload arrives. It also lets the auto-prefetch of a campaign link fetch the shell
 * down to this boundary.
 */
export default function CampaignLoading() {
  return <CampaignSectionLoading />;
}
