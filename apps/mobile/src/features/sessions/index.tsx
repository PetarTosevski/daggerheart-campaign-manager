import { QueryBoundary } from "../sheet/query-boundary";
import { SessionDetailScreen } from "./detail-screen";
import { SessionsListScreen } from "./list-screen";

export function SessionsScreen() {
  return (
    <QueryBoundary>
      <SessionsListScreen />
    </QueryBoundary>
  );
}

export function SessionDetailRoute() {
  return (
    <QueryBoundary>
      <SessionDetailScreen />
    </QueryBoundary>
  );
}
