// Adversary feature effects of tier 2 Core Book adversaries (plan combat-actions; tracer AE-t2-core fills it, AA0 ships it
// empty). Pure data: no framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts). Each entry
// quotes its feature text in a comment; what the vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express
// is a `manual` step, never a vocabulary change.

import type { AdversaryFeatureEffect } from "../../domain/adversary-effects/types";

export const T2_CORE_EFFECTS: readonly AdversaryFeatureEffect[] = [];
