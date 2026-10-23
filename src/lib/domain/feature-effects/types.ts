/**
 * The feature-effect model (plan sheet-drawer, tracer SD0; analysis section 5.1). A `FeatureEffect` is a `CardEffect`
 * for a Hope, class, subclass, ancestry, community, Beastform, transformation or martial-stance feature: the same
 * `CardUse` vocabulary (src/lib/domain/card-effects/types.ts, widened by SD0 with NV1-NV19), keyed by a feature id
 * instead of a card id, so the card runner (SD1) and the card server path (SD3) run both.
 *
 * Binding rules for the twelve FE-* table tracers (src/lib/srd/feature-effects/<group>.ts):
 * - The vocabulary is SD0's (types) and SD1's (runner). A table tracer never changes it; a step it cannot express is a
 *   `manual` step with the feature's words plus a bead labelled `feature-effects vocabulary-gap`.
 * - Every entry quotes its feature with the printed page in a comment (CB = Core Book, HF = Hope & Fear).
 * - Ids come from `featureId` (./ids.ts) and match the classification (src/lib/srd/feature-effects/classification.ts).
 * - Pure types: no framework imports, no `any`.
 */

import type { CardUse, Upgrade } from "../card-effects/types";

/** Where a feature comes from (CB p.27 Hope features, class features; CB p.71 heritage; CB p.30 Beastforms; HF p.12, p.34). */
export const FEATURE_SOURCES = ["hope", "class", "subclass", "ancestry", "community", "beastform", "transformation", "stance"] as const;
export type FeatureSource = (typeof FEATURE_SOURCES)[number];

/** The three subclass cards (CB p.110: foundation, then specialization and mastery as upgrades). */
export type SubclassCard = "foundation" | "specialization" | "mastery";

/** How a feature is used in combat (analysis section 2): Use buttons and riders (`combat`), always on (`passive`), text. */
export const FEATURE_USAGES = ["combat", "passive", "outOfCombat", "narrative"] as const;
export type FeatureUsage = (typeof FEATURE_USAGES)[number];

/**
 * The effect entry of one feature: every use it offers. Lives in src/lib/srd/feature-effects/<group>.ts.
 * - `featureId`: `<source>:<owner>:<slug>` (`featureId()` in ./ids.ts).
 * - `owner`: the class, subclass, ancestry, community, Beastform or transformation id; `martial-artist` for a stance.
 * - `card`: the subclass card that grants it (subclass features only); `owned()` (SD1) unlocks it by `subclassRank`.
 * - `upgrades`: later cards, levels or features that change it (NV3: Virtuoso, Fueled by Fear, Backstab, …).
 */
export interface FeatureEffect {
  featureId: string;
  source: FeatureSource;
  owner: string;
  card?: SubclassCard;
  uses: readonly CardUse[];
  upgrades?: readonly Upgrade[];
}
