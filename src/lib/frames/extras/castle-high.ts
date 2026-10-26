// Castle High: each student's skyshard artifact (Hope & Fear p.125, "The Skyshards").

import { z } from "zod";

export const castleHighStateSchema = z.object({
  skyshard: z.object({ name: z.string().trim().max(80), description: z.string().max(2000) }),
});
export type CastleHighState = z.infer<typeof castleHighStateSchema>;

export const INITIAL_CASTLE_HIGH: CastleHighState = { skyshard: { name: "", description: "" } };

/** The book's inspiration list for an artifact's form. */
export const SKYSHARD_IDEAS = [
  "A broom (the most common option)",
  "A vacuum, carpet, or other mundane household item",
  "A medallion, necklace, small trinket, or other keepsake",
  "A cane, leg braces, wheelchair, or other mobility aid",
  "A fine cloak, winged sneakers, team jersey, or other apparel",
  "A breastplate, chainmail, shield, or other means of protection",
  "A sword, mace, axe, or other physical weapon",
  "A wand, staff, scepter, or other magical weapon",
] as const;
