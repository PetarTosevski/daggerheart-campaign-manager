import { QueryBoundary } from "../sheet/query-boundary";
import { CodexEntryScreen } from "./entry-screen";
import { CodexListScreen } from "./list-screen";

export function CodexScreen() {
  return (
    <QueryBoundary>
      <CodexListScreen />
    </QueryBoundary>
  );
}

export function CodexEntryRoute() {
  return (
    <QueryBoundary>
      <CodexEntryScreen />
    </QueryBoundary>
  );
}
