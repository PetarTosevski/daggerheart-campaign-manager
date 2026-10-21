// Card effects of the Splendor domain (plan combat-actions; tracer CE-splendor fills it, CA0 ships it empty).
// Pure data: no framework imports, relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts. Each entry quotes its card text in a comment;
// what the vocabulary (src/lib/domain/card-effects/types.ts) cannot express is a `manual` step, never a vocabulary change.

import type { CardEffect } from "../../domain/card-effects/types";

export const SPLENDOR_EFFECTS: readonly CardEffect[] = [];
