import { ConvexError } from "convex/values";

import { frameHasMechanic, type ExclusiveMechanic } from "../../src/lib/frames/index";
import type { Doc } from "../_generated/dataModel";

/** Frame-exclusive mechanics are enforced on the server, not only hidden in the UI. */
export function assertMechanicEnabled(campaign: Doc<"campaigns">, mechanic: ExclusiveMechanic): void {
  if (!frameHasMechanic(campaign.frameId, mechanic)) {
    throw new ConvexError("MECHANIC_DISABLED");
  }
}

/** Turns a domain rule error into a client-readable `{ code, message }`. */
export function ruleError(code: string, error: unknown): never {
  if (error instanceof Error) throw new ConvexError({ code, message: error.message });
  throw error;
}
