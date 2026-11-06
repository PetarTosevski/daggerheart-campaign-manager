# Glass buttons: tracer briefs (2026-11-04)

Plan: `.omc/plans/glass-buttons.yaml` (3 waves, 17 tracers, two of them conditional;
`node scripts/plan-check.mjs .omc/plans/glass-buttons.yaml` OK). Design: `reference/designs/buttons/arcane-glass.html`
(open it in a browser and use the Player / GM switch). Bead: dcm-q861 ("Button overhaul part 2").

**Start condition.** Wave 1 (G0) starts only after the journal plan's **JX2 is merged** into `rebuild`. JX1 / JX2 own
`campaign-shell.tsx`, `campaign-sections.ts`, `wither-panel.tsx`, the `/sessions` and `/notes` routes and many specs,
and JX2 deletes `src/components/sessions/**` except `session-chip.tsx`. Re-run the inventory greps below once JX2 has
landed (the sessions folder's 25 buttons disappear; Journal counts change).

**Status.** The plan follows the recommended answer of every question at the end of this file. If the user picks
another option, the orchestrator rewrites the named tracers' acceptance before launching them. G14 and G15 (character
sheets) are skipped under the default answer to Q3.

## What is already done

The Combat HUD uses the design (commit 6d1d2929; leftovers closed in dcm-h77e.9):

- `src/components/brand/glass-button.ts`: `glassButtonClass({ role, tone, size, icon, round })` returns `gb gb-<role> …`.
  Roles: confirm, cancel, neutral, tool, danger, allow, deny, normal, advantage, disadvantage. Tones hope / fear. Sizes
  sm 34 px, md 44 px, lg 54 px.
- `src/components/brand/glass-button.css`: the design's shipped block as `.gb` classes, `--gb-*` tokens on `:root`, the
  ember fill darkened for 4.5:1, `aria-pressed` = switched on, disabled / `aria-disabled`, reduced motion.
- The HUD root sets `data-viewer="gm" | "player"` (`hud/shell.tsx`); `hudButtonClass` in `hud/ui/popup.tsx` adds the
  HUD's layout class. Without an ancestor `data-viewer`, the player's colours apply.

The design's own scope line: "Every button outside the character sheets and the card face. … Character sheets and the
card face (`.hc-face`) keep their own buttons." (Q3 asks whether that still holds for the app-wide rollout.)

## Inventory (src/** outside `combat-map/hud/**`, `rebuild` at ccd41063)

Counted with a script over every `<button>` and every `BrandButton` / `brandButton(…)`; buckets are by class name, so
they are approximate.

- **brandButton / BrandButton:** 78 uses in 36 files. By variant: outline 34 (17 of them by default), solid 14,
  pill 13, primary 9, danger 5, dangerSolid 2, one switches solid / dangerSolid.
  - At least 11 of the outline ones are back-out buttons ("Cancel" ×5, "Keep it" ×2, "Not now", "Back", "Close",
    "Done"). The central change makes them neutral; the area tracer makes them cancel.
  - `end-scene.tsx` "End scene" is `primary` today; it becomes danger.
- **Raw `<button>`:** 727 in 188 files. Buckets:
  - about 478 action buttons;
  - 49 rows or links;
  - 32 steppers (+ / −);
  - 30 chips / pills;
  - 22 marked as removal;
  - 19 tabs / segmented;
  - 71 with no class or a computed one.
  - Of the action buttons, 121 use the Combat Map's `cm-btn` / `cm-go` class.
- **Links styled as buttons:** 26 `<Link>` / `<a>` in 20 files (11 with brandButton).
- **Shared hand-styled constants:**
  - `TRACKER_BTN` (`trackers/tracker-card.tsx`, 38 uses);
  - `BTN` in `countdowns/shared.ts`, `party/dice/{free-roll,roll-feed,tick-countdowns}.tsx` and `party/extras/ui.tsx` (with `ALT_BTN`);
  - `STEP`, `STEP_BTN`, `SMALL_BTN`, `DATA_BUTTON`, `ITEM`, `LINK`.
