// Design art. Asset ids are files in public/design-assets/ (resolve with designAsset()).
// PORTRAITS lives in src/lib/party/portraits.ts (NB3: without this module's domain cards) and is re-exported here.
// Extracted verbatim from the Party design board (reference/designs/project/Party.dc.html).
// Pure data: no framework imports, relative imports only (bundled into Convex).

import { DOMAIN_CARDS } from "./domain-cards";

export { PORTRAITS } from "../party/portraits";

/** Domain card id -> asset id. */
export const DOMAIN_CARD_ART: Readonly<Record<string, string>> = /* @__PURE__ */ Object.fromEntries(
  /* @__PURE__ */ DOMAIN_CARDS.flatMap((card) => (card.art ? [[card.id, card.art]] : [])),
);

/** Transformation art keyed by board art key (transformation id, plus vampire variants). */
export const TRANSFORMATION_ART: Readonly<Record<string, string>> = {
  demigod: "e8af3a3adc391781e720dab47a6bbcf2",
  ghost: "6e69d9c280ff5fd6b0d523e23171fd84",
  reanimated: "fdb44e71a55c73e8f082cc6d71d0d816",
  shapeshifter: "540d4c807ac40d7415a536b39a9ba71e",
  vampire: "dd6c7d2c21ed6fbd329489c69ee99862",
  vampire2: "91662dea6150432310a5edaf70738988",
  "vampire2-sheet": "159fff45049f1c1a3945ba1fbf625156",
  werewolf: "c89584aee362c60f176234a170021d1b"
};
