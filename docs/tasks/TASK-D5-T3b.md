# TASK-D5-T3b: Frame rest hooks

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T3b (after T3). When the GM finishes a party rest (`rests.finish`, or `rests.interrupt` of a long rest, which runs as a short rest), `runRestHooks` (convex/lib/restHooks.ts) runs each frame's own rest rule behind its frame and option checks.

## Where the hooks live

| Frame | Hook | File | Option |
|---|---|---|---|
| Journey to Horizon | `horizonRestHook` (runs first: it may refuse the rest) | convex/trackers/horizon.ts | `enduranceCountdowns` (Endurance part only) |
| The Age of Umbra | `ageOfUmbraRestHook` | convex/trackers/ageOfUmbra.ts | none |
| Colossus of the Drylands | `colossusRestHook` | convex/trackers/colossus.ts | none |
| Beast Feast | `beastFeastRestHook`, `extraMoves` | convex/lib/restHooks.ts | none |
| Dark Heart of Andaluria | `andaluriaRestHook` | convex/trackers/andaluria.ts | `transformations` |
| Motherboard | `motherboardRestHook` | convex/lib/restHooks.ts | `remnantCorruption` |

Pure parts (frame ids, Keep Watch rolls, Horizon days, countdown owner keys, the Corruption tracker schema and roll) are in `src/lib/domain/rest/frame-hooks/index.ts`. No new public functions, tables or error codes.

Undo (plan note 11): `rests.undo` restores the sheets (a Lurking Darkness Hope, Vulnerable cleared by Endurance) and the rest's own Fear. Tracker changes (Siphoning, the Lurking Darkness log and its Fear, the crawl day, Endurance and Lycanthropy countdowns, Corruption) keep their own history and controls.

The rest's campaign feed row is public, so the GM-only Siphoning Track and the Lurking Darkness rolls do not appear in it; the GM sees them in the tracker panels.

## Rules and book passages (re-checked in the books' text)

### The Age of Umbra (CB 289)

> "When the party finishes a short or long rest while not in the vicinity of a Sacred Pyre, roll a d12 for the Lurking Darkness and consult the following list: 1–2: … An adversary of the GM's choice initiates conflict. 3–5: … You gain 2 Fear. 6–9: … You gain a Fear. 10–11: … No effect. 12: … Each PC gains a Hope."
>
> "Keep Watch: … When the GM makes a Lurking Darkness roll at the end of downtime, you roll your Hope Die and choose whether to replace their roll with yours. If multiple players choose this move, you can take the highest die roll."

Unless the tracker's "at a pyre" flag is set, the server rolls the d12 plus one Hope Die per Keep Watch pick (`resolveLurking` takes the best), logs it on the tracker, applies Fear through `gainFear`, and on a 12 gives each resting PC a Hope on the rest's sheets.

### Colossus of the Drylands (CB 327; the plan cites 309-312, but the rule is on 327)

> "When the PCs take a short rest during the hunt phase, mark the Siphoning Track once. When the PCs take a long rest during the hunt phase, mark the Siphoning Track twice. Each time a colossus is defeated, or when the Siphoning Track is full, roll as many d12s as marked slots … Increase Kudamat's Power by the highest value rolled, then reset the Siphoning Track to 1."

The hook calls the tracker's `markRest` (a full track rolls at once) during the hunt phase only. An interrupted long rest marks once (short-rest effect).

### Journey to Horizon (HF 176; full example HF 178-179)

> "Outside a sanctuary, the party can take only short rests, each of which represents an entire day spent in one location. Inside a sanctuary, the party can take a long rest, which represents multiple days recovering from hard travel and rough sleeping."
>
> "When the party takes three short rests in a row, their next rest must be a long rest (see page 105 of the core rulebook)."
>
> HF 179: "they've already taken two short rests since their most recent long rest. That means they won't be able to take any more short rests until they take a long rest—and they can do that only in a sanctuary."
>
> Optional rule, Endurance Countdowns: "At the end of a rest, each PC gains an Endurance Countdown (6). When the party enters a wilderness hex, each player rolls their Hope Die. If the result is equal to or lower than the value of their PC's Endurance Countdown, they mark a Stress. Otherwise, they tick down their Endurance Countdown. When a PC's Endurance Countdown triggers, they become Vulnerable until their next rest. At the start of a rest, all PCs' Endurance Countdowns end."