- **Per-area CSS button classes:**
  - `cm-btn`, `cm-go`, `cm-linkbtn`, `cm-pv-btn`;
  - `trk-btn*`, `trk-act`, `trk-spot-btn`;
  - `adx-btn` / `-primary` / `-danger`, `enc-ghost` / `-danger` / `-pill-primary`, `env-act`;
  - `cx-ghost`, `zbtn`;
  - `lk-act`, `lk-send`;
  - `bj-ghost`, `bj-act`, `bj-danger`, `bj-paper-btn`, `bj-*-btn`;
  - `jr-ghost`, `jh-` / `js-` / `jp-menu-btn`, `jp-` / `js-danger`, `jl-add-btn`, `jrr-btn`;
  - `wz-ghost`, `wz-primary`;
  - `xs-btn`, `hf-ghost`, `dk-btn`, `dkc-btn`, `ih-btn`, `ab-pop-btn`.
- **Modals:** `brand/modal.tsx` (native `<dialog>`, stays in the DOM under the shell, so `data-viewer` reaches it); its
  ✕ is hand-styled. Portals to `<body>`: `cards/card-dialog.tsx` (card face, out of scope) and the notes bin toast.
- **Removal / ending actions:** about 58 buttons in 38 files, for example:
  - Delete / Delete permanently (chronicle, codex, maps, packs, conversations);
  - Remove (roster, import, tokens);
  - Revoke (players);
  - End scene (dashboard, tracker, Combat Map);
  - Interrupt / Undo rest;
  - End session (Journal header).
- **The GM answering a player's request outside the HUD:** `combat-map/requests/index.tsx`, Difficulty requests: Roll
  becomes allow, Decline becomes deny.
- **Toolbar / icon buttons:**
  - the app bar (`app-bar/*`, `brand/brand.tsx`);
  - World Map zoom (`zbtn`);
  - Combat Map edit tools, grid controls and vision panels;
  - Lorekeeper fold toggles.

### Per area

| Area (tracer) | Files | Raw buttons | brandButton |
|---|---|---|---|
| Outside a campaign + app bar (G1) | 13 | 28 | 26 |
| Dashboard + shell + Tome (G2) | 16 | 30 | 9 |
| Countdowns + frame trackers (G3, G4) | 12 | 80 | 9 |
| Party page, wizard, import, rest, level-up (G5) | 9 (+ CSS-only) | 30 | 15 |
| Codex + World Map (G6) | 14 | 70 | 0 |
| Lorekeeper (G7) | 13 | 42 | 0 |
| Adversaries library (G8) | 13 | 57 | 0 |
| Adversary tracker (G9) | 8 | 32 | 0 |
| Combat Map edit side (G10) | 21 | 113 | 0 |
| Combat Map play side outside the HUD (G11) | 10 | 36 | 0 |
| Journal (G12) | 12 | 39 | 13 |
| Notes (G13) | 13 | 32 | 1 |
| Character sheet pages + panels (G14, G15; Q3) | 21 + 9 dice / extras | 77 + 30 | 2 |
| Old Sessions UI (deleted by JX2) | 9 | 25 | 0 |

## Role map (every tracer applies it)

| What the button does | Role | Player sees | GM sees |
|---|---|---|---|
| The main action of a dialog, card or page (Save, Create, Start, Roll, Send, Choose this Frame) | confirm | Hope gold | Fear purple (Q1) |
| Backs out (Cancel, Back, Not now, Keep it, Close ✕, Undo, Done-without-saving) | cancel | Fear purple | Hope gold |
| Removes or ends something (Delete, Remove, Revoke, End scene, End session, Interrupt rest) | danger | ember red | ember red |
| The GM's yes / no to a player's request (Difficulty Roll / Decline) | allow / deny | gold / purple | gold / purple |
| Everything without a side (settings, Invite, New code, Add row, Link, Reset counts, panel actions) | neutral | grey glass | grey glass |
| Toolbar icons and palette tools (zoom, map tools, app-bar icons) | tool | clear until hover; gold when on | same |
| Switches with two or three options, filter chips (Q6) | neutral + `aria-pressed` | gold glass when on | same |
| Normal / Advantage / Disadvantage | normal / advantage / disadvantage | Hope / Fear | Fear / Hope |
| + / − steppers and small ✕ remove (Q7) | neutral icon, small | grey | grey |

