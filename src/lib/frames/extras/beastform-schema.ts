// The Druid Beastform state's zod schema, in its own module (dcm-uh6r): ./beastform re-exports it, so a Convex function
// bundle that loads the Beastform helpers but never parses a state drops this module and builds no schema at load.

import * as z from "../../zod";

import { traitIdSchema } from "./common";

const id = z.string().min(1).max(60);

export const beastformStateSchema = z.object({
  formId: id.nullable(),
  /** The lower-tier form an Evolved form upgrades. */
  baseFormId: id.optional(),
  hybrid: z
    .object({
      sources: z.array(id).max(3),
      advantages: z.array(z.string().min(1).max(60)).max(5),
      features: z.array(z.string().min(1).max(60)).max(3),
    })
    .optional(),
  /** Druid Evolution: "choose one trait to raise by +1 until you drop out of that Beastform". */
  evolutionTrait: traitIdSchema.optional(),
});
export type BeastformState = z.infer<typeof beastformStateSchema>;
