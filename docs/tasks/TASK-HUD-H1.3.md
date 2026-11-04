# TASK-HUD-H1.3: token rings (HP-left / Stress arcs, Hope chip, condition badges, side colours)

Status: Review. Plan `.omc/plans/combat-hud.yaml`, tracer H1.3 (wave 2; boards CmpTokens, Main, GMDesktop). Briefs:
`.omc/plans/combat-hud-briefs.md` (answers 2 and 10a). Depends on H0 (switch, HudProvider) and HD1 (`combatHud.party`
Hope, condition names on `playerView.others`). Read only: no Convex change.

## What landed

- **`hud/token/`** (new):
  - `model.ts`: pure functions both token layers share. `toneOf` (you gold, ally PC teal, ally NPC mint, neutral grey,
    adversary red), `arcsOf` (percent of each half: HP LEFT on the left, Stress MARKED on the right, answer 2),
    `showsNumbers(role, kind)` (the GM always, a player only on PCs: hard rule 2), `pcTokenFace` (a token from
    `tokens-layer.tsx`) and `otherFace` (a player's `others` token), each giving the face, the button's accessible name
    and the sheet a click opens. Names: `Open Moss’s sheet (your character), 2 of 6 Hit Points marked, 3 of 6 Stress
    marked, 1 Hope, Vulnerable`; GM adversary `Open the Jagged Knife Lieutenant’s stat block, 2 of 6 Hit Points marked,
    1 of 3 Stress marked, Restrained`; a player's adversary `Jagged Knife Bandit, Enemy, Restrained[, revealed to you][,
    your target]`; a GM custom token `Merchant, Neutral, 2 of 6 Hit Points marked, …`.
  - `face.tsx` `TokenFace`: the board's anatomy, centred on the token button (`--s` = footprint): `svg.tk-arc`
    (viewBox −50..50, two `a-bg` halves, `a-hp` / `a-st` with `pathLength=100` and `stroke-dasharray="n 100"`),
    `.tk-face` (portrait through `next/image`, `unoptimized` for remote URLs, CL10; or Cinzel initials), `.tk-name`,
    `.tk-hope` gold chip top right, `.tk-cd` condition badges bottom right (the board's icons for Hidden, Vulnerable,
    Restrained; other conditions show their initial; more than three show `+n`). aria-hidden: the button's name says
    everything.
  - `token.css` (board `.tk-*` rules under `.hud-tk`, colours from H0's `--hud-*` tokens), `hooks.ts`
    (`useHudTokens(mode)`: the HUD state when the face shows, else null; `useTokenHope` reads `combatHud.party` only
    then; `useOptionalHud`), `index.ts`.
- **`tokens/tokens-layer.tsx`**: with the face on, each token button keeps its footprint, handlers, data attributes,
  facing arrow, light badge and turn knob, drops the classic background / border / bar / letters, and draws
  `TokenFace`. A click without a drag (or Enter / Space) still selects and also calls `toggleSheet` (PC: `{ kind: "pc" }`;
  GM on an adversary: `{ kind: "adversary", tokenId }`) so H2.1 / H5.2 only have to draw the panel. Arcs: PCs for
  everyone, adversaries and custom tokens for the GM.
- **`vision/vision-layer.tsx`**: a player's other tokens draw `TokenFace` with `otherFace` (side colour, condition
  names from HD1, revealed / target in the name, never an arc, Hope or number); clicks still select and target (CA5).
- **When the face shows**: switch on AND Play AND inside the HUD shell's `HudProvider` (exactly when `page.tsx` renders
  the shell). The classic page and the Encounter tab's map pane never mount the provider, so with the switch off (or in
  Edit, or on the Encounter tab) both layers render exactly as before (every classic branch unchanged).

## Board states matched

Shots: `test-results/visual/HUD-H1.3/` from `tests/e2e/visual/HUD-H1.3.spec.ts` (`E2E_VISUAL=1`, real seed, Moss 2 HP /
3 Stress marked, Brannoc Hidden, the Lieutenant 2 HP / 1 Stress and Vulnerable):
`gm-tokens-{1440,1024,390}.png`, `player-tokens-{1440,1024,390}.png`, `gm-closeup-1440.png`, `player-closeup-1440.png`;
the board render beside them: `board-cmptokens-tokens.png` (CmpTokens "Token anatomy").

- CmpTokens "Token anatomy": red arc left (HP left), blue arc right (Stress marked), gold Hope chip, badge bottom right,
  name tag below. Matched.
- "Token kinds": your token gold + glow, ally PC teal `#9fd8c4`, ally NPC mint `#9fd8b0`, neutral grey, adversary red
  `#c0392b`; "Adversary · GM" with arcs and a badge, "Adversary · player" without numbers. Matched (player view: no ring
  on any adversary).
