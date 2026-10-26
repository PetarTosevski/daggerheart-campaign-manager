# TASK-AA1: Adversary illustrations from the rulebooks on the stat block

Status: Review. Plan: `.omc/plans/adversary-art.yaml`, tracer AA1 (wave 1, no dependencies). User (2026-10-18): "attempt to
add art for adversaries".

## Goal
Every adversary whose rulebook page carries an illustration of it shows that art on its stat block, with a small round
thumbnail in the catalogue list; adversaries without art look as before.

## What was built
- `scripts/srd/extract-adversary-art.mjs` (local only, nothing in CI runs it):
  `node scripts/srd/extract-adversary-art.mjs --core <core.pdf> --hf <hopefear.pdf> --pdfjs <node_modules with pdfjs-dist>
  [--sharp <sharp dir>] [--review <dir>] [--dry]`. Scans CB pp.209-240 and HF pp.61-97 plus pp.141-143 (Reign of the
  Weredragon); PDF index = printed page + 1 in both books.
  - Images: every `paintImageXObject` with its page box (pdf.js operator list, transforms tracked). Furniture skipped:
    boxes over 60 % of the page (backgrounds), aspect ratio over 6 (strips, edge slivers), both sides under 200 px (icons),
    anything starting in the footer band.
  - Captions: every illustration in these chapters carries a hand-lettered caption naming it (7 pt all-caps lines in a
    caption font, e.g. "ACID BURROWER" on CB p.210). Lines are grouped into captions and matched to adversary names
    (normalised); captions are paired with images greedily by distance to the image box, then to its centre.
  - Overrides, each checked on a rendered page: `ALIASES` (caption names differ), `SKIP` (not one adversary), `PICK`
    (nearest image wrong), `MANUAL` (uncaptioned art).
  - Output: pdf.js-decoded RGBA (alpha kept, the art is cut out over the parchment), transparent edges trimmed, sharp WebP
    at most 900 px wide, quality 80, to `public/adversary-art/<id>.webp`; the folder is regenerated on each run.
  - `--review <dir>` also writes every unassigned image as PNG with a report.
- `src/lib/srd/adversary-art.ts` (generated): `ADVERSARY_ART` (id -> `{ src, width, height, credit }`, credit = "CB p.N"
  / "HF p.N"), `ADVERSARY_ART_COUNT` per book, `adversaryArt(id)`.
- `stat-block.tsx`: `StatBlockAdversary` gains optional `id` and `basedOn`; the art is looked up by `id` (SRD entries) or
  `basedOn` (custom blocks duplicated from an SRD entry, A5 rows carry it, so the custom list and the tracker show the
  source art too). A framed banner under the name: `<img loading="lazy" decoding="async" width height>` with alt
  "<name> illustration", `width: 100%; height: auto; max-height: 280px; object-fit: cover; object-position: 50% 20%`
  (wide art is shown whole; tall art crops to the upper part, where heads are). The `title` holds the credit.
- `index.tsx` + `catalogue.css`: a 32 px round thumbnail (decorative, `alt=""`) before the name in list rows that have art.

## Assigned: 102 (Core 50, Hope & Fear 52), 11,544,402 bytes (11.0 MB)
Largest file 338 KB (Arch-Necromancer). Every assignment was checked by eye against a rendered page (pdf.js renders,
scratchpad only) and against the extracted image on contact sheets.

Core (50): Acid Burrower, Glass Snake, Jagged Knife Bandit / Hexer / Lieutenant, Minor Chaos Elemental, Minor Fire
Elemental, Minor Demon, Minor Treant, Green Ooze, Red Ooze, Tiny Red Ooze, Skeleton Archer / Warrior / Knight / Dredge,
Patchwork Zombie Hulk, Rotted Zombie, Brawny Zombie, Apprentice Assassin, Assassin Poisoner, Master Assassin, Battle Box,
Chaos Skull, Demonic Hound Pack, Giant Brawler, Gorgon, Knight of the Realm, Juvenile Flickerfly, Minotaur Wrecker,
War Wizard, Stonewraith, Adult Flickerfly, Demon of Avarice / Despair / Wrath / Hubris / Jealousy, Greater Earth
Elemental, Hydra, Vault Guardian Turret, Young Ice Dragon, Arch-Necromancer, Fallen Warlord: Realm-Breaker / Undefeated
Champion, Kraken, Oracle of Doom, Volcanic Dragon: Obsidian Predator / Molten Scourge / Ashen Tyrant.

