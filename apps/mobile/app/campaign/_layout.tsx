import { CampaignGate } from "../../src/shell/campaign-gate";

export { RouteErrorBoundary as ErrorBoundary } from "../../src/shell/route-error";

/** Every `/campaign/*` route renders only signed in; signed out it redirects to sign-in. */
export default function CampaignGroupLayout() {
  return <CampaignGate />;
}
