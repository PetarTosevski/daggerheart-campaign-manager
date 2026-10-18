// The class-feature registry (D5). Empty after T0; T8a adds one module per
// class from `classes/<classId>.ts`, T8b and T8c fill their class files.
// Callers never read it directly: use `hooks.ts` (see types.ts for the contract).
//
// ```ts
// import { warrior } from "./classes/warrior";
// export const CLASS_FEATURES: Registry = { warrior, ... };
// ```

import type { ClassFeatures } from "./types";

/** Class id → its features. A class without an entry gets the no-op defaults in hooks.ts. */
export type Registry = Readonly<Record<string, ClassFeatures>>;

export const CLASS_FEATURES: Registry = {};