- Main / GMDesktop: tokens on the full-bleed map. The map's square size is the app's (zoom), not the board's 48 px.

Deviations: the classic facing arrow, turn knob and carried-light badge stay on the HUD token (facing drives vision; the
boards do not show facing). Name tags always show (as on the board), not only on hover / with Names.

## What moved out of the old column

Nothing: tokens are map layers. The token card and Combatants stay in the Map tools drawer.

## Tests

- `tests/unit/hud/token-face.test.tsx` (12): tones, arcs (HP left / Stress marked percent), `showsNumbers`, PC / GM
  adversary / player adversary / custom / other labels ("n of N … marked"), a player never gets an adversary arc, Hope,
  stat block or digit (also from a stray stats object), Hope by token, `TokenFace` DOM (pathLength 100, dasharray, chip,
  badges, `+n`, down, art vs initials).
- `tests/e2e/hud-tokens.spec.ts` (2, passed): GM: Moss teal with arcs / Hope / Vulnerable badge and the marked name; the
  Lieutenant red with arcs and its stat-block name; 8 arcs on the map; click toggles `sh-open sh-<tokenId>` /
  `sh-<characterId>`; ArrowUp moves the focused token; axe. Player: Moss gold, Brannoc teal with Hope; the Lieutenant
  and Bandit red with condition badges and names, no `.tk-arc` / `.tk-hope` under any enemy, 4 arcs in all, no digit in
  any enemy button's name or text, the hidden Bandit absent; live: the GM marks an HP on Moss and the ring and name
  follow; a click on Brannoc opens his sheet, a click on the Lieutenant targets it; drag and ArrowLeft move Moss; axe.
- Classic specs (switch off) run on this branch: `combat-tokens`, `combat-light-uploaded`, `combat-map-flow` (×2),
  `combat-map-shell` (×3), `session-encounter` (×2), `sheet-drawer` (×2): pass. `combat-vision.spec.ts` fails at line 172
  (Nautical Dawn reads "Dim light", expected "Daylight") on `rebuild` too, with this tracer's layer files reverted:
  pre-existing, filed dcm-aid9.

### Checks

- `pnpm lint`: clean (0 warnings). `pnpm typecheck`: clean.
- vitest `--maxWorkers=1 --testTimeout=120000`, full suite: 444 / 444 files, 10130 passed + 1 expected fail.
- e2e on this worktree's ports: `hud-tokens` 2 / 2, `hud-shell` 2 / 2, the classic specs above 12 / 12, the
  `HUD-H1.3` visual spec 1 / 1.

### Edit outside owns (forced)

- `tests/e2e/hud-shell.spec.ts` (H0's spec, line 48): it found the GM's Lieutenant by `^<name>,`; with H1.3 the GM's
  adversary tokens are named "Open the <name>’s stat block, …" (this block's acceptance), so the regex now reads
  `^Open the <name>’s stat block`. One line; both H0 tests pass.

## Beads

- Filed dcm-aid9 (combat-vision.spec.ts line 172 fails on `rebuild`, unrelated to H1.3).
- None done (dcm-bxp.99.32.8 was HD1's).

## Data gaps

- None for the face. Conditions have no source / duration yet (dcm-bxp.99.32.1); the badge shows the name only.

## QUESTIONS

1. Clicking a token now does two things with the HUD on: selects it (the drawer's token card, R / Delete keys, keyboard
   moves) and opens its sheet / stat block (`toggleSheet`; the panel is H2.1 / H5.2, so nothing shows yet). A drag never
   opens it. Should clicking your own token open your sheet, or (after H3.4) the action ring? Built: the sheet; H3.4
   decides the ring.
2. Conditions without a board icon (Cloaked, Unconscious, Distracted) show their initial in the badge. OK until a
   designer adds icons? (a) initial (built) (b) a generic dot.

## Merge-time actions

- None: no Convex, schema or authz change; no codegen.
- Merge after H0 (needs `hud/flag.ts`, `hud/state.tsx`) and HD1 (`combatHud.party`, `others[].conditions`).
- `tests/e2e/hud-shell.spec.ts` changed one line (above); keep it if another tracer touches that spec.
