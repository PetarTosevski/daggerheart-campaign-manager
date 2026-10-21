import { ConvexError } from "convex/values";

import { appError, RuleError, type AppErrorCode } from "../../src/lib/errors/app-error";
import { frameHasMechanic, type ExclusiveMechanic } from "../../src/lib/frames/index";
import type { Doc } from "../_generated/dataModel";

/** Frame-exclusive mechanics are enforced on the server, not only hidden in the UI. */
export function assertMechanicEnabled(campaign: Doc<"campaigns">, mechanic: ExclusiveMechanic): void {
  if (!frameHasMechanic(campaign.frameId, mechanic)) {
    throw appError("MECHANIC_DISABLED");
  }
}

/**
 * Runs a domain rule, turning the error class the domain throws for an
 * expected violation (`expected`) into a `RuleError` with `code`, which the
 * wrappers send as `{ code, message }`. Any other error is a bug and
 * propagates unchanged (CF14).
 */
export function applyRule<T>(code: AppErrorCode, expected: abstract new (...args: never[]) => Error, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof expected) throw new RuleError(code, error.message);
    throw error;
  }
}

/**
 * DEPRECATED (converts every `Error`, bugs included): modules move to
 * `applyRule` as they move onto the wrappers.
 */
export function ruleError(code: string, error: unknown): never {
  if (error instanceof Error) throw new ConvexError({ code, message: error.message });
  throw error;
}
