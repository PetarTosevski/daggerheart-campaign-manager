import { QueryBoundary } from "../../ui/query-boundary";
import { PlayersBody } from "./screen";

export function PlayersScreen() {
  return (
    <QueryBoundary>
      <PlayersBody />
    </QueryBoundary>
  );
}
