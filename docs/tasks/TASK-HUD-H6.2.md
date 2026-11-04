# TASK-HUD-H6.2: blocked states on the player surfaces

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 7 batch B, tracer H6.2 (boards CmpBlocked, Main 'Can't afford',
CmpCards). Parent bead dcm-bxp.99.32. Depends on H6.1 (`docs/tasks/TASK-HUD-H6.1.md`: the refusal table, the shortfall
helper, the three layers, the toast host). Mode: add (HUD only; the classic UI is unchanged).

## What landed

Every HUD player control with a known cost, limit or spotlight rule now uses H6.1's layers. No surface writes a refusal
sentence of its own any more: the words come from `src/lib/errors/refusals.ts` and
`src/lib/domain/combat-actions/shortfall.ts`.

| Control | Before the click (layer 1) | At the click (layer 2 / 3) |
|---|---|---|
| Hand card Use (`hand/states.ts`, `parts.tsx`, `body.tsx`) | Card tag "Needs 1 Hope" (`blockedReason` → `tag`), grey wash, Use `aria-disabled` + described by "Needs 1 Hope · you have 0". GM's spotlight: tag and reason "The GM has the spotlight · reactions only". Reaction / passive cards keep their own tag (never blocked). Full card view: the same, with the reason under the text. | A press on a blocked Use: the refusal as a toast near the hand ("Not enough Hope / Wall Walk costs 1 Hope. You have 0. / Roll with Hope…", board Main). A card that asks nothing and is refused by the server: `RefusalMessage` above the fan (`use-play.ts` `refusal`), or a toast where the table places it. |
| Roll options' Experience chips | "Needs 1 Hope" from `shortfallTag`. | — |
| Sheet feature Use (`sheet/panel.tsx`) | Hope cost it can't pay (`featurePlan` costs vs. the sheet's Hope) or the GM's spotlight: Use `aria-disabled` with a lock, the reason (`BlockedReason`) under the feature. React is never blocked. A spent use: the sheet badge "Used · back after …" in place of the dead button. | A press on a blocked Use: `RefusalMessage` under the feature (FEATURE_COST_UNPAID / SPOTLIGHT_WITH_GM). Tracker, condition and hide-hand failures: `refusalFor` + `RefusalMessage` (was `errorMessage`). |
| Picking panel (`pick/panel.tsx`, `session.tsx`, `model.ts`) | GM's spotlight: the primary waits with the SPOTLIGHT_WITH_GM reason (`spotlightBlocks`: new actions only; `followUp` sessions, reactions and the GM's adversary sessions never). Picker counter "1 of 2"; full: "Pick up to 2 targets." beside it and the other rows `aria-disabled`. Hope lines in pick-card / pick-attack / pick-feature from `shortfallLabel` / `shortfallOf`; Minion offer past its count: "Pick up to n targets." | A throw from `primary.send`: `refusalFor(error, { subject, target, max })` → `RefusalMessage` under the primary (`data-testid="hud-pick-error"`), or a toast for a toast-placed code. The refused target's ring shows the table's form: COMBAT_TARGET_INVALID dims it, COMBAT_NO_LINE_OF_SIGHT makes it dotted, COMBAT_OUT_OF_REACH puts the hint ("Move next to … first.") under it (`refusedRing`). |
| Waiting for the GM: Withdraw (`pick/waiting.tsx`) | — | REQUEST_NOT_OPEN → "Already answered" toast; anything else under the card (`RefusalMessage`). |
| Minion offer: Skip (`pick-attack/prompts.tsx`) | — | Same pattern. |
| Action ring (`action-ring/model.ts`, `index.tsx`) | `featureLock` from the table (`FEATURE_EXHAUSTED` lead + reset label; `shortfallSentence(…, { verb: "needs" })` → "Evolution needs 3 Hope. You have 0."). GM's spotlight: Attack, Cast and every feature locked with "The GM has the spotlight · reactions only" (`spotlightLock`); Sheet and More never lock. | A press on a locked button shows its reason beside it (the existing tip: board 'Can't afford' ring lock). |
| Token (`token/hooks.ts`, `token/model.ts`; call sites in `tokens/tokens-layer.tsx`) | GM's spotlight (user answer 2026-11-01: moves are refused like actions): the player's drag and key moves are not sent (`useHudMoveLock`). | The lock as a toast (`refuseMove`; a token has no control to put it under). A server MOVE_BLOCKED: the move notice reads "Something blocks the way." (`moveNoticeText`) and the token snaps back (Convex rolls the optimistic move back, as before). |

New session flag `PickSessionSpec.followUp` (pick/types.ts): set on the card chain links (`pick-card/chain.tsx`), the
feature's after-the-roll asks (`pick-feature/index.tsx`), the Minion offer and a forced attack (`pick-attack/model.ts`),
so the GM's spotlight (often taken by that very roll) never blocks finishing a use under way.

