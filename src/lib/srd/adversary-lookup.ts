// Lookups into the SRD adversary list, built on first use (dcm-uh6r).
//
// The Convex modules used to build `new Map(ADVERSARIES.map(...))` at module load. That top-level call kept the 430 KB
// adversary table in every function bundle that imported the module, and evaluated it on every uncached call, even
// for functions that never look an adversary up. These helpers keep the table out of bundles whose live code does not
// call them, and build the map only on the first lookup.
// Pure data: no framework imports, relative imports only (bundled into Convex).

import { ADVERSARIES } from "./adversaries";
import type { AdversaryDef } from "./types";

let byId: ReadonlyMap<string, AdversaryDef> | undefined;

/** The SRD adversary with this id, or undefined. */
export function srdAdversary(id: string): AdversaryDef | undefined {
  byId ??= new Map(ADVERSARIES.map((a) => [a.id, a]));
  return byId.get(id);
}
