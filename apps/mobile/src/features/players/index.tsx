import { QueryBoundary } from "../sheet/query-boundary";
import { PlayersBody } from "./screen";

export function PlayersScreen() {
  return (
    <QueryBoundary>
      <PlayersBody />
    </QueryBoundary>
  );
}
