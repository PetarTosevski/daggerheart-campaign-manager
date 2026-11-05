import { QueryBoundary } from "../sheet/query-boundary";
import { PacksBody } from "./screen";

/** GM sprite packs: create packs, upload and label sprites, rename and reorder. */
export function PacksScreen() {
  return (
    <QueryBoundary>
      <PacksBody />
    </QueryBoundary>
  );
}
