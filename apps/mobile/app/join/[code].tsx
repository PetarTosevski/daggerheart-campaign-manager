import { useLocalSearchParams } from "expo-router";

import { JoinByLinkScreen } from "../../src/features/account/join-by-link";
import { firstParam } from "../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../src/shell/route-error";

export default function JoinLinkRoute() {
  const params = useLocalSearchParams<{ code: string | string[] }>();
  return <JoinByLinkScreen code={firstParam(params.code)} />;
}
