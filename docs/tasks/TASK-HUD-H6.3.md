# TASK-HUD-H6.3: blocked states on the GM surfaces

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 7 batch B, tracer H6.3 (boards CmpBlocked, GMDesktop). Briefs:
`.omc/plans/combat-hud-briefs.md` "Common rules", "Wave 7", "User answers 2026-11-01" (6a). Parent bead dcm-bxp.99.32.
Depends on H6.1 (docs/tasks/TASK-HUD-H6.1.md: the refusal table, the shortfall helper, the three layers). Mode: add.
H6.2 (player surfaces) ran in parallel; no shared files.

## What landed

| File | What |
|---|---|
| `hud/fear/blocked.ts` (new) | `fearBlocked(need, fear)` / `fearShortText`: H6.1's `blockedReason({ kind: "fear", viewer: "gm" })` with the table's NOT_ENOUGH_FEAR sentence as its text ("This needs 2 Fear. You have 1."). `spotlightFirst(adversary, spotFear, fear)`: ADVERSARY_NOT_SPOTLIT ("Spotlight the Lieutenant first.", hint "Spotlighting costs 1 Fear."). `adversaryActBlocked`: the spotlight first, then the whole cost. Null while Fear loads or when the GM can pay. |
| `hud/fear/confirm.tsx` | FearConfirm's short line comes from `fearShortText` (was a hand-written "Needs n Fear · you have m") and describes the disabled Spend (`aria-describedby`); a refusal from `onConfirm` resolves through `useRefusal({ viewer: "gm", place: "inline" })` and shows as `RefusalMessage` in the card (the card is where the GM pressed, so toast-placed codes stay in it too). |
| `hud/fear/banner.tsx` | `useAdjustFear` keeps `refusalFor(e, { viewer: "gm" }).text` (was `errorMessage`). The − still spends without asking (answer 6a). |
| `hud/statblock/panel.tsx` | Layer 1: Spotlight · n Fear, End · n Fear (new `EndByFear`) are `aria-disabled` (focusable, click guarded) with the reason as description, title and (Spotlight) the `.hsb-why` line; Attack is `aria-disabled` with "Spotlight the … first. Spotlighting costs 1 Fear." when its own spotlight can't be paid; a usable feature whose Fear (+ its spotlight, for an action) can't be paid has its Use disabled and `FeatureWhy` under it. Layer 2: `guarded` is `useRefusal({ viewer: "gm", adversary })`; the refusal renders as `RefusalMessage` under the controls (`hud-statblock-error`). The tracker's own `tracker.error` (classic hook, not owned) still shows as before. |
| `hud/statblock/attack.tsx` | `GmAttackInput.fear`: an Experience option opens disabled with "This needs n Fear. You have m." (n = 1 + the action's own spotlight) when the GM's Fear at opening can't pay it, else "Costs 1 Fear". Both GM sessions catch a refusal and return `{ kind: "stay", message: refusalFor(e, { adversary, viewer: "gm" }).text }` (so the pick panel shows "Spotlight the Jagged Knife Lieutenant first." with the name); a toast-placed refusal goes to `hudToasts` and the session stays. |
| `hud/statblock/statblock.css` | The `aria-disabled` look for `.hsb-spot`, `.hsb-atk`, chip buttons; `.hud-why` in the block's dark red on parchment; `.hsb-af-why`, `.hsb-inl`. |
| `hud/queue/items.tsx`, `index.tsx` | REQUEST_NOT_OPEN and DEATH_MOVE_NOT_WAITING → `hudToasts.refusal(refusalForCode("REQUEST_NOT_OPEN"))`: the table's neutral toast "Already answered · Someone already answered this." in the toast host; the card drops out (optimistic update, then the live reads). The in-queue "Already answered: <label>" list and its OK button are gone. Any other refusal: `refusalFor(e, { viewer: "gm" })` under its card as `RefusalMessage`, or a toast when the table places it there (FALLBACK, NOT_A_RESPONDER, …). The card's own "needs a choice" note stays a plain string. |
| `hud/queue/resolutions.tsx` | Undo through `useRefusal({ viewer: "gm" })`; `RefusalMessage` under the list (`hud-resolutions-error`); UNDO_STALE keeps its own words (outside the table). |
| `hud/queue/queue.css` | `.hud-q-gone` / `.hud-q-x` removed; `.hud-q-inl` spacing. |
| `tests/unit/hud/blocked-gm.test.tsx` (new) | 15 tests: the helpers, the stat block at 0 / 1 / 5 Fear, the picking panel's refusals, layer 2 under the block, FearConfirm, the banner, the queue (REQUEST_NOT_OPEN, DEATH_MOVE_NOT_WAITING, inline vs toast), Resolutions. |
| `tests/e2e/hud-blocked-gm.spec.ts` (new) | NOT_ENOUGH_FEAR + ADVERSARY_NOT_SPOTLIT on the stat block (0 Fear, then 1), axe; REQUEST_NOT_OPEN live: the GM's tab goes offline, presses Allow, another GM client declines, back online the queued Allow is refused → toast, card gone, count 0, axe. |

## CmpBlocked GM rows

| Row | Code | Where | Before the click | At the click |
|---|---|---|---|---|
| NOT_ENOUGH_FEAR | NOT_ENOUGH_FEAR, FEAR_EMPTY | Spotlight · 1 Fear, End · n Fear, Fear features, Experiences, FearConfirm's Spend | aria-disabled (features / Experiences / Spend: disabled) + "This needs 2 Fear. You have 1." | the table's sentence under the control (block, picker, FearConfirm); without a structured shortfall: "Not enough Fear for that." |
| SPOTLIGHT_FIRST* | ADVERSARY_NOT_SPOTLIT | Attack, action features | aria-disabled + "Spotlight the Jagged Knife Lieutenant first. Spotlighting costs 1 Fear." when the action's own spotlight costs Fear the GM lacks | picker / block: "Spotlight the … first." with the name |
| STALE_REQUEST* | REQUEST_NOT_OPEN (+ DEATH_MOVE_NOT_WAITING) | every queue card | — | neutral toast "Already answered", card drops out (refresh is the live read) |

Today the server never throws ADVERSARY_NOT_SPOTLIT for the HUD's actions (adversaryActions spotlights the acting
instance itself and asks `confirmFear`); the before-the-click form covers the only case where the action really can't
get the spotlight (its spotlight costs Fear the GM doesn't have). The at-click form is ready for when it does.

## Test assertions changed (out of owns, wording / form the table now supplies)

- `tests/unit/hud/fear-confirm.test.tsx` "with less Fear than it costs…": `"Needs 3 Fear · you have 1"` → `"This needs 3 Fear. You have 1."`.
- `tests/unit/hud/statblock-panel.test.tsx` "disables a Fear spend the GM can't pay": `.disabled === true` → `aria-disabled="true"` (H6.1 layer 1: focusable), text `"Needs 1 Fear · you have 0"` → `"This needs 1 Fear. You have 0."` (via `hud-statblock-spot-why`).
- `tests/unit/hud/queue-cards.test.tsx` "REQUEST_NOT_OPEN: 'Already answered', dismissable" → "…as the table's neutral toast, nothing on the card": asserts the toast store (title, message, tone) and no alert on the card, instead of the removed in-queue row and its OK button. Intent (an answered request says "Already answered" and goes away) kept.

## Out-of-owns edits

Only the three test files above. No view, model, server or codegen change outside owns.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- Focused vitest (blocked-gm, statblock-panel, fear-confirm, queue-cards): 57 / 57. Full vitest
  (`--maxWorkers=2 --testTimeout=120000`): 475 files, 10558 passed, 1 expected fail.
- `tests/e2e/hud-blocked-gm.spec.ts`: 2 / 2. Every `tests/e2e/hud-*.spec.ts`: 34 / 34.

## Merge-time actions (orchestrator)

None. `HudToasts` (H6.1) is mounted by the shell for the GM too.

## Beads

None filed.

## QUESTIONS (safest reversible defaults taken)

1. **Which form beside a GM Fear control.** H6.1's layer-1 form is the short "Needs 2 Fear · you have 1" (its toasts test);
   the H6.3 goal and CmpBlocked's NOT_ENOUGH_FEAR message say "This needs 2 Fear. You have 1.". Default: every GM Fear
   control and FearConfirm show the sentence (`fearBlocked` overrides `text` with `refusal.text`); H6.1's helper is
   unchanged. One line in `hud/fear/blocked.ts` flips it.
2. **Experience options are checked at opening.** The picking session keeps the numbers it opened with, so an
   Experience disabled at 1 Fear stays disabled if the GM gains Fear with the panel open (reopen Attack). The server's
   NOT_ENOUGH_FEAR stays the live check for the primary. Default kept to avoid refusing an affordable spend from stale
   data the other way round.
3. **DEATH_MOVE_NOT_WAITING in the GM's death confirm.** The confirm card lives in `hud/death` (not owned); only the
   queue's own `run` maps it to the "Already answered" toast. If the death confirm should toast too, that is a one-line
   change there.

No rule question: the spotlight rule used ("For an adversary to use an action, they must have the spotlight", CB p.194;
the turn's extra spotlight costs 1 Fear, CB p.153) is the engine's existing behaviour.
