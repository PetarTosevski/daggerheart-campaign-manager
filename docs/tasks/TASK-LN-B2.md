# TASK LN-B2: GM-entered Difficulties via requests (player's Charge, Cloaked vs an enemy without one), payload expiresAt optional

Plan `.omc/plans/lanes.yaml`, tracer B2 (lane `w0-b-server-prompts`). Beads dcm-bxp.99.19.61, dcm-bxp.99.19.62 item (1),
dcm-bxp.99.19.60. Builds on B1 (docs/tasks/TASK-LN-B1.md) and C1 / C3 (docs/tasks/TASK-LN-C1.md, TASK-LN-C3.md). Book pages
are printed pages (CB = Core Book).

Status: Review.

## Rules and answers

- CB p.59, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or
  more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range." CB p.104: "The GM
  sets this Difficulty". User 2026-10-30 (dcm-bxp.99.19.61): the player picks the target and the landing square in the
  drawer; the GM gets a request with a Difficulty box (like the out-of-range sanction queue); on submit the server rolls
  Agility and moves the token on success.
- CB p.42 (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an adversary, you are no
  longer Cloaked." DA18 (dcm-bxp.99.19.53 (4)): seen only in dim light, one Finesse action roll against the highest
  Difficulty among the seers. User 2026-10-30 (dcm-bxp.99.19.62 (1)): when the only enemies seeing the rogue dimly have no
  Difficulty (a custom token, an enemy-side PC or companion), the GM gets a prompt to enter a Difficulty, then the Finesse
  roll happens.

## What was built

| Piece | Where | What |
|---|---|---|
| `difficulty` request kind | `convex/lib/validators/combatRequests.ts` | Widened: kind `difficulty`, payload `{ schemaVersion: 1, kind, characterId, ask }`. `ask` is `charge` (target token, square, Stress, the player's roll options, never a Difficulty) or `cloak` (the rogue's token, the square the move ended on, the dim seers, the move's actionLog group). |
| Open / supersede / undo | `convex/lib/combatRequests.ts` | `openDifficulty` declines the character's older open request of the same `ask.kind` first. `declineGroupOffers` (run by undo of a group with a `combat` row) also declines an open `cloak` request of that group (a Charge undone). |
| A player's Charge | `convex/featurePrompts.ts` `charge` | The GM's Charge runs at once with `roll.difficulty` (required; INVALID without). A player's Charge must send no Difficulty (INVALID with one): the feature, the limit, the target and the square are checked as before (player rules: walls stop it), nothing is rolled, paid or moved, and a `difficulty` request opens (`{ status: "requested", requestId }`), tied to the target's encounter. The Charge body moved to `runCharge` (shared). |
| The GM's answer | `featurePrompts.answerDifficulty` (new, GM) | `{ requestId, difficulty: number \| null }`. `null` declines. A Difficulty must be a whole number of 1 or more (INVALID). A request whose encounter ended is declined. `charge`: runs `runCharge` with that Difficulty, with player rules for the way, the rows belonging to the player who asked (`createdBy`); refusals as `charge`'s leave the request open. `cloak`: `answerCloakDifficulty`. |
| Cloaked waits for a Difficulty | `convex/lib/combatMovement.ts` | `cloakRoll` now opens the `cloak` request when no dim seer has a Difficulty (instead of making no roll), and Cloaked stays meanwhile; the roll itself is `rollCloak` (unchanged DA18 roll). `answerCloakDifficulty` rolls only while the move stands: the map is live, the token is still on the square, the rogue is still Cloaked, active and conscious, and the move's group has no undone row. Otherwise it declines the request and returns `stale`. The roll's rows join the move's group and belong to the player who moved; the GM row reads "Difficulty N (set by the GM)". |
| The queue read | `combatRequests.difficulties` (new, view) | The GM gets every open `difficulty` request; a player only their own. Names only (U1): character, Charge target, dim seers. Requests whose encounter ended are left out. The module's `tokenName` now names a PC token (its character) and a companion ("Companion") too: an enemy-side PC can be a seer. |
| GM UI | `src/components/combat-map/requests/**` (new) | `DifficultyRequests` lists the waiting rolls ("Ash charges at Bear: Agility Roll", "Ash is Cloaked in dim light, seen by Shade: Finesse Roll") with a Difficulty box, Roll and Decline (44 px controls), an optimistic update dropping the answered row, the result line, its own error boundary. `useWaitingDifficulty` for the drawer. |
| Drawer | `src/components/combat-map/drawer/use/index.tsx` | A player's Charge: pick target, square, Stress, then "Roll Agility and charge" sends it to the GM ("Charge at Bear sent to the GM, who sets the Difficulty and rolls."); while it waits the drawer says "Waiting for the GM: Charge at Bear…" and the button is off. The GM's drawer keeps its Difficulty box and also lists the character's waiting Charge (`DifficultyRequests` filtered). |
| `expiresAt` | `convex/lib/validators/combatRequests.ts`, `convex/lib/featurePrompts.ts` | dcm-bxp.99.19.60, widen step: `targetCountPayloadValidator.expiresAt` is optional, no longer written (`TARGET_COUNT_NO_EXPIRY` removed); the comments name the scene mark instead of the old TTL. `allyRoll`'s `expiresAt` is a live TTL and stays. |

## Public functions (authz: tests/convex/authz/prompts.entries.ts)

- New: `featurePrompts.answerDifficulty` (gm), `combatRequests.difficulties` (view).
- Changed: `featurePrompts.charge` (a player's call opens a request; new `requested` result; the player's row now stops at
  FEATURE_NOT_OWNED, the GM's at INVALID).

## Tests

- `tests/convex/feature-prompts.test.ts`: the Charge tests now go player request → GM answer (Difficulty 12). New: the
  request rolls, pays and moves nothing and both GM and player see it (another player does not); the GM's Difficulty rolls
  it, the rows are the player's, the request resolves, a second answer is REQUEST_NOT_OPEN; a Difficulty above the total
  fails and the token stays; decline, Difficulty 0 / 2.5 refused, a newer Charge replaces the older request; an ended
  encounter hides it and the answer declines it; a player's Difficulty and a GM's Charge without one are INVALID. Cloaked:
  a custom token alone sees the rogue dimly → a request, no roll; the GM's 14 rolls (failure ends Cloaked, the public row
  hides the Difficulty, the GM row names it); a success keeps Cloaked; an adversary among the seers rolls at once with no
  request; a newer move replaces the request and an answer to a moved-away token is `stale`; decline keeps Cloaked; a
  player's answer is FORBIDDEN. The target count payload has no `expiresAt`.
- `tests/convex/authz/prompts.entries.ts`: rows for `answerDifficulty` and `difficulties`; `charge`'s allowed codes.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (364 files, 9067 passed, 1 expected fail) pass.

## For the orchestrator (outside B2's owns)

1. **Mount the GM queue.** The GM column's request list is `src/components/combat-map/actions/gm/index.tsx` (lane E4 /
   not B2's). In `Resolutions`, add the queue above the sanctions:
   ```tsx
   import { DifficultyRequests } from "../../requests";
   // …
   <h2 className="cm-h">Resolutions</h2>
   <DifficultyRequests campaignId={campaignId} />
   <Sanctions campaignId={campaignId} />
   ```
   Until then a player's Charge is answered from the GM's drawer of that character (it lists the waiting Charge), and a
   Cloaked `cloak` request has no GM surface.
2. **UI unit tests** for `requests/` and the drawer's player path would live in `tests/unit/` (not in owns). The existing
   `tests/unit/drawer-use.test.tsx` passes unchanged.
3. **dcm-bxp.99.19.60 follow-up:** migrate (`@convex-dev/migrations`, batched) to clear `expiresAt` from old `targetCount`
   payloads, then narrow the validator (drop the field). Rule 7.
4. `docs/data-model.md`: `combatRequests` gains kind `difficulty` (payload above); `targetCount.expiresAt` optional.

## Known edges

- An open `cloak` request from a plain move (no Charge) has no encounter: it stays open until answered, declined, replaced
  by the rogue's next request, or found stale on answer. The retention cron sweeps it only once closed.
- The answer re-checks only the token's square, Cloaked and the group; if a new enemy came into clear sight meanwhile, the
  answer still rolls (the next move re-checks sight).
- A Charge answered by the GM that needs another choice (none does today) is refused with INVALID; the GM declines and
  plays it from the drawer.

## QUESTIONS

None.
