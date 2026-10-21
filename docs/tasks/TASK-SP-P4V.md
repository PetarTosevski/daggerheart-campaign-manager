# TASK-SP-P4V: Village extra sheet (town-street-and-market/large-2)

Status: Done. Plan: `.omc/plans/sprite-packs.yaml`, tracer P4V (depends on P4). Bead: dcm-bxp.56.

## Request this tracer implements

User (2026-10-21): the village sheet from the cottage prompt, saved as
`/mnt/c/Users/Petar/sprite-sheets/town-street-and-market/large-2.jpg`. Items in reading order: thatched cottage,
stone cottage, timber barn, wooden fence section, wooden fence gate, vegetable garden plot, haystack, woodpile
with chopping block, chicken coop with fenced run. They are new catalog items, not variants (P4 answer 1), added
through P4's `extras` mechanism (docs/tasks/TASK-SP-P4.md, "Extra sheets").

## The nine items

All are `town-street-and-market/<slug>`, `extraSheet: "large-2"`, `standIn: false` (the mapping tables do not use
them for Classic objects; they are placed by sprite ref), light none.

| # | Key | Size (squares) | Sight | Height | Footprint | Classic kind |
|---|---|---|---|---|---|---|
| 0 | thatched-cottage | 3 x 3 | block | tall | rect | pillar |
| 1 | stone-cottage | 3 x 3 | block | tall | rect | pillar |
| 2 | timber-barn | 3 x 4 | block | tall | rect | pillar |
| 3 | wooden-fence-section | 3 x 1 | cover | low | rect | log |
| 4 | wooden-fence-gate | 3 x 1 | cover | low | rect | log |
| 5 | vegetable-garden-plot | 3 x 3 | none | flat | rect | rubble |
| 6 | haystack | 2 x 2 | block | tall | circle | boulder |
| 7 | woodpile-with-chopping-block | 2 x 1 | cover | low | rect | log |
| 8 | chicken-coop-with-fenced-run | 2 x 2 | cover | low | rect | crate |

- **Scale:** every existing large item is 2 x 2 or 2 x 1 (town house corner, wagon, guard post 2 x 2; grassland
  farmhouse corner 2 x 2). A whole cottage is bigger than a house corner, so cottages are 3 x 3 and the barn
  3 x 4 (it is drawn portrait); fence and gate are 3 x 1 (drawn very long and thin); the garden plot 3 x 3; the
  haystack, coop 2 x 2; the woodpile with its separate chopping block one 2 x 1 sprite. Items on an extra sheet
  may take any size within 1..4 (the catalog test allows it; a non-square one must be rect).
- **Traits:** the catalog has no movement or difficult-terrain trait, only sight / height / light / footprint
  (no new trait type was invented). Buildings block sight (like house corner); fence and gate are cover (like
  the crypt's iron fence section): low enough to see over. The garden plot is flat, sight none (flat things cast
  no shadow and never block). Haystack copies grassland-and-road's haystack; the woodpile follows the rotting log
  and crate stack (cover, low); the coop is cover (its hut is small and the run is netting).

## Cutting

`large-2` cuts 9/9 (connected components; fringe 0.091 -> 0.000). The soft purple drop shadows key out with the
magenta in the normal key (magenta-leaning pixels left: 0 to 6 per sprite, all edge pixels at low alpha).

The coop's run is not semi-transparent in the sheet: it is an opaque rose-brown fill (e.g. RGB 177,110,102) with
the net drawn over it, so `unmix` cannot help (it kept the pink and turned the purple shadow into a grey haze; tried
and dropped). New override **`untint`** (`scripts/sprite-packs/lib/pipeline.ts` `untint`,
`overrides.ts`): `{cutIndex: [[x0, y0, x1, y1], ...]}` areas in fractions of the cut; inside them every rose /
pink pixel (red over green, blue at least 0.8 of green) is pulled 75 % toward its luminance and its blue capped
at 0.88 of the green: warm grey-brown packed earth. The areas cover the run only, because the hut's brown wood
passes the same colour test (applied to the whole cut it turned the hut grey-green). Override:
`"town-street-and-market/large-2": { "untint": { "8": [[0.52, 0.44, 1, 1], [0.47, 0.63, 1, 1], [0.6, 0.36, 1, 0.44]] } }`.
The hut's painted shadow on the run stays as a darker grey patch (part of the art).

## Results

- Built-in pack: 589 sprites (580 + 9), 589 files, 0 missing; 8,453,644 bytes. Only the nine new WebP files and
  nine manifest lines changed; every existing file is byte-identical.
- Contact sheet of the nine (white | grass halves): `sprite-sheets/_out/contact-village-large-2.png` (git-ignored).

## Acceptance evidence

- `tests/unit/sprite-catalog.test.ts`: the doc's `- large-2:` line matches the catalog's extras; the nine items'
  index, size, sight, height, footprint, light and standIn; the town haystack equals grassland's; key count
  20 x 29 + 9; size rule for extra-sheet items.
- `tests/unit/sprite-builtin-pack.test.ts`: 589 sprites, every village key has art; `untint` changes rose inside
  its areas and leaves brown wood and pixels outside alone.
- `pnpm lint`, `pnpm typecheck`, vitest pass; `pnpm tracer:guard .omc/plans/sprite-packs.yaml P4V` passes.
