# TASK-RULES-OFT: optional rule Fate rolls (CB p.168)

Plan `.omc/plans/rule-switches.yaml`, tracer OFT (epic dcm-jh6d, bead dcm-bxp.134). Registry id `fateRolls`
(kind `optional`, off by default; RS0).

## The book

Core Book p.168 (PDF page 169), "Optional GM Mechanics", **Fate Rolls**:

> When narrating a moment outside the PCs' influence, the GM might wish to leave the outcome up to chance. In these
> situations, you can use a fate roll, asking a player to roll only their Hope or Fear Die to decide the result. Your
> choice of die doesn't affect the outcome, nor does the roll result grant Hope or Fear—the die type simply helps add
> flavor to the roll. You might roll the Hope Die in lucky circumstances or to see if fortune smiles upon the
> character, while the Fear Die can be used to decide whether a hazard comes into play or how dangerous a situation
> becomes.
>
> When making a fate roll, you can declare what event occurs if the result falls within a certain number range or
> determine the outcome based on how high or low the result is.
>
> "Roll your Fear Die. On a 4 or lower, the fire spreads beyond this house."

## User decision (binding)

Q13 (c, changed from the recommended a), 2026-11-05: "a 'Fate roll' button in every player's dice box (Hope or Fear
die, no GM step), no Hope/Fear gained." This replaces the plan entry's acceptance line, which was written for (a)
(a `gmMutation` in the GM's roll panel).

## What landed

| Piece | File |
|---|---|
| `fateRolls.status` (campaignQuery, view): `{ enabled, characters: [{ _id, name }] }`; a player gets their own active PCs, the GM and co-GMs every active PC; empty while off | `convex/fateRolls.ts` |
| `fateRolls.roll` (keyedUserMutation, edit on the PC, rate limit `roll`) `{ characterId, die: "hope" \| "fear", note? }` → `{ entryId, roll }` | `convex/fateRolls.ts` |
| "Fate roll" section under the public free-roll form (the HUD's player Dice pop-over "Free dice", the dashboard's "Roll dice") | `src/components/party/dice/free-roll.tsx` |
| Tests, authz entries | `tests/convex/rules-fate-rolls.test.ts`, `tests/convex/authz/rules-fate.{entries,test}.ts` |

## Behaviour

- **Off (default):** no Fate roll section; `fateRolls.roll` throws `MECHANIC_DISABLED`.
- **On:** the section lists the caller's PCs (a picker only with more than one), an optional "Decides" note, and
  "Roll Hope Die" / "Roll Fear Die". The server rolls one d12 and logs a **public** `actionLog` row of the PC, kind
  `roll`, roll kind `free` (never a counted action roll), dice `[{ sides: 12, role: "hope" | "fear" }]`, summary
  `Fate roll for Mira (Fear Die): 4 · On a 4 or lower, the fire spreads`. It changes no Hope, Stress, Fear, countdown
  or spotlight and saves no sheet. Undo is the GM's (a rolled row, `groupGmOnly`).
- A player rolls only for a PC they edit (FORBIDDEN otherwise); the GM for any PC. Dead or away PCs are not listed but
  the server does not refuse them (the book ties the roll to a moment outside the PCs' influence, not to the PC acting).
- The die is always a d12: every SRD Hope Die change (Rise to the Challenge, Reliable Backup) applies to a Duality roll
  only.

## Not done (outside OFT's owns)

- The character dice box itself (`src/components/party/dice/dice-box.tsx`) has no Fate roll button; the section sits
  in the free-roll form beside it. Moving it there is a mount of the exported `FateRoll` (in a `DiceBoundary`) in that file.
- The GM has no Fate roll button: the GM's dice (HUD pop-over and dashboard) show only the secret GM roller (mode
  `gm`), and Q13 c gives the roll to players. The server accepts the GM's call for any PC (as `rolls.actionRoll`
  does), so a GM button is a UI change only.
