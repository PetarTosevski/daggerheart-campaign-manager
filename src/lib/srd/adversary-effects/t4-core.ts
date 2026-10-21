// Adversary feature effects of tier 4 Core Book adversaries (plan combat-actions; tracer AE-t4-core fills it, AA0 ships it
// empty). Pure data: no framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts). Each entry
// quotes its feature text in a comment; what the vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express
// is a `manual` step, never a vocabulary change.

import type { AdversaryFeatureEffect } from "../../domain/adversary-effects/types";

export const T4_CORE_EFFECTS: readonly AdversaryFeatureEffect[] = [];
