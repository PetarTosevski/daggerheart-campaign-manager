// Design art. Asset ids are files in public/design-assets/ (resolve with designAsset()).
// PORTRAITS keys: anc-<ancestry id>, com-<community id>, sub-<subclass id>; position is a CSS background-position.
// Extracted verbatim from the Party design board (reference/designs/project/Party.dc.html).
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { PortraitArt } from "./types";
import { DOMAIN_CARDS } from "./domain-cards";

export const PORTRAITS: Readonly<Record<string, PortraitArt>> = {
  "anc-aetheris": {
    asset: "34f17485e8086eb3be27d22352988c84",
    position: "center 30%"
  },
  "anc-clank": {
    asset: "121c084a5b0502b238e7843ea96d7165",
    position: "center 30%"
  },
  "anc-drakona": {
    asset: "732fd2c61c74107e14735d9a5a5e4f38",
    position: "center 30%"
  },
  "anc-dwarf": {
    asset: "ce3bd61e37b2b11d90cafe82b2434bc4",
    position: "center 30%"
  },
  "anc-earthkin": {
    asset: "6761e68a7526fafe7ff73c5d9658fc69",
    position: "center 30%"
  },
  "anc-elf": {
    asset: "1399e0ba62407761a44a19f0a680134a",
    position: "center 30%"
  },
  "anc-emberkin": {
    asset: "08f2f7d0c3add9166f2182532e2f0f5e",
    position: "center 30%"
  },
  "anc-faerie": {
    asset: "95f9f9c9d4996249028024f54d4a821a",
    position: "center 30%"
  },
  "anc-faun": {
    asset: "9b94b85cb3ff877cb4be176cf6bf144d",
    position: "center 30%"
  },
  "anc-firbolg": {
    asset: "be57849e2691fd81cba090c59180adbe",
    position: "center 30%"
  },
  "anc-fungril": {
    asset: "cde0e56453b385c0174d76374f3bcfc8",
    position: "center 30%"
  },
  "anc-galapa": {
    asset: "4e909f3e18ac83bfbeb57cd332a5017b",
    position: "center 30%"
  },
  "anc-giant": {
    asset: "972c890e987630bfae7597c689bce51b",
    position: "center 30%"
  },
  "anc-gnome": {
    asset: "d489df5fcb9b667c273f2c54b9979411",
    position: "center 30%"
  },
  "anc-goblin": {
    asset: "302e7516bbd4e6d56b326dfcc77063ea",
    position: "center 30%"
  },
  "anc-halfling": {
    asset: "50df05ceff5f6a9f8e803b922adb28cc",
    position: "center 30%"
  },
  "anc-human": {
    asset: "7b5f34a3acebe253067779e9ef64ede6",
    position: "center 30%"
  },
  "anc-infernis": {
    asset: "0206c90609149243f2eb6225415f2aa3",
    position: "center 30%"
  },
  "anc-katari": {
    asset: "4545211440f18f0d8b10d7f81de2a5e8",
    position: "center 30%"
  },
  "anc-orc": {
    asset: "57ed2d71eb2e0b36ddebf6da66ba4601",
    position: "center 30%"
  },
  "anc-ribbet": {
    asset: "97d61cf6bbbcd0302fd491a28809bc12",
    position: "center 30%"
  },
  "anc-simiah": {
    asset: "51b2ce54ed44a948eb07863e962a5b66",
    position: "center 30%"
  },
  "anc-skykin": {
    asset: "dea682c94a8ea516cbf47758083e809c",
    position: "center 30%"
  },
  "anc-tidekin": {
    asset: "c3b9f84b68df38763aa9080510040428",
    position: "center 30%"
  },
  "com-duneborne": {
    asset: "629966c9c406d35d323c603f03177d60",
    position: "center 30%"
  },
  "com-freeborne": {
    asset: "fc4bf330350f231997c38523b106b907",
    position: "center 30%"
  },
  "com-frostborne": {
    asset: "d79951bd15071a20e1316fc570e5ce15",
    position: "center 30%"
  },
  "com-hearthborne": {
    asset: "9a45999c0011c290a0b022e33f60ba06",
    position: "center 30%"
  },
  "com-highborne": {
    asset: "39e92a6c2a210c04510229b73a921566",
    position: "center 30%"
  },
  "com-loreborne": {
    asset: "40e01781224ff299aac21e490e9bd7e2",
    position: "center 30%"
  },
  "com-orderborne": {
    asset: "f5e22594f07b51720fd45a48346987a6",
    position: "center 30%"
  },
  "com-reborne": {
    asset: "c7a6303e29382bf2bbdb171bb8fea63a",
    position: "center 30%"
  },
  "com-ridgeborne": {
    asset: "0b1784795012564327c068f8750f8838",
    position: "center 30%"
  },
  "com-seaborne": {
    asset: "03947cd673bc6d8ba39e096f619e919a",
    position: "center 30%"
  },
  "com-underborne": {
    asset: "e5f999601873ae305148bdd20a01c6ff",
    position: "center 30%"
  },
  "com-wanderborne": {
    asset: "0e06922b5299bbfd34ee05b30e51b197",
    position: "center 30%"
  },
  "com-warborne": {
    asset: "6c25abdd9c07866e5745e632afeed423",
    position: "center 30%"
  },
  "com-wildborne": {
    asset: "fd3ffb6bcbe4711c26671bc82698b7d7",
    position: "center 30%"
  },
  "sub-beastbound": {
    asset: "d0206ce45edd8385bdada1f40de5c38d",
    position: "center 30%"
  },
  "sub-call-of-the-brave": {
    asset: "12e5eb0aa70f56bd58b2b016024799fd",
    position: "center 30%"
  },
  "sub-call-of-the-slayer": {
    asset: "4dcc25990bf87ade39bb28137e430797",
    position: "center 30%"
  },
  "sub-divine-wielder": {
    asset: "96389427d4dba906adabc234d5051288",
    position: "center 30%"
  },
  "sub-elemental-origin": {
    asset: "43ccfbed0c7185d552cfa67e0c6fbf68",
    position: "center 30%"
  },
  "sub-executioners-guild": {
    asset: "93d0f9e0104b4d9632871fb1ced0eb05",
    position: "center 25%"
  },
  "sub-hedge": {
    asset: "d4cc4197681a0224ca02e4449bf464b7",
    position: "center 30%"
  },
  "sub-juggernaut": {
    asset: "0b1712de7e8824dfe05de3d62a0b6c39",
    position: "center 30%"
  },
  "sub-martial-artist": {
    asset: "d757e840fd99869fd64349eabd88859e",
    position: "center 25%"
  },
  "sub-moon": {
    asset: "e19f20f5d56e773c3c11800c55ed2cda",
    position: "center 30%"
  },
  "sub-nightwalker": {
    asset: "9dcc4ab98c6506250a9bb6fdd6ab68ad",
    position: "center 30%"
  },
  "sub-pact-of-the-endless": {
    asset: "62e9d9410a069104516b30a4549519bb",
    position: "center 35%"
  },
  "sub-pact-of-the-wrathful": {
    asset: "94a4f8e90b65585c709f13671319e2f5",
    position: "center 30%"
  },
  "sub-poisoners-guild": {
    asset: "c191b86042c066b746f0787a6968e38b",
    position: "center 25%"
  },
  "sub-primal-origin": {
    asset: "a473fd7cc8bc76343425f0ab9395c2c3",
    position: "center 30%"
  },
  "sub-school-of-knowledge": {
    asset: "317838c60d04906d6349a105be2271b5",
    position: "center 30%"
  },
  "sub-school-of-war": {
    asset: "355a4a0db0ace6b646edf27ed23d2c18",
    position: "center 30%"
  },
  "sub-stalwart": {
    asset: "12ab0a4d0f4738ec54d05ba1d34485f6",
    position: "center 30%"
  },
  "sub-syndicate": {
    asset: "d8726148e872070c2580c88ed4376c47",
    position: "center 30%"
  },
  "sub-troubadour": {
    asset: "3d80339455226cf53843d35aeaab54f3",
    position: "center 30%"
  },
  "sub-vengeance": {
    asset: "58639571fc861b749a50e02b5bbb1f02",
    position: "center 30%"
  },
  "sub-warden-of-renewal": {
    asset: "9d153e4ea3565094178efd49ea428520",
    position: "center 30%"
  },
  "sub-warden-of-the-elements": {
    asset: "015312cdce7192c158be829edf39f035",
    position: "center 30%"
  },
  "sub-wayfinder": {
    asset: "43b63067ae8f492cb557ae58de002b37",
    position: "center 30%"
  },
  "sub-winged-sentinel": {
    asset: "02311d0caed89d4b97319779bb5b6631",
    position: "center 30%"
  },
  "sub-wordsmith": {
    asset: "2fa27ed702d67ce71cbc97dbcbd68862",
    position: "center 30%"
  }
};

/** Domain card id -> asset id. */
export const DOMAIN_CARD_ART: Readonly<Record<string, string>> = Object.fromEntries(
  DOMAIN_CARDS.flatMap((card) => (card.art ? [[card.id, card.art]] : [])),
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