- A long rest (not interrupted) is refused with `REST_RULE` when the hex crawl has the party on a hex with no sanctuary marker. With no party hex placed, it is allowed.
- A short rest advances the crawl's day counter by one, except a short rest the GM forced past the third in a row (`gmOverride`), as the plan's acceptance says.
- With `enduranceCountdowns` on, each resting PC's Endurance Countdown (one row per PC, `ownerKey` `endurance:<id>`, `kind` `endurance`, revealed) restarts at 6. If it had triggered, Vulnerable comes off that PC's sheet.

### Beast Feast (CB 277-279)

> CB 278: "During downtime, players can't choose downtime moves to clear Stress, clear Hit Points, or gain Hope. Instead, they have a new downtime move: Make a Feast. … The PCs who choose to Make a Feast during downtime prepare the food together. They should collaborate to decide which ingredients they're using … All PCs who eat the meal can individually use the value of the Meal Rating to clear Hit Points, clear Stress, and gain Hope, dividing this value however they'd like."
>
> CB 279, Berry's Restaurant: "When the PCs are near an open Berry's Restaurant during their downtime, they can each spend a handful of gold to order food and choose a downtime move to clear Stress, clear Hit Points, or gain Hope. Only 2 handfuls of gold can be spent per PC during downtime."

`extraMoves` offers Make a Feast on both rests in Beast Feast campaigns (`rests.choose` accepts it). On finish the feed names the cooks and reminds them to record the dish and split the Meal Rating. The rest is under Questions.

### Dark Heart of Andaluria (HF 153)

> "activate a long-term Lycanthropy Countdown (6). It ticks down each time the PC takes a rest without using a downtime move to halt their lycanthropy's progression. When it triggers, the PC gains the Werewolf transformation."

With `transformations` on, each resting PC's active Lycanthropy countdown (`ownerKey` `lycanthropy:<id>`) ticks once through the countdown rules and `history`, skipped for a PC who picked the halt move. A trigger is announced in the feed; the transformation is set by hand (player consent).

### Motherboard (CB 295)

> "OPTIONAL RULE: CORRUPTION TRACK. If a Beastbound ranger has a remnant companion … At the beginning of downtime, the ranger rolls their Fear Die. If it lands on a 1, they must mark a Corruption and describe the temporary glitch that overcomes their companion. … If the companion's last Corruption is ever marked, the remnant becomes violent and can no longer be commanded or repaired."

With `remnantCorruption` on, each resting Beastbound ranger's Fear Die (d12) is rolled. A 1 marks a Corruption in the `motherboard.corruption` frame tracker (marks per character plus the last 10 rolls, with `schemaVersion`), and the feed says so.

## Questions (reversible minimums, listed in the report)

1. Keep Watch and the Lycanthropy halt move have no id in `restMoveValidator` yet. The hooks already look for `keepWatch` / `haltLycanthropy`.
2. Lurking Darkness on an interrupted long rest: it is rolled, because the party still gets a short rest's benefits.
3. Horizon: should a short rest past the third be refused outright in Horizon (HF 176, and the user's "hex crawl rules win"), rather than given with no day passing? How many days does a long rest pass ("multiple days")? An interrupted long rest passes none.
4. Horizon Endurance: the hex-entry Hope Die rolls and ticks belong to `maps.moveToHex`. An interrupted short rest doesn't end the countdowns, because no hook runs.
5. Beast Feast: the move restriction, Berry's Restaurant, and how the meal is applied.
6. Motherboard: the track's length (a printed graphic with no number in the text), whether a living-creature companion is exempt, and rolling at the end of downtime rather than at its beginning.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test` (new: `tests/convex/rest-frame-hooks.test.ts`, 16 tests, each hook on and off), local push with `--typecheck=enable`, `tests/e2e/rest-frame-hooks.spec.ts` (with `rest.spec.ts` and `colossus.spec.ts`).
