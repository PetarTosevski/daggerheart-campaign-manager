# TASK-SR-S0: Board sheet shell, tokens, shared primitives, section split and mount points

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S0 (wave 1, foundation). Analysis: `.omc/autopilot/sheet-redesign-analysis.md`.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Shell (C/sheet.tsx):** dark backdrop (`cs-backdrop`) and parchment paper (`cs-paper`, max 1180 px, padding 24/28/32, radius 14). The header row is: domain banner | `Sheet pages` tablist | level circle with LevelUpButton | round × link (44 px). After the header come the death-move strip, the live error box and the three tabpanels. The footer reads "All changes save automatically." / "Updates live as the table plays.", with the read-only note on its left. The back link and the "Party · Character sheet" kicker are gone.
- **Open question, default taken:** the sheet stays a route (`/campaigns/<id>/party/<characterId>`). × is a `Link` to the roster.
- **Pages:** Character Sheet · Story & Advancement · Domains. Domains has a second tablist, `Card collections` (board `dk-tabs`), with Domain Cards and Heritage & Subclass and a count badge on each. Both tablists use arrow keys, Home/End, a roving tabIndex and aria-controls (`nextTabIndex` in C/sheet-helpers.ts).
- **One file per section** under C/sections/, each with an empty colocated `.css` that it imports: header, identity, defence-hope, hp-stress, equipment, class-features, downtime, frame-extras, status, story, domains, heritage. page-one/two/three.tsx only compose sections.
- **Shared hooks and helpers:**
  - `useMotherboard()` and `useDefense()` live in C/sheet-context.tsx. They give Evasion and Armor Score with effects and augments, and are used by defence-hope, hp-stress and equipment.
  - `FeatureText` lives in C/fields.tsx.
- **Tokens:** `--sheet-paper, --sheet-ink, --sheet-ink-soft, --sheet-label, --sheet-gold, --sheet-gold-line, --sheet-line, --sheet-field-line, --sheet-green, --sheet-green-bright, --sheet-wine, --sheet-red, --sheet-blue, --sheet-backdrop`. They are defined once, on `:root`, in C/sheet.css. Shell and grid classes are also in C/sheet.css: `cs-head`, `cs-head-end`, `cs-close`, `cs-foot`, `cs-error`, `dk-tabs`/`dk-tab`/`dk-tabn`, `cs-page`, `cs-top`, `cs-col`, `cs-grid`, `cs-grid-story`, `cs-grid-text`, `cs-span-2`.
- **Primitives:** `src/components/party/sheet-ui/` (index.tsx + sheet-ui.css) exports:

  | Export | What it is |
  |---|---|
  | `SheetBox` | `sh-box` + `sh-h`; a region named by its title, or by `label` |
  | `Label` (`sh-lbl`), `Small` (`sh-small`) | Field label and body note |
  | `PaperInput` (`sh-in`), `PaperTextarea` (`sh-ta`), `PaperNumber` (`sh-num`) | Paper fields; `paperField.locked` gives `sh-in sh-locked` |
  | `Pill` | Variant `mark` (dmg-mark outline), `solid` (wine) or `roll` (gold to purple) |
  | `SlotRow` | 12 columns; 6 × 44 px at phone width |
  | `Pip` | Kinds heart, diamond, armor, coin, scar, sword. Coin and scar need `HOPE_COIN_STYLE` on an ancestor |
  | `PaperModal` | Native `<dialog>` + `showModal()`: Cinzel title, optional subtitle, 44 px close named "Close <title>", `actions` slot. Button classes `sh-modal-cancel` and `sh-modal-ok` |
  | `Launcher` | `cs-launch` + `cs-open` |
  | `Badge` | Tone dark (FALLEN), wine, paper or green |
  | `EffectRow` | Dashed gold row with an End button |

  Below 640 px, pills, pips and effect buttons are at least 44 px.
- **Visual tooling:**
  - `tests/e2e/visual/helpers.ts`: `openSheet(page, {frame, draft, extra})`, `openTab`, `expectNoHorizontalScroll`, `visual(page, tracer).shoot(locator, name)`. Shots go to `test-results/visual/<tracer>/<name>-{1440,390}.png`.
  - `playwright.config.ts` skips `@visual` unless `E2E_VISUAL=1`.
  - `scripts/board-shots.mjs <region...>|all` shoots the board, opened from disk, into `test-results/visual/board/`. Run it with no arguments to list the regions: sheet-p1, sheet-p2, sheet-p3, sheet-p3-hero, header, level-circle, portrait, experiences, identity, traits, transformation, defence, hope, dice, hp-stress, weapons, armor, class-features, downtime, wealth, inventory, description, background, connections, level-up-head, level-up, domains, loadout, domain-deck, hero-cards.
  - The board's overlays (csComp, csBeast, advPick) are not regions yet. The Test Bard is neither a Druid nor Beastbound, so S7 and S8 add them if they need them.

