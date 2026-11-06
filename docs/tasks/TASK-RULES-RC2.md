# TASK-RULES-RC2: adversary attacks on PCs follow the rule switches

Plan `.omc/plans/rule-switches.yaml`, tracer RC2 (rules A1, C1 adversary side, D2, D4, Massive Damage, S1 adversary
side). Built on RS0 (`ruleModesOf`, `postRuleNote`), RDM (the pure damage modules take `PcHitRules`) and RX (the X1 note
on a hit). Manual = the app stops applying the rule and posts a GM-only note in the action's group (undone with it).

## What landed

| Piece | File |
|---|---|
| `HitRules` (= `PcHitRules` + A1 `armorSlots`), `armorOffered`, `MASSIVE_HP` exported | `src/lib/domain/adversary-actions/severity.ts` |
| The reaction window carries `rules` (`OpenInput.rules`, `WindowState.rules`; absent = Book): armor capacity, prompt, preview, `respond`, `resolveWindow`; preview and progress count Massive (4 HP, one slot → Severe) | `src/lib/domain/adversary-actions/window.ts` |
| Note texts: `hitRuleNotes`, `hiddenTargetNote`, `adversarySpotlightNote`, `hiddenCondition` | `src/lib/domain/adversary-actions/rule-notes.ts` |
| `hitRulesFrom` / `hitRulesOf` (the campaign's modes for a hit); `rebuildWindow` passes them; `applyRiders` takes D4 and reports `overflowDropped` | `convex/lib/adversaryHits.ts` |
| `openIncomingHit` opens the window with the modes; `resolveIncomingHit` posts the A1 / D2 / D4 notes in the hit's group and writes "Massive" in the GM row | `convex/lib/incomingHits.ts` |
| C1 Manual (no Hidden / Cloaked disadvantage, note); S1 (`spotlightActor` in `finish`) | `convex/lib/adversaryActions.ts` |
| Tests | `tests/convex/rules-adversary-attacks.test.ts` |

## Rules, book passages, behaviour

| Rule | Book passage | Book | Manual |
|---|---|---|---|
| A1 Armor Slots | CB p.114 "negate some (or all) of it by marking an available Armor Slot"; CB p.19 "You can only mark one Armor Slot per attack" | Unchanged: the hit PC is asked | Nobody is armor-capable: no responder for armor (a hit with no card, feature or grant to answer resolves at once), the prompt offers 0 slots, an armor answer is refused (`INVALID` from `respondToHit`, `NOT_A_RESPONDER` from the pure `respond`) and a stored one is ignored. HP marked at full severity. Note "Ash took Major damage; Armor Slot not offered" (only when the Book would have offered a slot: a free slot, not direct damage, no Frenzy). Forced slots (Shredding Strike) and slot substitutes (Stable, Celestial Wings) still apply: they are features, not the prompt |
| C1, adversary side | CB p.102 "While Hidden, any rolls against you have disadvantage"; Cloaked CB p.42 | Unchanged: one disadvantage per Hidden / Cloaked PC target (DA1) | No disadvantage from the condition; note per Hidden / Cloaked PC target "Brute attacks Ash (Cloaked): roll with disadvantage?" in the attack's group |
| D2 on PCs | CB p.99, p.107 | Halved, rounded up; immune none | Full damage; note "Ash resists: halve? (12 taken in full; halved: 6)" / "Ash is immune: no damage? (…)" |
| D4 on PCs | CB p.92 | 1 HP past a full Stress track | Extra Stress dropped (the hit's Stress-instead-of-HP and the attack's Stress riders); note "Ash: Stress full, mark 1 HP?" |
| Massive Damage on PCs | CB p.91 | Off: Severe, 3 HP | On: twice the Severe threshold marks 4 HP; one Armor Slot makes it Severe (3 HP) (user 2026-11-06); the prompt previews 4 / 3; the GM row says "Massive" |
| S1, adversary side (bead dcm-bxp.99.32.4) | CB p.100 "When play passes to the GM, the GM can make a move to spotlight an adversary"; CB p.194 "For an adversary to use an action, they must have the spotlight" | An adversary action that needs the spotlight moves it to the GM: its token on the live map is lit (`spotlightAdversary`), else `moveToGm(…, "adversary")`. Forced attacks and reactions don't | The spotlight stays; note "Brute acts: take the spotlight for the GM?" unless the GM already holds it on that adversary |

All notes carry the action's `groupId` (a hit's notes the hit's group; an attack's notes the attack's group) and the PC's
`characterId` where they name one.

## The spotlight-v2 conflict RDM left (resolved here)

RDM did not wire `spotlightAdversary` into `encounterTracking.spotlight` because a tracker spotlight that lit the token
would make a later `combatSpotlight.gmTake({ pay: "fear" })` on that adversary a no-op, breaking
`tests/convex/spotlight-v2.test.ts` "an adversary already spotlit this turn is not counted twice" (it expects the Fear
paid). RC2 wires S1 where the acceptance puts it, in the adversary-action path (`finish` in
`convex/lib/adversaryActions.ts`), and leaves the tracker button alone, so that test is unchanged and green. The
adversary path keeps the same invariant from both sides (tests in `rules-adversary-attacks.test.ts`):

- `gmTake` paid with Fear, then the adversary acts: the attack finds it lit, writes nothing, asks no Fear; its spotlight
  count stays 1.
- The adversary acts, then `gmTake` paid with Fear on it: the GM already holds it there, so nothing moves and no Fear is
  spent ("taking what the GM already holds spends nothing", as before).

`spotlightActor` runs before `commit` writes the action's own marks, so an adversary that marks its last HP by acting
still had the spotlight for that action.

## Not done (outside owns or open)

- **Vulnerable PCs, adversary side.** The adversary engine never gave advantage on attacks against a Vulnerable PC (only
  Hidden / Cloaked disadvantage, dcm-f3l7), so C1's Book half for Vulnerable is missing there; see Questions.
- D4 on the adversary runner's direct PC marks (a feature that makes a PC mark Stress outside a hit: `c.after` from
  `src/lib/domain/adversary-effects/run.ts`, not RC2's file) still overflows by the Book.
- F3 for adversary actions (`spotlightFearFor` in `convex/lib/adversaryFeatures.ts`) is still the Book.
- Reflected damage to the attacking adversary (`resolveIncomingHit`) uses the Book's D2 / D8 / Massive (adversary side,
  RC1's area).
- The comment block at the top of `convex/lib/spotlight.ts` still says `moveToGm` is "wired by bead dcm-bxp.99.32.4;
  until then only the GM's gmTake moves it" (not RC2's file).
- The HUD's hit window needed no change: with 0 slots offered it already shows the no-armor answer.

## Questions

1. C1 Book on the adversary side for a Vulnerable PC (CB p.102 "While you are Vulnerable, all rolls targeting you have
   advantage"). Today the adversary's attack ignores it. (a) add it per target, like Hidden (one roll, the Vulnerable
   target reads the higher die; a natural 20 only for the targets that keep it, which needs a second "critical" run the
   engine has only for the lower die); (b) add it only when every target is Vulnerable (the roll takes advantage);
   (c) leave it to the GM (pass `advantage` by hand).
2. S1 Manual for adversary spotlights: built as the briefs' table says (S1 covers adversary spotlights). (a) keep: the
   note "Brute acts: take the spotlight for the GM?"; (b) adversary actions always move the spotlight (S1 Manual only
   stops the PC-roll half); (c) Manual moves nothing and posts no note.
