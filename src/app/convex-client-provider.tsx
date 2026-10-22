"use client";

import { useConvexAuth as useConvexAuthTokens } from "@convex-dev/auth/react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

import { withDistinctRefresh } from "@/lib/auth/distinct-refresh";

// initialAuthTokenReuse (experimental in convex 1.46, pinned in package.json):
// once the server confirms the token the page was rendered with, keep using it
// and schedule its refresh before it expires, instead of fetching a fresh one
// at once. That second token cost a POST /api/auth and a second Authenticate,
// which made the server run every subscribed query twice on each hard load.
// tests/e2e/auth-single-run.spec.ts fails if the double run comes back.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
  initialAuthTokenReuse: true,
});

/**
 * Convex Auth's own auth hook (what `ConvexAuthNextjsProvider` passes to `ConvexProviderWithAuth`), with a forced
 * refresh that never hands back the token the Convex client already holds (src/lib/auth/distinct-refresh.ts,
 * dcm-bxp.123). `fetchAccessToken` is stable in Convex Auth, so the wrapper is too and auth is set once.
 */
function useAuthWithDistinctRefresh() {
  const { isLoading, isAuthenticated, fetchAccessToken } = useConvexAuthTokens();
  const fetchDistinct = useMemo(() => withDistinctRefresh(fetchAccessToken), [fetchAccessToken]);
  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken: fetchDistinct }),
    [isLoading, isAuthenticated, fetchDistinct],
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthWithDistinctRefresh}>
      {children}
    </ConvexProviderWithAuth>
  );
}
