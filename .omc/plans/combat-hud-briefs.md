# Combat HUD: tracer briefs (2026-11-01, revised after the user's answers)

Plan: `.omc/plans/combat-hud.yaml` (10 waves numbered 1-10, 39 tracers; wave 10 = design v2, see "Wave 10" below; `node scripts/plan-check.mjs .omc/plans/combat-hud.yaml` OK,
no file owned twice in a wave). Design: `reference/designs/combat-hud/` (start with `HANDOFF.md`; render the boards in
`preview/` with Playwright, file:// URLs, and click every Preview button and banner / token to see each state). Bead:
dcm-bxp.99.32 (the overhaul) with children dcm-bxp.99.32.1 - .9 (server and data pieces, see "Beads"). Every question is
answered: see "User answers 2026-11-01" at the end; they bind every tracer and override anything older in this file.
HUD waves are numbered 1-9. Tracer IDs keep their original digit, one lower than the wave: H0 / HD1 run in wave 1,
H1.x in wave 2, H2.x / HD2 in wave 3, H3.x / HD3 in wave 4, H4.x / HD4 in wave 5, H5.x in wave 6, H6.x in wave 7,
H7.x in wave 8, H8.x in wave 9, H9.x in wave 10 (design v2). (Lanes-2 waves 10 and 11 are the engine plan's, not these.)

## What the design is

A full-bleed map with the HUD over it. **F · Banners**: the party hangs as banners top-left (portrait, name, class,
HP / Stress / Armor pips, conditions, the Hope seal at the tip; the numbered seal is Hope: Moss 1 / Brannoc 3 match their
sheets, and the "Can't afford" state shows 0); the GM's Fear hangs as a purple banner top-right with a day / time disc
beside it. **E · At the token**: HP-left / Stress-marked arcs, a Hope chip and condition badges on every token; target
rings during picking; an action ring around your own token. **D · Sheet at hand**: a 400 px sheet panel on the right
that the map makes room for. Plus one picking pattern for everything, small one-question prompts, a GM request queue,
an adversary stat block on parchment, and a three-layer blocked-state system.

## Batches and launch order

| Wave | Batch | Tracers | Start |
|---|---|---|---|
| 1 | - | H0, HD1 | at once (no shared files) |
| 2 | - | H1.1, H1.2, H1.3, H1.S | when H0 and HD1 are merged (H1.S needs only H0) |
| 3 | A | HD2, H2.2, H2.3 | after wave 2 |
| 3 | B | H2.1 | when HD2 is merged |
| 4 | A | HD3, then H3.0 | after wave 3 (H3.0 after HD3) |
| 4 | B | H3.1, H3.2, H3.3 | when H3.0 is merged |
| 4 | C | H3.4 | when H3.1-H3.3 are merged |
| 5 | A | HD4, H4.1, H4.2 | after wave 4 |
| 5 | B | H4.3 | when HD4 is merged |
| 6 | - | H5.1, H5.2, H5.3 | after wave 5 (H5.2 codes against H5.3's FearConfirm props) |
| 7 | A / B | H6.1, then H6.2 and H6.3 | after wave 6 |
| 8 | - | H7.1, H7.2, H7.3 | after wave 7 |
| 9 | A / B | H8.1, then H8.2 (cut-over) | after wave 8, the full e2e suite green with the switch on, and the user's go-ahead |
| 10 | A | H9.0, H9.S, H9.A, H9.5 | each once the user has answered its questions (H9.0: Q4, Q9; H9.S: Q7, Q8; H9.A: Q1-Q3; H9.5: Q5); no config S1 or Journal JX1 open while H9.A runs (all own `campaign-shell.tsx`) |
| 10 | B | H9.1, H9.2, H9.3 | when H9.0 is merged (H9.1 also after H9.S); questions H9.1: Q7, Q8, Q11; H9.2: Q10; H9.3: Q6 |
| 10 | C | H9.6 | when every other wave 10 tracer is merged |

At most 5 tracers run at once. Only the orchestrator merges, in dependency order, one squashed commit each; codegen after
every merge that adds or changes a Convex file (HD1, H1.S, HD2, HD3, HD4, H5.3); schema composition for H1.S's table at
merge time; HD4's new public functions go into `tests/convex/authz/play.entries.ts` at merge time (that file is shared).

## Common rules (every HUD tracer)

- Read CLAUDE.md, AGENTS.md, docs/workflow.md, docs/best-practices.md section 3 (client) and 4 (testing),
  docs/testing.md (axe, tablet, live specs, visual shots), `HANDOFF.md`, every board your block names (render them;
  read their HTML / CSS for class names, sizes and copy), your block in `combat-hud.yaml`, and the task docs of the
  HUD tracers you depend on (`docs/tasks/TASK-HUD-*.md`).
- First step, before any edit: `git switch -C hud-<id> rebuild` (e.g. `hud-h0`, `hud-h3-0`). Then
  `node scripts/worktree-setup.mjs` and `E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm e2e:setup` once.
- Owns are binding: `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml <ID> rebuild HEAD`. An edit an existing
  test forces outside owns: say so in your task doc (as in lanes-2).
- **Opt-in switch, add don't delete (answer 11b).** H0 adds `hud/flag.ts` (`useHudEnabled()`: per viewer in
  localStorage, `?hud=1` / `?hud=0` override, off by default). Every HUD tracer up to wave 8 ADDS components under
  `src/components/combat-map/hud/**` that render only with the switch on; the classic UI stays complete and usable with
  it off, and every existing spec passes unchanged (do not edit classic specs). New specs and visual shots turn the
  switch on through `tests/e2e/hud/helpers.ts`. With the switch on, parts not yet built are reached through H0's left
  drawer (the classic column). Wave 9 deletes the classic UI, its specs and the switch. The boards' Preview box is a
  review aid: never ship it.
- **View files only.** Never edit the pure model files (`actions/hand/model.ts`, `actions/reactions/model.ts`,
  `drawer/list/model.ts`, `drawer/use/model.ts`, `drawer/prompts/model.ts`, `drawer/trackers/model.ts`,
  `actions/attack/mods.ts`, `actions/adversary/model.ts`, `actions/adversary/sight.ts`), `convex/**` engine files,
  `src/lib/domain/**` (except H6.1's new `shortfall.ts`) or `src/lib/srd/**`. A needed change there: file a bead with the
  owning lane's label (`lane:w1-e1-triggers-rolls`, `lane:w1-e2-damage-window`, ...) and name it in your doc.
- **Hard rules (HANDOFF):** (1) the hand's card face is the app's own (the domains tab's dk-* face that
  `actions/hand/face.tsx` already uses); states only around it (tag, lift and glow, grey wash). (2) Players never see
  adversary numbers (HP, Stress, Difficulty, thresholds): player-view enemy tokens have no rings; results say Hit / Miss /
  Defeated; the player's own damage total may show. (3) Out of range is not an error: `GM approves` tag, amber dashed
  ring, nothing rolled or paid until the GM allows. (4) Banners and tokens are real `<button>`s with `aria-label`s.
- **Board match:** each UI tracer writes `tests/e2e/visual/HUD-<id>.spec.ts` (runs with `E2E_VISUAL=1`) shooting the
  board's states at the board's size (1440x900, 1024x768, 390x844) and puts the shots beside the board renders in its task
  doc. Sample content (the four PCs, numbers, queue rows, "Mira / Ash") is replaced by the e2e seed's real data; card text,
  adversary blocks and death-move wording come from the app's data.
- **React rules:** an error boundary around every `useQuery` subtree (the page's SlotBoundary / PartBoundary pattern);
  `undefined` = loading with a `role="status"` line; mutations are intents with optimistic updates where a click has
  visible latency (Fear - / +, trackers, Undo); no mutations or prop copies in effects; no `key=` on live content; stable
  list keys; art through `next/image` (no CSS backgroundImage, CL10) except the existing card face; modals on native
  `<dialog>` (`src/components/brand/modal.tsx`); the sheet panel is not modal (the map stays usable); every motion stops
  under `prefers-reduced-motion`.
- **Server work** (HD1, HD2, HD3, HD4, H1.S, H5.3 only): `userQuery`-based wrappers from `convex/lib/functions.ts`, access only via
  `permissionFor` (`need:`), `args` and `returns` validators (player-facing), indexed reads, authz entries in
  `tests/convex/authz/hud.entries.ts` (+ `hud.test.ts`), tests assert `ConvexError.data.code`.
- **Tests:** unit tests for every new component's states; one e2e spec per tracer (`tests/e2e/hud-*.spec.ts`) with
  `expectNoSeriousA11yViolations`; live two-browser checks where the board shows another player's change; classic
  specs stay untouched until wave 9 (the switch is off by default). Checks: `pnpm lint`, `pnpm typecheck`, vitest
  `--maxWorkers=1 --testTimeout=120000` (focused files while iterating, full suite once before the commit), your e2e specs.
- Write `docs/tasks/TASK-HUD-<id>.md`: what landed, board states matched (with shots), what moved out of the old column,
  beads done / follow-ups filed, data gaps found, QUESTIONS (book quote + page for rules), merge-time actions.
- Commit ONCE on your branch, author petar (existing git config), no Co-Authored-By trailer. Never push, merge or close beads.

## Files the HUD takes over (for the orchestrator: keep lanes-2 wave 11 off these while the wave runs)

Waves 1-8 add new files (`src/components/combat-map/hud/**`, `convex/combatHud.ts`, ...) and touch only these existing
files; wave 9 then takes the classic UI.

| HUD wave | Existing files it owns |
|---|---|
| 1 | `combat-map/page.tsx` (H0: switch branch + drawer), `convex/combatVision.ts`, `convex/lib/combatVision.ts` (HD1: condition names on `others`) |
| 2 | `tokens/tokens-layer.tsx`, `vision/vision-layer.tsx` (H1.3: TokenFace when the switch is on); `src/lib/errors/app-error.ts`, `src/lib/convex-errors.ts` (H1.S: new code SPOTLIGHT_WITH_GM) |
| 3 | none |
| 4 | none (HD3 adds `convex/combatWithdraw.ts`; a request-status widen goes to the vocabulary lane) |
| 5 | `convex/deathMoves.ts`, `src/lib/domain/death/**`, `src/lib/errors/death.ts`, `src/components/party/death/**`, `tests/e2e/death.spec.ts` (HD4) |
| 6-8 | none |
| 9 | the classic view files and specs listed under H8.1 / H8.2 in the plan: `page.tsx`, `combat-map.css`, `slots.ts`, `actions/{index,actions.css,targets,attack (index, riders, memory), hand (index, dialog, dock, hand.css, result, sharing, use-card), reactions (index, prompt, css), dice, gm, adversary (index, controls, css, flash, part-boundary, resolutions, keyword-asks)}`, `requests/**`, `drawer/` view files, `tokens-layer.tsx`, `vision-layer.tsx`, and about 30 classic unit / e2e / visual specs |

Model files (`*/model.ts`, `attack/mods.ts`, `adversary/sight.ts`), `hand/face.tsx`, `roll-controls/**`,
`map-view/area-pick.tsx` and `party/death` stay shared: the HUD reads them and keeps them at the cut-over. Engine lanes
may keep owning the classic view files during waves 1-8 (the HUD only reads them); the HUD tracers then fold whatever UI
the engine adds there into the HUD. lanes-2 wave 10's E1.4a, E1.4b, E2.4, E4.4 and E6.4 should be merged before HUD waves 3-6 so
the HUD starts from their final UI.

## Board elements -> existing code -> data

| Board element (board) | Existing code today | Data source | Gap |
|---|---|---|---|
| Party banners (Main, CmpTokens) | none (page header + `TokenPanel`) | `combatTokens.party` has HP / Stress / conditions for every PC, no Hope / Armor | **HD1** `combatHud.party` adds Hope, Armor, class, level, death move due |
| Hope seal / token Hope chip | none (players see only their own Hope in `MapDice` / drawer) | sheet Hope | HD1 |
| Spotlight label, GM's-turn note, SPOTLIGHT tag (Main 'GM's turn', sheet badge) | GM side only: per-instance spotlight counts per GM turn (`encounterTracking.spotlight`, `endGmTurn`), D10 session spotlight counts | none for "who has it now" | answer 1: H1.S (dcm-bxp.99.32.3-.5) |
| Fear banner, GM - / + (CmpTokens) | `FearPill` in page header | `campaigns.fear`, `fear.adjust` | none |
| Day / time disc, Day / Dim / Night (Main, GMDesktop) | `LightPill` (vision/header.tsx), `campaigns.setTimeOfDay` | `campaigns.timeOfDay` (phase, light, canSet); day only in campaign-time frames (`campaignTime`) | day for core campaigns (**Q9**) |
| Title "Forest Camp / Live · ..." | `MapHeaderLine`, `LiveSessionChip` | map name, live, live session n | no scene description field (use name + Live + session) |
| Token arcs, side colours, condition badges (CmpTokens) | `tokens-layer.tsx` (GM + player PCs), `vision-layer.tsx` (players' other tokens), `rings.ts` (range circles, a different thing) | `combatTokens.list` (GM, every stat), `combatVision.playerView` (`pcs` with stats, `others` name / side / facing only) | adversary conditions for players (**Q10**) |
| Action ring (Main) | none | `combatFeatures.drawer` features, hand | contents (**Q3**) |
| Sheet panel own / view only / GM edit (Main, GMDesktop) | `SheetDrawer` (`drawer/**`: trackers, features by source, prompts, Play-for switch) | `combatFeatures.drawer` (refuses other players unless hands are shared), `characters.adjustResource` | **HD2** `combatHud.sheet` (Evasion, Armor score, thresholds, Experiences, conditions + effects with source / until); view-only access (**Q4**); GM edit (**Q5**) |
| Conditions & lasting effects rows (CmpTokens) | sheet conditions are plain ids; effects have `source`, `text`, `until`, `casterId` | sheet | condition source / duration not stored: bead (below) |
| Hand states, vault, recall, roll options, full card (CmpCards) | `actions/hand/**` (fan dock, face, sharing, dialog), `roll-controls`, `cards/card-dialog` | `combatCards.hand`, `handSharing`, `characters.moveCard`, `playFor.list` | none (Hide cards meaning: **Q16**) |
| Picking panel + target rings (CmpPicking, Main) | `actions/targets/**` (TargetList card, `TargetsLayer` rings, `Aim` banner), `hand/dialog.tsx` (Use dialog), `drawer/use/**` (FeatureUse), `attack/**` (Attack bar + riders), `map-view/area-pick.tsx` | `combatActions.targets` (band, inRange, lineOfSight, benefits), `combatActions.riders`, client range from `hand/model.ts` | Withdraw (**Q8**) |
| Waiting for the GM (CmpPromptsPlayer) | hand's pending line ("Waiting for the GM: ...") | `combatCards.pending`, `combatRequests.mine` | withdraw mutation (Q8) |
| Result panel (Main 'Card result') | `hand/result.tsx`, attack bar result, `attack/memory.tsx` | the use's / attack's return values | none |
| After-roll hold, split, ally picks (CmpPicking, CmpPromptsPlayer) | `attack/riders.tsx` after-roll, split outcomes (`distribution: split`), `featurePrompts.allyRolls` | existing | none |
| Hit window (Main 'You're hit', CmpPromptsPlayer 'Pay something else?') | `actions/reactions/**` (IncomingHit, prompt, GmOwnHits) | `adversaryActions.pending`, `respond` | none |
| Death move (Main 'Last Hit Point') | `src/components/party/death/**` (shared with the sheet), via `reactions/index.tsx` | `deathMoves.state`, `choose`, `resolveRiskItAll` | GM confirm wording (**Q15**) |
| Feed "Just now" / Resolutions + Undo | `MiniFeed` (`actions/dice`), `actions/gm` ResolutionRow, `adversary/resolutions.tsx` | `feed.list`, `actionLog.undo` | none |
| GM request queue (GMDesktop, CmpPromptsGM) | spread over the GM column: `actions/gm` (out of range Allow / Decline), `requests/index.tsx` (Difficulty), `requests/cloak.tsx`, `adversary/index.tsx` (reaction windows Resolve now), `adversary/keyword-asks.tsx`, hand GM pending (card sanctions) | `combatRequests.sanction`, `combatCards.pending` / `sanction`, `combatRequests.difficulties` / `featurePrompts.answerDifficulty`, `adversaryActions.windows` / `resolve`, `cloakPrompts`, `hitKeywords`, `featurePrompts.allyRolls` / `cancelAllyRoll` | countdown end needs dcm-pgfr; Momentum (**Q7**); Hope split has no engine term (**Q14**) |
| Adversary stat panel + attack picker (GMDesktop 'Adversary acting') | `actions/adversary/controls.tsx` (Attack, feature Use, Fear questions), Encounter tracker actions | `encounters.get`, `combatTokens.list`, `adversaryActions.attack` / `useFeature` / `featureAsk`, `encounterTracking.markHp` / `markStress` / `toggleCondition` / `spotlight`, `combatEffects.fearEnds` / `endByFear` ("End · 1 Fear") | none |
| Spend Fear confirm (GMDesktop 'Spend Fear') | adversary controls' Fear questions (confirmFear) | existing | none |
| End scene confirm (GMDesktop 'End scene') | `EndSceneButton` (`combatScenes.end`, no confirm) | - | **H5.3** `combatHud.sceneEndPreview` |
| Areas panel (GMDesktop 'Areas') | area overlay + edit tools | `combatAreas.list`, `combatAreaEdits.draw` / `move`, `combatAreas.remove` | none |
| Blocked layers + refusal table (CmpBlocked) | `errorMessage()` raw text per code | `{ code, message? }` only; cost refusals say "Short of: <detail>" | structured shortfall (bead); client pre-compute in H6.1 |
| Phone strip, tabs, edge chips, bottom sheets (PlayerPhone) | `actions/index.tsx` BottomSheet (Hand / Attack / Dice / Feed at 760 px) | existing | GM phone (**Q13**) |
| GM map tools (not on the boards) | GM column: MapsPanel, Edit mode, Combatants, TokenPanel, Reveal, Vision, StyleSwitch, PacksLink | existing | placement (**Q12**) |

## Beads

Filed 2026-11-01 as children of dcm-bxp.99.32 (labels `combat-ui` + lane; `lane:own-plan` = built by this plan):

| Bead | What | Built by |
|---|---|---|
| dcm-bxp.99.32.1 | Conditions with provenance (source, until) on sheet and instance conditions | `lane:w3-vocabulary` (HUD shows a static until meanwhile) |
| dcm-bxp.99.32.2 | Structured refusal shortfall `{ resource, need, have }` | `lane:w3-vocabulary` (H6.1 computes it client side meanwhile) |
| dcm-bxp.99.32.3 | Spotlight state, GM take / hand back, helpers, display | H1.S |
| dcm-bxp.99.32.4 | Roll paths call `moveToGm` on a roll with Fear or a failure; GM spotlighting an adversary takes it | `lane:w1-e1-triggers-rolls` (blocked on .3) |
| dcm-bxp.99.32.5 | Use paths call `assertMayAct` (players only react while the GM holds it) | `lane:w1-e1-triggers-rolls` (blocked on .3) |
| dcm-bxp.99.32.6 | Player withdraws a use waiting on GM approval | HD3 |
| dcm-bxp.99.32.7 | Death move waits for the GM's confirm | HD4 |
| dcm-bxp.99.32.8 | Players see visible adversaries' condition names | HD1 |
| dcm-bxp.99.32.9 | Any party member views any PC sheet; cards keep hand sharing | HD2 |

Fold in (close when the named tracer lands): **dcm-bxp.99.32** (after H8.2), **dcm-aiwg** (H3.3), **dcm-y3e** UI half
(H3.2), **dcm-p1r** UI half (H3.1), **dcm-pgfr** UI half (H5.1, once its server lands). **dcm-5dg** and **dcm-733** stay
engine-first. Hope split (CmpPromptsGM) is left out (answer 14a): no bead.

## Per-tracer briefs

Every UI tracer below renders only with the switch on and leaves the classic part it re-creates untouched.

### Wave 1

**H0 — foundation.** `hud/flag.ts` and the toggle on both views. With the switch on, `page.tsx` renders the HUD shell: a
full-bleed `MapBoard` with the same layers plus the HUD layer slot, every region from its stub `hud/<area>/index.tsx`,
and the left drawer `hud/tools` holding the classic column (GM: "Map tools" with Maps, Play / Edit, Combatants, token card,
Reveal, Vision, Map style, Sprite packs, session chip, answer 12a; Edit mode keeps today's two-column layout; players get
their classic column in the same drawer until wave 9). Tokens in `hud/hud.css` (`--hud-*`, reusing `--cm-*` values), the
primitives in `hud/ui/**` with unit tests, `HudProvider` in `state.tsx`. Seed helper `tests/e2e/hud/helpers.ts` (switch
on, live map, party, a running encounter with a Leader, two Bandits and a ranged adversary, a Far card, one adversary out
of sight).

**HD1 — party, scene, enemy condition names.** `combatHud.party` / `combatHud.scene` (copy the small projection from
`combatTokens.viewsOf` into `convex/lib/combatHud.ts`; do not edit combatTokens). Widen `otherTokenValidator` in
`convex/lib/combatVision.ts` with optional condition names for visible adversaries (answer 10a), never numbers.
`scene.canOpenTimeArc` tells the GM's disc whether the frame has campaign time.

### Wave 2

**H1.1 — banners.** CmpTokens 'Banners' and Main's geometry. HP pips show HP left; numbers and accessible names say
"n of 6 marked" (answer 2). "Spotlight" comes from `hud/spotlight`'s slot.

**H1.2 — Fear, disc, title, toolbar.** Fear banner with - / + spending without a confirm (answer 6a). Disc: GM button
opening the existing time arc / End day (`time-arc.tsx`, reuse, don't edit; frames without campaign time: the disc shows
the light only), players read only (answer 9b). Title at x = 690 with Dice and Sheet; GM toolbar per GMDesktop plus the
"Map tools" button (H0's drawer).

**H1.3 — token rings.** One `TokenFace` (`hud/token/`) used by `tokens-layer.tsx` and `vision-layer.tsx` when the switch is
on; the classic face stays for off. Arcs show HP left (answer 2), labels say HP marked. Visible adversaries show their
condition badges for players (HD1).

**H1.S — spotlight (answer 1c).** Table `combatSpotlight` (holder pc / gm, since, reason); `state`, `gmTake`,
`handTo`; `convex/lib/spotlight.ts` with `moveToGm` and `assertMayAct` + code SPOTLIGHT_WITH_GM. Do not edit the engine
call sites: dcm-bxp.99.32.4 and .5 wire them. Display in `hud/spotlight/**` (banner tag, Fear banner SPOTLIGHT, "The GM
has the spotlight" card, reactions note; GM hand-back from a banner or the Fear banner). Until .4 / .5 land, the GM moves
the spotlight by hand (gmTake / handTo) and nothing is refused; say so in the doc.

### Wave 3

**HD2 — sheet data (answer 4a).** Modes own / gm / view; view returns numbers and a view-safe feature list for any member;
never the cards.

**H2.1 — sheet panel.** Main (own, view only) and GMDesktop (GM edit). GM: trackers and conditions always editable;
feature Use and cards only with "Play for this character", the switch in the header (answer 5a). Own sheet: "Hide my hand
from other players" (answer 16a). Numbers read "n of 6 marked" (answer 2). Classic FeatureUse until H3.3.

**H2.2 — make room.** As before; also keep `toSquares` exact under the transform.

**H2.3 — HUD hand.** New `hud/hand/**` that reuses `HandCardFace`, the fan (`cards/fan.ts`) and the hand model; the face is
untouched. "Hide cards" folds your own fan on your screen only (local state, answer 16a).

### Wave 4

**HD3 — withdraw (answer 8a).** `combatWithdraw.withdraw({ requestId })`. If the request rows can't say "withdrawn"
without a validator widen, file it for `lane:w3-vocabulary` and use the existing declined status meanwhile (say which).

**H3.0 — picking core.** Pick-session API every picker uses; target rows and the HUD ring layer share one selection;
out-of-range -> "Waiting for the GM" with Withdraw.

**H3.1 / H3.2 / H3.3 — card, attack, feature / area pickers** in `hud/pick-card`, `hud/pick-attack`,
`hud/pick-feature` + `hud/pick-area` (H3.1 also owns `hud/hand/**` for the Use / raise step).

**H3.4 — action ring (answer 3b).** Attack, Cast (raises the hand), Sheet and every feature with a Use button; decide the
overflow (second ring or "More") and say which.

### Wave 5

**HD4 — death confirm (answer 15b).** `choose` stores the move as awaiting the GM; `confirm` / `decline` (GM); dice and
outcome at confirm; both the party sheet and the HUD show the wait.

**H4.1 — results; H4.2 — hit window** (text "n of 6 marked"; reactions stay usable while the GM holds the spotlight);
**H4.3 — death modal and feed** (GM confirm popup on the GM view until H5.1 puts it in the queue).

### Wave 6

**H5.1 — queue.** Client merge of the existing queries plus withdrawn requests disappearing and the death-move confirm.
No Momentum prompt (answer 7a: automatic; its feed line and Undo show in Resolutions), no Hope split (answer 14a).

**H5.2 — stat block + GM attack picker.** Every Fear spend through H5.3's `FearConfirm` (answer 6a); spotlighting an
adversary also calls `combatSpotlight.gmTake`.

**H5.3 — Fear confirm, End scene preview, Areas.** As in the plan.

### Wave 7

**H6.1 — refusals** (includes SPOTLIGHT_WITH_GM and reads dcm-bxp.99.32.2's shortfall when present). **H6.2** player
surfaces (non-reaction controls disabled while the GM holds the spotlight). **H6.3** GM surfaces.

### Wave 8

**H7.1 — tablet.** **H7.2 — phone shell** (player strip, tabs, edge chips, full-screen sheet; GM at phone width: tablet
layout with the queue as a bottom sheet, answer 13a). **H7.3 — phone bottom sheets.**

### Wave 9 (cut-over)

**H8.1** removes the switch and the classic page / player-side UI and moves or deletes every classic spec (each deleted
spec names the HUD spec that covers it). **H8.2** removes the classic GM cards (keeps `EndSceneButton` for the Encounter
tab). Both run the full e2e suite and `pnpm build`. The orchestrator closes dcm-bxp.99.32 after H8.2.

### Wave 10 (design v2, 2026-11-03)

The user updated the design (artifact `Jis5dC5ZwBodq8nFKo8byK`, saved over `reference/designs/combat-hud/`; `git diff`
shows the change). Read `.omc/plans/combat-hud-v2-delta.md` first: it lists every change per board, what exists in the
code, and the questions Q1-Q11. A tracer whose `questions:` are unanswered does not start; if an answer differs from the
recommended option, the orchestrator rewrites that tracer's acceptance first. The user's issue this wave fixes: the GM's
top middle had two stacked cards repeating each other (the HUD title + toolbar and, under it, `MapBoard`'s own
`.cm-toolbar`) plus the spotlight panel over mid-map tokens. Mode replace (no switch since wave 9): delete what the
design removes, and fix or delete every spec that used it (name the covering spec).

**H9.0 — shell and dock (foundation of batch B).** Add `chrome: "full" | "none"` to `MapBoard` (Edit mode and the World
map keep the full toolbar) and lift zoom / fit / Names / area tools into `map-view/controls.ts` so the dock drives them.
`hud/panels.ts`: one GM panel at a time (queue, log, areas, spotlight, dice, fog, player view, end scene). The dock
reuses the existing Dice, Fog (VisionPanel), Player view (PreviewPicker) and End scene parts: import them, don't fork.
Measure (Q9) is new; if the user leaves it out, ship Select alone in that slot. Keep the accessible names "Zoom in",
"Zoom out", "Map tools" so the ~30 specs that use them stay green.

**H9.S — spotlight server.** `handToParty` and `gmTake`'s `pay` widen (Q7, Q8). Reuse `spendCampaignFear`
(`convex/lib/fear.ts`) and the per-GM-turn spotlight count `encounterTracking.spotlight` uses; quote CB in the doc for
the rule you implement.

**H9.A — app bar.** A compact bar for the Combat Map only (Q2a) built in `src/components/app-bar/**` and chosen by
`campaign-shell.tsx` on the combat route; nav from `CAMPAIGN_SECTIONS` (Q1a: no hard-coded list), Lorekeeper pill opening
the existing drawer (export an opener from `lorekeeper/drawer/index.tsx`; hide its floating pill on the combat map),
gear / avatar slot for config S1 (Q3a). Sets `--app-bar-h` for H9.0's HUD height.

**H9.5 — class controls (dcm-bxp.99.32.43).** Independent of the design; runs in batch A so the drawer holds only map
tools when the dock lands.

**H9.1 — spotlight disc.** Replaces `SpotlightMenu`, `SpotlightBannerTag`, `FearSpotlightTag` and the
`useSpotlightInColumn` placement (commit fee75325) with the disc + popover; extends `SpotlightPools` to PC holders and
the whole party (tokens-layer / vision-layer pass the PC tokens). Banners on the GM view never get the "you" trim.

**H9.2 — queue, Log, Areas.** The queue's content is unchanged; only its placement and open state change.

**H9.3 — top centre and light.** The GM title row loses its buttons (H9.0's dock has them) and the "GM view · Session n"
line; Day / Dim / Night moves into the disc pop-over (Q6). Merge soon after H9.0 so the GM never sees both.

**H9.6 — tablet, phone, full e2e, build.** Owns `responsive/**` and the phone shell files not owned by H9.1 / H9.2.
Other wave 10 tracers style their own parts at tablet and phone width in their own CSS; H9.6 fixes what's left,
shoots every v2 board state, runs the full suite and `pnpm build`.

## Risks

- **UI file collisions with lanes-2 wave 11.** The engine lanes routinely own `actions/hand/**`, `attack/**`,
  `reactions/**`, `adversary/**`, `requests/**`, `drawer/use/**`. Use the takeover table; launch a HUD wave only when no
  open engine tracer owns its files.
- **Two UIs for a while.** With the switch, waves 1-8 keep the classic UI alive; an engine change to a classic view file
  during that time must be mirrored in the HUD (the HUD wave folds it in). The cut-over (wave 9) migrates about 30
  classic specs at once: run it when no engine tracer is open. The full e2e suite after each wave stays mandatory, with
  the switch off (classic) and on (HUD specs).
- **Spotlight enforcement order.** H1.S ships the state and helpers; refusals start only when dcm-bxp.99.32.5 lands in
  an engine wave. Until then the HUD shows the GM's turn but the server allows player actions.
- **Make-room transform vs pointer maths.** A CSS scale on the map's ancestor changes client rects; H2.2 must keep
  `toSquares`, drag and area picking exact.
- **Scope creep from sample prompts.** CmpPrompts boards show prompts the engine may not have (Hope split, Momentum offer,
  Withdraw): build only what the engine offers or the user answers.
- **Performance.** Banners, rings and the queue add subscriptions; HD1 keeps banner data in one small query; the queue
  merges existing ones. Re-measure the combat map after wave 2 and wave 6 (dcm-bxp.36.3 caveat: no agents running).
- **Shortfall text.** Until the shortfall bead lands, layer 2 shows the server's code text (or "Short of: ..."), layer 1 is
  client-computed.

## User answers 2026-11-01

| # | Question | Answer | Where it lands |
|---|---|---|---|
| 1 | Spotlight | (c) Build it: moves to the GM automatically on a PC roll with Fear or a failure; the GM hands it back to a PC; while the GM holds it players can only use reactions, enforced by the server with a clear blocked state | H1.S (state, helpers, display), dcm-bxp.99.32.4 / .5 (engine call sites), H6.1 / H6.2 (blocked state) |
| 2 | HP display | Rings show HP left (as designed); numbers and text read "n of 6 marked" | H1.1, H1.3, H2.1, H4.2 |
| 3 | Action ring | (b) Attack, Sheet and every feature with a Use button, plus Cast (raises the hand) | H3.4 |
| 4 | Ally sheets | (a) Any party member views any PC's sheet; only the cards in hand follow hand sharing | HD2, H2.1 |
| 5 | GM edit | (a) Trackers and conditions always editable by the GM; feature Use and cards need "Play for this character" | H2.1 |
| 6 | Fear confirm | (a) Any action that spends Fear asks; the Fear banner's - spends without asking | H1.2, H5.2, H5.3 |
| 7 | Momentum | (a) Stays automatic, with a feed line and Undo | H5.1 (no prompt) |
| 8 | Withdraw | (a) Add a player withdraw for a use waiting on GM approval | HD3, H3.0 |
| 9 | Day / time disc | (b) For the GM a button opening the time arc / End day; players read only | H1.2 |
| 10 | Adversary conditions | (a) Condition names of visible adversaries reach players, no numbers | HD1, H1.3, H3.0 |
| 11 | Rollout | (b) Opt-in switch until wave 8 completes; the old UI stays usable; a final cut-over removes the old UI and the switch | every tracer (mode add), H8.1 / H8.2 |
| 12 | GM map tools | (a) "Map tools" button opens today's column as a left drawer; Edit mode keeps today's layout | H0, H1.2, H8.2 |
| 13 | GM phone | (a) Tablet layout with the queue as a bottom sheet | H7.2 |
| 14 | Hope split | (a) Left out for now | none |
| 15 | Death move | (b) GM confirms before the outcome applies | HD4, H4.3, H5.1 |
| 16 | Hide cards | (a) Folds your own fan on your screen only; "Hide my hand from other players" moves to your sheet | H2.3, H2.1 |

Open follow-up for the user (asked in dcm-bxp.99.32.5, not blocking the HUD): while the GM holds the spotlight, may a
player still move their token?


### User answer 2026-11-01 (spotlight and movement)
While the GM holds the spotlight, a player may not move their token either: token moves are refused like actions; only reactions are allowed (dcm-bxp.99.32.5).
