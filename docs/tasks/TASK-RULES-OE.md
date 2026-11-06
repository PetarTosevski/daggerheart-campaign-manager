# TASK-RULES-OE: the environment on attacks (M3 dim-light variants, the Underwater optional rule)

Plan `.omc/plans/rule-switches.yaml`, tracer OE (epic dcm-jh6d part A). Builds on RS0 (`ruleModesOf(campaign).darkness`,
`.darknessDifficulty`, `.underwater`), RM (M3 Book / Manual badge), RA / RA2 (`afterPcActionRoll` on every PC action
roll), RK (countdown ticks and their undo) and RT (the aftermath's planned rows). User answers: Q6 (changed,
2026-11-05: the GM picks disadvantage, +N Difficulty or both; N any whole number from 1, default 2; "Both" is not in
the books) and Q11 (b, changed, 2026-11-05: the full rule; the extra breath tick on a failure or with Fear happens by
itself, twice if both). Bead dcm-bxp.134 (2026-10-30): "Underwater combat CB p.168 (auto disadvantage + breath countdown
+ Stress per action)".

## The books

CB p.104, "Cover, Line of Sight, and Darkness":

> Darkness can also make certain actions more challenging. The GM should reflect this by raising the Difficulty of
> action rolls or imposing disadvantage on rolls made by the PCs.

CB p.168, "Moving and Fighting Underwater":

> Attack rolls underwater have disadvantage unless it makes sense for a character to easily fight underwater, like a
> Siren or Shark making an attack on a PC.
>
> For any creatures that can't breathe underwater, you can use a countdown to create tension about how long they can
> hold their breath. Set the countdown die's starting value to 3 or higher and tick down as follows:
>
> • Tick down once whenever any PC takes an action underwater.
> • If an action roll is a failure or with Fear, you can use your move to tick it down an additional time. (If the roll
> is both a failure and with Fear, you can tick it twice instead.)
>
> Once the countdown ends, a PC underwater must mark a Stress whenever they take an action.

## M3 `darkness` (registry modes: book, disadvantage, difficulty, both, manual; number `darknessDifficulty`)

| Mode | A PC's ranged weapon attack in dim light | The HUD title's badge (dim light) |
|---|---|---|
| Book (default) | Nothing added (today) | "Dim light: ranged attacks at disadvantage" |
| Dim light: disadvantage (CB p.104) | One disadvantage die | "Dim light: ranged attacks roll with disadvantage" |
| Dim light: raise the Difficulty (CB p.104; the number is ours) | +N to every target's Difficulty (a PC target's Evasion) | "Dim light: ranged attacks +N Difficulty" |
| Dim light: both (not in the books) | Both | "Dim light: ranged attacks roll with disadvantage, +N Difficulty" |
| Manual | Nothing; no note (nothing to apply, as RM) | none |

- "Dim light" is the campaign's light (`campaignLight`: the Witherwild's phase, else the GM's Day / Dim / Night), as
  the badge reads it. A night map's dim light-source bands do not count.
- "Ranged" is the weapon's printed range beyond Melee (`host.weaponRange`). It does not depend on Defined Ranges (ODR):
  with the rule off the weapon still has its printed range, so the variant applies the same way.
- The public roll line names what applied ("dim light: disadvantage", "dim light: +2 Difficulty"); a miss's GM line
  shows the raised Difficulty. A Minion offer (D6) compares the roll against the raised Difficulty too.
- Adversary attacks never get it (the book: "rolls made by the PCs").

## Underwater (optional rule `underwater`, off by default)

- The GM marks the live Combat Map scene Underwater from the HUD title's **Water** button (`combatScenes.setUnderwater`,
  keyed GM mutation; MECHANIC_DISABLED while the rule is off; INVALID for a start outside 3..20). On creates the scene's
  breath countdown: a public, unarmed dashboard countdown "Breath" (kind `breath`, start 3 or the GM's number), stored
  as `combatMaps.breathCountdownId`; marking it again with another start restarts it; off cancels the countdown. Each
  change writes a public, not undoable feed line.
- **Attack rolls** in an Underwater scene get one disadvantage die: a PC's weapon attack (`attackEnvironment` in
  convex/lib/combatActions.ts) and an adversary's attack whose token is on the map (`underwaterAttackDisadvantage` in
  convex/lib/adversaryActions.ts, a GM line "Bear attacks underwater: disadvantage"). A token the GM marks "fights
  underwater" (`combatScenes.setFightsUnderwater`, from the same pop-over's list) gets none.
