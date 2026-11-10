import type { ErrorBoundaryProps } from "expo-router";

import { QueryError } from "../ui/query-boundary";

/** Expo Router route `ErrorBoundary`: the same error screen as `QueryBoundary`, with the router's retry. */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <QueryError
      error={error}
      onRetry={() => {
        void retry();
      }}
    />
  );
}