## Mount points (where wave 2 plugs in)

| Slot / component | File (owner in wave 2) | Mounted in | S0 state |
|---|---|---|---|
| `HopeFeatureSlot` | `src/components/party/features/index.tsx` (S6) | Hope box, after the class Hope feature text (sections/defence-hope.tsx) | stub, returns null |
| `FeaturesPanel` | features/index.tsx (S6) | Class Features box (sections/class-features.tsx) | unchanged panel; still contains the Hope feature |
| `ClassExtras` (Beastform, Companion) | `src/components/party/extras/character-extras.tsx` (S7) | Class Features box, first | split from CharacterExtras, same rendering |
| `FrameExtras` (Motherboard, Beast Feast, Castle High) | extras/character-extras.tsx (S7) | Frame extras region after the Armor+Class Features / Downtime row (sections/frame-extras.tsx) | split from CharacterExtras, same rendering |
| `AdvancementTiers` | `src/components/party/level-up/index.tsx` (S8) | Story & Advancement, between the text row and Notes (page-two.tsx) | stub, returns null |
| `LevelUpButton` | level-up/index.tsx (S8) | Header row, before × | now renders the 66 px level circle itself, followed by the existing buttons; S8 turns it into the lvl-wrap |
| `WitherCounter` | `src/components/party/wither/` (S3) | Last item of the Hit Points & Stress box | unchanged |
| `DamageCalculator` | C/damage-calculator.tsx (S3) | Hit Points & Stress box | unchanged |
| `RestPicker` | `src/components/party/rest/` (S10) | Top of the Downtime box (sections/downtime.tsx) | unchanged; a one-line placeholder note follows until S10 adds the reference text |
| `DeathMoveModal` (+ badges) | `src/components/party/death/` (S9) | `SheetDeathMoves` in sections/header.tsx, under the header row | unchanged |
| `SheetDiceBox` | `src/components/party/dice/` (S5) | Full width between Defence/Hope and HP/Weapons (page-one.tsx) | unchanged |
| Status badge `character-status` | sections/header.tsx (S9) | In the banner | moved from the old second header row |
| `StatusControls` | sections/status.tsx (S9) | End of page 1 | unchanged |

Page 1 order: identity top (`cs-top`: portrait + Experiences | identity grid + traits) → Defence | Hope → Dice → Hit Points & Stress | Active Weapons → (Active Armor + Class Features) | Downtime → frame extras → Status.

Page 2 order: Wealth | Inventory (spans 2 at ≥ 900 px) → Character Description | Background Questions | Connections → Level Up (AdvancementTiers) → Notes.

Page 3: the Domain Cards sub-tab (domains box, loadout felt, vault) or the Heritage & Subclass sub-tab (hero cards).

## Frozen for wave 2: accessible names and testids

Do not rename these. A wave-2 tracer that must change one updates every spec that uses it; if it does not own those specs, it stops and reports.

- **Paper:** the `article` is named by `h1#sheet-title`, which holds the character name (specs use `getByRole("article", { name: hero })` and `getByRole("heading", { level: 1, name: hero })`).
- **Tabs:**
  - tablist "Sheet pages" with tabs "Character Sheet", "Story & Advancement", "Domains"; panels are named by their tab;
  - tablist "Card collections" with tabs "Domain Cards" and "Heritage & Subclass". The count badge is `aria-hidden`, so the names are exact.
- **Shell:**
  - link "Close character sheet" → `/campaigns/<id>/party`;
  - img "Level N";
  - `role=alert` error box;
  - testid `read-only-note` (footer).
