import { QueryBoundary } from "../sheet/query-boundary";

import { EncounterView } from "./encounter-screen";
import { AdversariesView } from "./screen";

/** GM adversaries: catalogue, encounters and environments. The route renders it only for the GM. */
export function AdversariesScreen() {
  return (
    <QueryBoundary>
      <AdversariesView />
    </QueryBoundary>
  );
}

/** One encounter's tracker. The route renders it only for the GM. */
export function EncounterScreen() {
  return (
    <QueryBoundary>
      <EncounterView />
    </QueryBoundary>
  );
}