**Stress:** never locks anything (H3.4's default kept: Stress past full marks a Hit Point, CB p.106).
`hopeShortfall` / the sheet / the ring pass only `{ hope }` as the room.

## Board states matched

- Main 'Can't afford' (1440x900): Wall Walk's tag "Needs 1 Hope" with the grey wash, the toast "Not enough Hope" near
  the hand after a press, the ring's Evolution locked "Evolution needs 3 Hope. You have 0.". Shot:
  `test-results/visual/HUD-H6.2/cant-afford-1440.png` (from `tests/e2e/hud-blocked.spec.ts`).
- The GM's turn with the blocked controls: `test-results/visual/HUD-H6.2/spotlight-with-gm-1440.png`.
- CmpBlocked player rows: card tag + Use disabled (hand), feature disabled (sheet), sheet badge (spent use), picker
  counter (panel), ring dimmed / dotted ring / ring + hint (target rings after a refusal), token snaps back on
  MOVE_BLOCKED (map). Covered by `tests/unit/hud/blocked-player.test.tsx` and the e2e spec.

Differences from the boards: the sheet's reason reads H6.1's layer-1 form ("Needs 3 Hope · you have 0") where Main's
sheet shows "Needs 3 Hope. You have 0." (the table's before-the-click form wins, H6.1 Q3). The "ring dimmed" /
"dotted ring" / "ring + hint" forms are drawn after the server's refusal names the target; before the click the rings
already show no line of sight (dotted, H3.0), and out of range stays "GM approves" (hard rule 3).

## Tests

- New `tests/unit/hud/blocked-player.test.tsx` (19): the words, the hand (tag, toast on a press, spotlight, a refusal
  above the fan), the panel (spotlight, follow-up, counter, the three ring forms, a toast-placed code, the refusal
  context), the sheet (Hope lock + refusal under the row, Stress not locked, sheet badge, spotlight with React kept).
- New `tests/e2e/hud-blocked.spec.ts` (3): Main 'Can't afford', the spotlight-with-GM disable with the hit window
  usable, MOVE_BLOCKED at the click; axe on each.
- Existing assertions changed (intent kept; wording now from the table):
  - `tests/unit/hud/action-ring.test.tsx`: "Rally is used. Back after a long rest." → "Rally is used up for now. Back
    after a long rest."; "Beastform is used. Back after a rest." → "Beastform is used up for now. Back after a rest."
  - `tests/unit/hud/hand-states.test.tsx`: Wall Walk's Use `disabled` → `aria-disabled="true"` with its reason as the
    accessible description.
  - `tests/unit/hud/pick-panel.test.tsx`: the panel refusal asserts `data-code` CARD_COST_UNPAID and the table's text
    instead of `errorMessage`; Withdraw's REQUEST_NOT_OPEN is now a toast ("Already answered"); a new case keeps the
    inline path (FORBIDDEN, by `data-code`).

Runs on this branch: `hud-blocked.spec.ts` 3/3 pass. All `tests/e2e/hud-*.spec.ts`: 34/35 on the first run; the
failure was `hud-result.spec.ts` on a critical hit ("1d8+9 → 17 physical" against a regex for "+8 critical"), which
depends on the dice, not on H6.2. Its rerun: 2/2 pass. The e2e spec presses blocked controls from the keyboard
(`focus` + `Enter`), because Playwright treats `aria-disabled` as not enabled.

Seen in the shot: the toast host (H6.1, `hud/toasts`) places the toast near the top of the map, not right beside the
fan as on Main. That is the host's placement (not in H6.2's owns); a follow-up for H6.1's owner if it should move.

## Out-of-owns edits

- `src/components/combat-map/tokens/tokens-layer.tsx` (5 lines): reads `useHudMoveLock` / `refuseMove` /
  `moveNoticeText` from `hud/token` (HUD only; with the switch off nothing changes).
- `tests/unit/hud/action-ring.test.tsx`, `hand-states.test.tsx`, `pick-panel.test.tsx`: the assertion updates above.

## Merge-time actions (orchestrator)

None. No codegen change.

## Beads

None filed.

## QUESTIONS (safest reversible defaults taken)

1. **Recalling a card while the GM holds the spotlight.** CB p.26: "You can normally only move an inactive card from
   your vault to your loadout during downtime, but you can mark a number of Stress equal to a card's Recall Cost to swap
   it immediately." Is a recall in combat an action the GM's spotlight blocks? Default: the vault's Recall stays
   enabled (the server's `assertMayAct` does not name it either).
2. **Where a refused token move is told.** The table places SPOTLIGHT_WITH_GM inline; a token has no control to show it
   under, so the HUD shows it as a toast near the hand. Say if it should sit in the move notice above the token instead.
