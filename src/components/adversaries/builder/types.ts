import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../convex/_generated/api";

/** `encounters.get` for an encounter that exists. */
export type EncounterView = NonNullable<FunctionReturnType<typeof api.encounters.get>>;
export type InstanceView = EncounterView["instances"][number];
/** `encounters.list`. */
export type EncounterList = FunctionReturnType<typeof api.encounters.list>;
export type EncounterSummary = EncounterList["active"][number];