Hope & Fear (52): Ahuizotl, Bugboar, Darkweave Queen, Grimmling Warband, Mechanorb, Mountain Troll, Rabble Mawb, Redcap
Butcher / Skinner / Candlemaker, Soul-Shattered Mage, Spellbound Armor, Sawtoothed Gillbeast, Waxwork Creation, Yufo,
Basilisk, Doppelhound, Dire Pangolati, Entombed Cat Beast / Empress / Stonemason / Elite Guard, Fowlbear, Gobstalker,
Guahalan Spirit Beast / Fang Lord / Shifter / Alebrujo / Spirit Singer, Landshark, Landshark Behemoth, Ravenous Mockery,
Sprite, Triceratops, Valdenhax, Urco, Chimera, Cryptimoth, Deep Dweller, Night Children, Lamplight Beguiler, Pain Priest,
Phoenix, Sandwyrm, Vampire Lord, Wyvern, Cephilith Hatchling, Cephilith Titan, Demon Lord Berzug, Supreme Demiurge
Adonix, Xero the Castle Killer, Weredrake.

## Judgement calls (checked on the rendered page)
- Aliases: "MINOTAUR" (CB p.225) -> Minotaur Wrecker (beside its block, battleaxe as its ATK; the only minotaur);
  "VAMPIRE LORD WITH HELLWING EVOLUTION" (HF p.88) -> Vampire Lord.
- `PICK`: CB p.216 paints the Red Ooze as a luminosity mask (image 2) plus the colour art (image 3), so image 3; CB p.228
  the Demon of Avarice / Despair captions sit nearer each other's art, so swapped by hand.
- Darkweave Queen (HF p.63): one image shows the Queen with two small Darkweave Crawlers at its left edge; it goes to the
  Queen, the Crawler gets none.
- Weredrake (HF p.143, `MANUAL`, no caption): the only art on the page, beside the Weredrake block, a wingless quadrupedal
  dragon exactly as the Weredrake text describes. The least certain assignment of the 102.
- Molten Scourge (CB p.238): the art continues across the spread (smoke piece on p.238, drips on p.239); only the main
  piece with the dragon is used.

## Left unassigned (no guess)
- Head Vampire and Dire Bat (CB p.233): one image shows both, overlapping.
- Darkweave Crawler (HF p.63): only inside the Queen's image.
- The Harbingers (HF p.94): the four riders in one image; Harbinger of Death / Famine / Pestilence / War get none.
- HF p.141: a purple winged dragon breathing green, uncaptioned, above the Night Sky Reading table: probably Forlorne
  Lykona (Dragon Form) ("purple-scaled dragon form", Breath Weapon), but not beside her block. Adding it is one `MANUAL`
  line if confirmed.
- CB p.209: a horned brute with a warhammer on the stat-block index page, uncaptioned.
- Not adversaries: the Jagged Knife (CB p.213), Lady Lavender's Longsword and the Zoetrope (HF p.142).

## Acceptance evidence
- `tests/unit/adversary-art.test.ts` (6 tests): ids are real adversaries and `src` matches the id; every mapped file
  exists and every file is mapped; width 1-900 and height set; per-book counts equal `ADVERSARY_ART_COUNT`; credit
  "CB p.N" / "HF p.N" by source; total under 15 MB; `adversaryArt` for art / no art / undefined.
- `tests/e2e/visual/AA1.spec.ts`: stat block with art (Acid Burrower), list with thumbnails, stat block without art (Bear,
  no `.adc-sb-art`), each at 1440 and 390 (`test-results/visual/AA1/`), no horizontal scroll at 390.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (123 files, 1332 tests) pass; the adversary e2e specs (adversaries,
  adversary-catalogue, custom-adversaries, encounter-builder, encounter-tracker: 14 tests) and the A2 visual spec pass.