- **Breath**: every PC action roll (plain and manual rolls, Tag Team, attacks, card and feature uses, the Cloaked roll:
  every path that runs `rollAftermath`) by a PC with a token on the Underwater live map ticks the countdown by
  `breathTicks`: 1, +1 on a failure, +1 with Fear (Q11 b). The tick goes through `applyTick` on the roll group's first
  row, so undoing the roll takes it back (RK's undo record); reaching 0 posts the countdown's trigger notice. A Tag Team
  ticks once (CB p.97: one action roll for countdowns). Reaction rolls never tick. A paused or cancelled countdown does
  nothing.
- **Out of breath**: once the countdown has ended (0, active or completed), each PC action roll marks 1 Stress on each
  roller on the map (a Tag Team: both) instead of ticking: a public row "Ash is out of breath underwater: marks 1 Stress"
  with the sheet before, in the roll's group (undo restores it). D4 `stressOverflow` is respected: Book marks 1 HP on a
  full track; Manual drops it and the GM gets "Ash: Stress full, mark 1 HP?".
- The HUD title shows "Underwater · Breath 2 of 3" (players too), "Underwater · Out of breath: each action marks a
  Stress" at 0.

## Interpretations (each reversible)

1. Darkness applies to ranged weapon attacks only (the plan and the existing badge), not to every action roll the book
   names ("raising the Difficulty of action rolls"). See Questions 1.
2. The roll that ends the breath countdown does not also mark Stress; the next action does ("Once the countdown ends").
3. Every PC on the Underwater map holds their breath (no "breathes underwater" mark for a PC). See Questions 2.
4. Only action rolls tick ("whenever any PC takes an action"); an action without a roll is the GM's to tick on the
   countdown card.
5. "Fights underwater" removes only the attack disadvantage, not the breath countdown.

## Code

- `src/lib/domain/combat-map/light.ts`: `darknessEdge`, `darknessBadge`, `DEFAULT_DARKNESS_DIFFICULTY`;
  `underwaterDisadvantage`, `breathTicks`, `breathEnded`, `BREATH_START`, `BREATH_MIN`. `dimLightBadge` is unchanged
  (RM's tests read the variants as the Book badge there).
- `convex/tables/combatMaps.ts`: widened `combatMaps.underwater?`, `combatMaps.breathCountdownId?`,
  `combatTokens.fightsUnderwater?`.
- `convex/lib/combatActions.ts`: `attackEnvironment`; `resolveAttack` adds its disadvantage, its Difficulty and labels.
- `convex/lib/adversaryActions.ts`: `underwaterAttackDisadvantage` in `adversaryAction`.
- `convex/lib/rollAftermath.ts`: `liveUnderwater`, the planned breath step (`Aftermath.notes` entry `underwater`, so a
  plain roll gets a group for it), `applyBreath`.
- `convex/combatScenes.ts`: `environment` (campaignQuery, view), `setUnderwater`, `setFightsUnderwater`.
- `src/components/combat-map/hud/scene/environment.tsx` (+ `index.tsx`, `scene.css`): the chips and the GM's Water
  pop-over.

## Not done (outside OE's files)

1. **Classic view badge**: `src/components/combat-map/vision/header.tsx` (`LightPill`) and `vision/panels.tsx`
   (`YourView`) call `dimLightBadge(light, darkness)`; they should call `darknessBadge(light, darkness,
   modes.darknessDifficulty)` so the classic map names the variant too (the HUD title already does).
2. **Card and feature attack rolls**: `convex/combatCards.ts` / `convex/lib/cardRunner.ts` and
   `convex/lib/featureRunner.ts` do not add M3's variants or the Underwater disadvantage to a card's attack roll; they
   could call `attackEnvironment(scene, host, ruleModesOf(campaign))` (exported from convex/lib/combatActions.ts).
3. **Map duplicate**: `convex/combatMaps.ts` `duplicate` copies `underwater` and `breathCountdownId` to the copy; it
   should drop both (the copy would share the countdown).
4. **Token menu**: "Fights underwater" is only in the HUD's Water pop-over; the token panel
   (`src/components/combat-map/tokens/token-panel.tsx`) could offer it too.
5. **docs/data-model.md**: document the three widened fields above.

## Questions

1. M3 variants on other rolls. CB p.104: "raising the Difficulty of action rolls or imposing disadvantage on rolls made
   by the PCs". Today only ranged weapon attacks. (a) keep ranged attacks only (the badge's wording); (b) every PC
   attack, Melee too; (c) every PC action roll with a Difficulty.
2. PCs who breathe underwater. CB p.168: "For any creatures that can't breathe underwater, you can use a countdown".
   (a) every PC on the map holds their breath (today); (b) a per-token "breathes underwater" mark that skips the breath
   tick and the Stress for that PC.

## Tests

`tests/convex/rules-environment.test.ts`: the pure helpers; M3 per mode on a Far weapon in dim light (Book, disadvantage,
difficulty with N, both, Manual; Melee and day light unaffected); Underwater refusals (rule off, player, start < 3), the
countdown's life (create, restart, cancel, the HUD query), the attack disadvantage and "fights underwater", the breath
ticks 1 / 3 / 2, the Stress at 0 and its undo, the tick's undo, reaction rolls and PCs off the map, D4 Manual's note.
`tests/convex/authz/rules-underwater.entries.ts`: `environment` (view), `setUnderwater`, `setFightsUnderwater` (GM).
