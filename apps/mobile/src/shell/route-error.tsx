import type { ErrorBoundaryProps } from "expo-router";
import { lazy, Suspense } from "react";

import { errorMessage } from "../../../../src/lib/convex-errors";
import { Loading } from "../ui/loading";

/**
 * `ErrorState` uses Reanimated. Load it when a route throws, not when the
 * route module is imported, so a screen test can install the Reanimated mock
 * first.
 */
const ErrorState = lazy(async () => {
  const ui = await import("../ui/error-state");
  return { default: ui.ErrorState };
});

/** Expo Router route `ErrorBoundary`. The message comes from `errorMessage`. */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <Suspense fallback={<Loading label="Loading" />}>
      <ErrorState
        message={errorMessage(error)}
        onRetry={() => {
          void retry();
        }}
        title="Something went wrong"
      />
    </Suspense>
  );
}
