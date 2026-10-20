/**
 * A stored combat map layout as the painter's input (D9 C3). C2's `PaintSpec` is structural; C1's `MapSpec` (the
 * cleaned layout) is assignable to it (checked in tests/convex/combat-maps.test.ts), and so is what the layout
 * queries return once the object ids are dropped. Pure: no React, no Convex.
 */

import type { PaintObject, PaintSpec } from "../../../lib/combat-map/raster";

/** The parts of a layout (`api.combatMaps.get` / `live`) the painter reads. */
export type PaintableLayout = {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly base: string;
  readonly plankV?: boolean;
  readonly areas: PaintSpec["areas"];
  readonly objects: ReadonlyArray<PaintObject & { readonly _id: string }>;
};

/** The painter's spec for a stored layout (objects without their ids, optional keys only when set). */
export function toPaintSpec(layout: PaintableLayout): PaintSpec {
  return {
    w: layout.w,
    h: layout.h,
    seed: layout.seed,
    base: layout.base,
    ...(layout.plankV === undefined ? {} : { plankV: layout.plankV }),
    areas: layout.areas,
    objects: layout.objects.map(({ _id, ...object }) => (void _id, object)),
  };
}