Leave alone: the HUD; the card face (hero card, card dialog, `.hc-face`); map tokens, hexes, pins and sprite art;
HP / Stress / Hope / Armor pips; page tabs (`role="tab"`); list rows that open something; plain text links; 3D dice.
Disabled: grey glass with the reason next to it (design). Where a page has two confirms side by side, only the main
one is confirm; the other is neutral.

## Approach

1. **One central change (G0).** `brandButton` keeps its call signature and returns glass classes. Mapping:
   - primary → confirm (large);
   - solid → confirm;
   - outline → neutral;
   - pill → neutral (shape per Q8);
   - danger and dangerSolid → danger;
   - sizes: sm → small, md → 44 px, lg / xl → large.

   The 78 existing uses change look with no edit.

   G0 also adds explicit variants for every design role (confirm, cancel, neutral, tool, danger, allow, deny, normal,
   advantage, disadvantage, plus icon / round), and keeps the old names as aliases until GZ. `glassButtonClass` stays
   the single source; `hudButtonClass` is untouched.
2. **The viewer is known once.** The campaign shell's root `<div>` gets `data-viewer={campaign.role === "gm" ? "gm" :
   "player"}`. Everything inside a campaign, including native `<dialog>` modals, inherits it. The Combat HUD keeps its
   own attribute, which has the same value.

   `src/components/brand/viewer.tsx` gives portalled content the same attribute from `useCampaign()` (only the notes
   bin toast needs it today). Outside a campaign (sign-in, main menu, new campaign, settings, join) there is no
   attribute, so the player's colours apply (Q2).
3. **Then each area moves its hand-styled buttons onto `BrandButton` / `brandButton`** with the role from the role map
   and deletes its dead CSS classes. These are 14 parallel tracers whose owns never overlap. `cm-btn` sites drop the
   class (they do not stack `cm-btn` and `gb`); GZ deletes the `.cm-btn` rules once nothing uses them.
4. **Cascade (decide in G0, write it down).**
   - `glass-button.css` is unlayered, so it beats every Tailwind utility. A call site's `px-7` or `rounded-full` loses;
     `w-full` / `self-start` / `ml-auto` still work, because `.gb` does not set them.
   - G0 either keeps it unlayered and the tracers strip conflicting utilities, or moves it into `@layer components`
     after checking that the layer order (theme, base, components, utilities) is declared before the file loads.
   - Either way the HUD shots must not change.
5. **Touch, contrast, motion.**
   - Small (34 px) becomes 44 px under `@media (max-width: 1100px), (pointer: coarse)`, which is the app's existing
     breakpoint (journal / plan / log css, HUD ui.css).
   - `.gb` uses a fixed height and `nowrap`. G0 gives brandButton a min-height and lets labels wrap where they can,
     so no label is clipped (the HUD keeps its own rules).
   - Contrast: the ember fill was already darkened for 4.5:1. Every tracer runs axe with a button hovered as well,
     because the hover fill swaps the text colour.
   - Reduced motion: the fill and colour change are instant (already in the CSS); G0 asserts it.
6. **Clean-up (GZ).**
   - Drop the old variant names, dead CSS and the unused shadcn `ui/button.tsx`.
   - Add a vitest guard against new hand-styled action buttons; per the rules, a lint rule would land as a warning
     first, and the guard is enough here.
   - Run the full e2e suite and `pnpm build`.

## Batches and launch order

| Wave | Batch | Tracers | Start |
|---|---|---|---|
| 1 | - | G0 | after the journal plan's JX2 is merged and the user has answered Q1-Q3 |
| 2 | A | G1, G2, G5, G12, G13 | when G0 is merged (the pages people see most) |
| 2 | B | G3, G4, G6, G7, G8 | as batch A slots free up |
| 2 | C | G9, G10, G11 (+ G14, G15 only if Q3 = b / c) | as slots free up |
| 3 | - | GZ | every wave 2 tracer that ran is merged (add G14 / G15 to its depends_on if they run) |

At most 5 at once. No tracer touches Convex, so no codegen is needed between merges. G9 and G11 both touch End scene:
G11 owns `EndSceneButton` (`combat-map/actions/scene`), and G9 only passes a class from the tracker's top bar.

## Common rules (every tracer)

- Read CLAUDE.md, AGENTS.md, docs/workflow.md, docs/best-practices.md (React / UI sections), docs/testing.md, this
  brief, your block in `glass-buttons.yaml`, the design file, and `docs/tasks/TASK-GLASS-G0.md`.
- First step, before any edit: `git switch -C glass-<id> rebuild` (e.g. `glass-g3`). Then
  `node scripts/worktree-setup.mjs` and `E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm e2e:setup` once.
- Owns are binding: `pnpm tracer:guard .omc/plans/glass-buttons.yaml <ID>` (the script takes the plan path). If an existing spec needs an edit outside your owns (a
  class assertion, say), stop and report. Specs select by role and name, so this should be rare.
- Use `BrandButton` / `brandButton` with a role variant. Use `glassButtonClass` only where a plain class string is
  needed. No new hand-styled classes. Keep layout classes (width, alignment, gap) and drop colour, border, radius,
  height and padding utilities on glass buttons.
- Behaviour does not change: same labels, accessible names, `data-testid`s, `type`, disabled logic and handlers. This is
  a restyle. A two-tap confirm stays a two-tap confirm.
- In the task doc (`docs/tasks/TASK-GLASS-<id>.md`), list every button per file with its role, every class deleted,
  anything left alone and why, and the shots.
- Visual spec `tests/e2e/visual/GLASS-<ID>.spec.ts` (`E2E_VISUAL=1`):
  - GM and player at 1440x900, 1024x768 and 390x844;
  - one hovered confirm and one keyboard-focused button;
  - copy the shots to `/mnt/c/Users/Petar/Downloads/dcm-screens/glass-<id>/`.
- Checks:
  - `pnpm lint`, `pnpm typecheck`;
  - vitest (`--maxWorkers=1 --testTimeout=120000`; full suite once before the commit);
  - your area's e2e and visual specs (listed in your acceptance; skip any that JX2 deleted and say so).
- Commit once on your branch, author petar, no Co-Authored-By trailer. Never push, merge or close beads.

## Per-tracer notes

- **G0:** the only tracer that edits `glass-button.*` before GZ.
  - Any change to `.gb` itself must leave the HUD unchanged; put HUD-only rules in `hud/ui/ui.css` (not owned, so ask)
    or scope new behaviour to a brand-only modifier class.
  - `campaign-shell.tsx` also gets edited by G2 later (different wave).
- **G1:** chronicle's delete flow: Delete = danger, Keep it = cancel, Delete permanently = danger. Settings dialog: Sign
  out = neutral, backup / restore = neutral, destructive data actions = danger. The title menu's ITEM rows stay rows.
- **G2:** End scene (dashboard) is `primary` today and becomes danger. The time arc's End day is neutral and its Undo
  is cancel. Players dialog: Revoke = danger.
- **G5:** the rest launcher and the level-up button are shared with the sheet and the dashboard, so they are restyled
  here even under Q3 (a). Bench / Away toggles are neutral with `aria-pressed`.
- **G9 / G11:** the tracker's `trk-btn-fear` / `-attack` / `-crit` colour hints become roles. Attack = confirm (GM:
  purple), spending Fear = confirm. Keep the `sh-pip` classes (`encounter-tracker.spec` asserts them).
- **G10:** large but mostly mechanical (`cm-btn` → role). The panels also render in the HUD's tools drawer in Play, so
  shoot both.
- **G12 / G13:** the Journal and Notes have paper surfaces (recap paper, Notes page). Q5 decides.
- **G14 / G15:** run only on Q3 (b) / (c); keep pips, dice faces and the card face.

## Risks

- **The GM's colours flip on every campaign page (Q1).** The GM's "Save" turns purple across management pages. The
  design says so, but it is a big visible change. G0's shots show it before any area tracer runs, so stop there if the
  user dislikes it.
- **Unlayered CSS vs Tailwind** (Approach 4). A forgotten `rounded-full` or `h-9` on a call site silently loses. Check
  it in the shots.
- **Fixed height and `nowrap` in `.gb`.** Long labels can clip on phones. G0 handles brandButton; area tracers check
  their long labels at 390.
- **Parallel restyles collide in shared components.** Owns prevent file collisions, but two areas can render the same
  component (EndSceneButton, rest launcher). The owner restyles it; others only pass classes.
- **Specs asserting classes.** Only `sh-pip` and `dk-more` were found, and both are left alone.

## Beads to create (children of dcm-q861, label `ui`)

Create one bead per tracer: G0, G1 to G13, GZ, and G14 / G15 only if Q3 is (b) or (c). Each bead's description is
the tracer's goal plus "plan: .omc/plans/glass-buttons.yaml".

## Questions for the user

Each question has a recommended answer (marked **recommended**); the plan is built on those.

**Q1. Inside a campaign, should the GM's buttons use the GM's colours on every page?**
In the Combat HUD the GM's main buttons are purple and their back-out buttons gold, the reverse of the players.
- (a) **recommended** Yes, on every page of a campaign: the GM's Save, Start Session and Create encounter buttons are
  purple, and their Cancel buttons gold. Players keep gold main buttons and purple Cancel buttons everywhere.
- (b) Only while playing (Combat Map, the live session in the Journal, dice). On the other pages (Codex, Adversaries,
  World Map, Countdowns…) the GM's main buttons stay gold and Cancel purple, like a player's.
- (c) Only on the Combat Map. Everywhere else everyone gets gold main buttons and purple Cancel buttons.

**Q2. Outside a campaign (sign-in, the main menu, new campaign, settings, joining), which colours?**
- (a) **recommended** The player's colours: main buttons gold, back-out buttons (Cancel, Back, Not now) purple.
- (b) Main buttons gold, back-out buttons grey (no purple until you are inside a campaign).

**Q3. Character sheets: change their buttons too?**
The design says sheets keep their own buttons. Either way, the Rest, Level up and Import buttons change, because they
are shared with the Party page and the dashboard.
- (a) **recommended** Leave the character sheet's buttons as they are, as the design says.
- (b) Change the sheet's buttons too (adds two tracers): dice box, Hope, HP / Stress box actions, equipment, domain
  cards' buttons, level-up ribbon. The pips, card faces and dice stay as they are.
- (c) Only the dice box and its roll feed on the sheet.

**Q4. The big gold headline buttons ("Choose this Frame", "+ Create character", "Resume Campaign", "Start Session").**
- (a) **recommended** They become large glass buttons: dark with a gold rim and a gold glow at the bottom, filling
  gold when you hover. In a campaign the GM sees them purple (Q1).
- (b) Keep them solid gold, the only buttons that are not glass.

**Q5. Buttons on paper (the Notes page, the recap paper in the Journal, the Tome book).**
- (a) **recommended** Keep their ink-on-paper look. Dark glass on parchment looks out of place, and these buttons are
  few and small.
- (b) Dark glass buttons on the paper too, same as everywhere else.

**Q6. Switches with two or three options and the filter chips** (Plan / Log & recap, catalogue filters, map view
switches, Bench / Away).
- (a) **recommended** They become grey glass, and the chosen option glows gold, like the HUD's switched-on tools.
  Page tabs (Sessions / Notes, the sheet's pages) stay as they are.
- (b) Change the page tabs too.
- (c) Leave switches and chips as they are; only real buttons change.

**Q7. Small + / − buttons and the small ✕ that removes a row** (countdown steps, tracker steps, Battle Points).
- (a) **recommended** Small grey glass squares (44 px on tablets and phones). The ✕ goes red on hover only where it
  deletes something saved.
- (b) Leave them as they are.

**Q8. Pill-shaped buttons with fully round ends** ("Import from photo", "Return to play", "Add", "Reset", the frame
page's buttons).
- (a) **recommended** They take the glass button's shape (slightly rounded corners) like every other button.
- (b) Glass, but keep the round ends.

**Q9. "Are you sure?" dialogs for deleting or ending something.**
- (a) **recommended** The button that opens the dialog and the dialog's final "Delete" are both red. "Keep it" /
  "Cancel" is a back-out button (purple for a player, gold for the GM).
- (b) Only the dialog's final button is red; the button that opens the dialog is grey.