- **Regions (SheetBox titles):**
  - Page 1: "Experiences", "Defence", "Hope", "Hit Points & Stress", "Active Weapons", "Active Armor", "Class Features", "Downtime", "Status".
  - Page 2: "Wealth", "Inventory", "Character Description", "Background Questions", "Connections", "Notes".
  - Page 3: "Domains".
  - Slot regions: "Dice", "Last roll", "Features" (inside Class Features; Playwright's substring match finds it there), "Downtime moves", "Wither tokens", "Death moves".
- **Lists:**
  - "Traits", "Inventory";
  - "Loadout cards", "Vault cards", "Heritage and subclass cards";
  - "Active effects", "Held dice", "Conditions".
- **Groups and controls:**
  - groups "Hit Point: n of m marked", "Stress: …", "Hope: … [, k lost to scars]", "Armor Slot: …", "Character status";
  - buttons "Hit Point k of m", "Stress k of m", "Hope k of m", "Increase/Decrease Scars", "Increase/Decrease Hit Point slots", "Increase/Decrease Stress slots", "Apply", "Move to vault", "Move to loadout (…)", "Level up to N", "Undo level N", "Advancements";
  - fields "Damage roll", "Use an Armor Slot…", "Base Evasion", "Primary weapon", "Secondary weapon", "Active armor", "Swapping during a rest…", textbox "Notes";
  - img "Evasion N", "Armor Score N", "Proficiency N";
  - articles "Subclass: <name> <tier>[ (locked)]" and the card names;
  - dialog "Level up to N".
- **Testids:**
  - `evasion`, `threshold-major`, `threshold-severe`, `primary-damage`, `secondary-damage`;
  - `read-only-note`, `character-status`, `no-open-rest`;
  - `ikonis-weapon`, `ikonis-augments`, `ikonis-damage`;
  - `last-roll`, `death-unconscious`, `death-away`, `death-journey-ends`, `wither-tokens`, `level-up-pending`;
  - `character-extras` (now on FrameExtras only), `class-extras` (new, on ClassExtras).

## Deviations (deliberate)

- **Banner heading:** the banner's heading is the character's name (the page `h1`, which names the article) at 28 px. The class name follows at 20 px, then the domain emblems and names. The board shows only the class as its heading, but the route needs a visible `h1` naming the sheet. Pronouns left the header (they stay in the identity grid).
- **Dead badge:** it reads "Dead" in the board's dark FALLEN colours. S9 owns the wording.
- **Header wrap:** at 1440 the level circle, "Level up to 2", "Advancements" and × wrap onto a second header line, because the level-up buttons are still separate pills. S8 folds them into the circle (▲ / −), which brings the row back to one line.
- **Nested Features box:** FeaturesPanel keeps its own `cs-box` inside Class Features, so there are two nested boxes until S6 restyles it.
- **Downtime box:** it holds a one-line placeholder until S10 adds the board's SHORT REST / LONG REST text.
- **Gold & Inventory:** the old box is split into the board's Wealth and Inventory boxes on page 2. Region names changed: "Description" → "Character Description", "Background" → "Background Questions" (no spec used the old names).
- **Old cs-* rules:** they stay in sheet.css for the content not yet restyled. S13 deletes the unused ones.

## Visual comparison (S0: whole pages)

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| header | test-results/visual/S0/header-{1440,390}.png | test-results/visual/board/header-{1440,390}.png | Layout: same order (banner, tabs, level, ×); level-up pills wrap (S8). Type and colour: match (Cinzel, wine tab, double ring). At 390 the app stacks; the board clips its tabs. |
| sheet-p1 | S0/sheet-p1-* | board/sheet-p1-* | Layout: board order and grids. Type and colour: paper and boxes match. Box contents are the pre-redesign controls (wave 2). No Transformation box (needs user confirmation). |
| sheet-p2 | S0/sheet-p2-* | board/sheet-p2-* | Layout: Wealth \| Inventory (span 2), three text boxes, Notes. Level Up tiers missing until S8. Pips, chest and lined questions come with S11. |
| sheet-p3 | S0/sheet-p3-* | board/sheet-p3-* | dk-tabs sub-tabs with counts match. Loadout is a card grid, not the fanned hand (S12). No Domain Deck (needs user confirmation). |
| sheet-p3-hero | S0/sheet-p3-hero-* | board/sheet-p3-hero-* | Hero cards in a grid; board hc styling comes with S12. |

At 390 there is no horizontal scroll on any page: `shoot` asserts `scrollWidth <= 390`.

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed. `tests/unit/sheet-render.test.ts` has a new shell test (tabs, sub-tabs, keys, close link).
- e2e on ports 3165/3442, 31 passed: character-sheet, equipment-tiers, dice, dice-3d, class-features, class-features-hf, hope-features, level-up, rest, rest-frame-hooks, death, wither, motherboard-ikonis, party-roster, character-wizard.
- `E2E_VISUAL=1` S0 visual spec: passed.

## Found outside owns (for the orchestrator)

- On the `rebuild` tip the local Convex push fails with `Failed to analyze actionLog.js: Cannot read properties of undefined (reading 'asOptional')` at `convex/characters.ts:582`: `wither: v.optional(witherGainValidator)` is undefined at load time because of a circular import (actionLog → lib/actionLog → characters → wither → …). Every fresh worktree's `pnpm e2e:setup` fails until this is fixed.
- For the e2e runs above, S0 changed that line locally to `v.optional(v.any())` and reverted it before committing.
- Suggested fix: move `witherGainValidator` into `convex/lib/validators/` and import it from there in both modules.
