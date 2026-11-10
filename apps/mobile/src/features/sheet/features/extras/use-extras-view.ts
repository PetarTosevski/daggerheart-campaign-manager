import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../../convex";
import type { Id } from "../../../../convex";
import type { SheetData } from "../../types";
import { needsClassExtras } from "../extras-gate";

export type ExtrasView = NonNullable<FunctionReturnType<typeof api.characterExtras.get>>;

/**
 * Subscribes to `characterExtras.get` for Druid and Beastbound characters.
 * Frame extras on other classes rely on the same query once the shell passes
 * a frame id into this slot or dedupes with the sheet shell's subscription.
 */
export function useExtrasView({
  characterId,
  sheet,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  sheet: Pick<SheetData, "classId" | "subclassId">;
}): { view: ExtrasView | null; loading: boolean } {
  const need = needsClassExtras(sheet);
  const view = useQuery(api.characterExtras.get, need ? { characterId } : "skip");
  const loading = need && view === undefined;
  return { view: need ? (view ?? null) : null, loading };
}
