# TASK CA4: Server - use a domain card (costs, limits, rolls, targets, outcomes, tokens, manual steps)

Plan `.omc/plans/combat-actions.yaml`, tracer CA4 (wave 4, depends on CA3). Analysis:
`.omc/autopilot/combat-actions-analysis.md` (git-ignored). Book pages are printed pages; CB = Core Book, HF = Hope & Fear.
Status: Review.

## What landed

| File | What |
|------|------|
| `convex/lib/cardRunner.ts` | Choice parsing, card checks (`pickCard`), combatants (`cardActor`, `pcCombatant`, enemies as CA3 reads them), `Creatures` (tokens → creatures with sight and encounter checks), `buildRun` (the runner's context), `runCard` (server dice, Reaper's Strike re-run), sheet and instance writes, row words, the Hand (`handOf`). |
| `convex/combatCards.ts` | `hand`, `useCard`, `sanction` (GM), `pending`. |
| `tests/convex/combat-cards.test.ts` | 25 behaviour tests, including one card per domain end to end. |
| `tests/convex/combat-cards-authz.test.ts` | 5 role tests. |
| `tests/convex/authz/combat.entries.ts` | Matrix entries for the four functions (setups `holdingCards`, `cardSanctioned`). |

No schema, validator or error code changed. The card sanction uses AA0's `sanctionActionValidator` member `card` as is.

## User answers implemented (quoted from the plan)

- **U1** "Players never see an enemy's HP, Stress or thresholds. They only learn hit or miss." **Q5** "player sees own damage total".
- **U3** "Automate EVERY domain card usable in combat … through a per-card effect table". CA4 runs every entry of the ten CE tables.
- **U4** "Damage applies automatically; the GM can undo it."
- **Q1** "an attack or card use on a target outside its range needs the GM's sanction (… nothing is rolled before approval)".
- **Q2** line of sight required, cover gives disadvantage. **Q3** shared `featureUses` key `card:<id>`. **Q4** "on a success"
  uses only on success. **Q7** server rolls the enemy reaction d20. **Q9** movement as prompts.
- User answer 2026-10-22: the GM may read any character's Hand via `combatCards.hand`, other players get FORBIDDEN; and
  (later the same day) the GM can "Play for this character": `useCard` accepts the GM for any character of the campaign,
  logged with the GM as actor and the character's id on the rows.

## Rules (quoted, printed pages)

- **R6** (CB p.101): "Some domain cards have an exhaustion limit that restricts how often you can use that card (for example,
  once per long rest)."
- **R8** (CB p.90): "When using a Hope Feature, if you rolled with Hope for that action, the Hope you gain from that roll can
  be spent on that feature."
- **R2** (CB p.98): damage dice "using your Proficiency"; crits "Start with the highest possible value the damage dice can roll,
  and then make a damage roll as usual". "Whenever damage would be applied more than once to a creature during a PC's move,
  the damage is always totaled before it's applied to the adversary's damage thresholds."
- **R5** (CB p.92): "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead mark 1
  Hit Point."
- **R12** (CB p.161): "If you meet or exceed the roll's Difficulty, the NPC succeeds."
- **R11** (CB p.103-104): Defined Ranges; "attack rolls against you are made with disadvantage" (cover).

## Public functions and roles

All asserted on `ConvexError.data.code` in `combat-cards-authz.test.ts` and in the matrix (`authz/combat.entries.ts`):

| Function | Wrapper | anon | outsider | other player (on Ash) | player (own) | GM |
|---|---|---|---|---|---|---|
| `combatCards.useCard` | keyedCampaignMutation `need: "view"` + `loadCharacter` edit, rate limit `roll` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok (plays for the character) |
| `combatCards.hand` | campaignQuery `need: "view"` + `loadCharacter` edit | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok |
| `combatCards.sanction` | keyedGmMutation, rate limit `roll` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | ok |
| `combatCards.pending` | campaignQuery `need: "view"`, `enough: "owner"` | UNAUTHENTICATED | NOT_FOUND | ok (own only) | ok (own only) | ok (all) |

## How it works

### `combatCards.useCard {characterId, mapId, cardId, spell?, targetTokenIds, choices, roll?}`

1. The character the caller edits (its player, or the GM), able to act (CHARACTER_UNAVAILABLE); its PC token on the live
   map (COMBAT_MAP_NOT_FOUND, COMBAT_TOKEN_NOT_FOUND).
2. The card: in the loadout (CARD_NOT_IN_LOADOUT); combat or passive in CA0's classification with an effect entry, and the
   use (`spell`, default the first action use) not passive (CARD_NOT_COMBAT; an unknown use is INVALID).
3. Targets: each token is resolved once. Enemies must be seen with a clear line (COMBAT_NO_LINE_OF_SIGHT) and be a running
   encounter's undefeated instance (COMBAT_TARGET_INVALID); PCs are party tokens; the actor's own token is "self". The side
   must fit the card (`enemy`, `ally`, `selfOrAlly`, `self`, `any`). A card for "all targets" with none named takes every
   enemy the actor sees in range (CB p.104). A `self` card targets the actor. All enemies share one encounter.
4. `choices` (flat `{id, value}` list, the shape AA0 stores in a sanction): `n:<choice>` numbers, `opt:<step>` options,
   `optional:<step>` true / false, `either:<i>`, `split:<tokenId>`, `situations`, `picked`, `allies`, `followUp`
   (token ids), `triggerSource`, `triggerSubject`, `triggerAmount`, `weapon`. Unknown ids are INVALID.
5. `roll`: trait, modifier, GM Difficulty, Experiences (1 Hope each, NOT_ENOUGH_HOPE; INVALID on a card without a roll),
   advantage, disadvantage, help. Cover on any enemy target adds one disadvantage; an attack roll adds the effects' attack bonus.
6. CA1's `run` with the server's dice. Refusals → CARD_EXHAUSTED, CARD_COST_UNPAID, COMBAT_TARGET_INVALID (too many
   targets), INVALID (unmet requirement, bad choice). A plan still missing a `choose` option or a split → `{status:
   "needsChoice", asks}`, nothing written.
7. A target outside the card's range (Q1; with an area, only the anchor is measured) → a `combatRequests` sanction of kind
   `card`, `{status: "pending", requestId, outOfRange}`. The refusals of step 6 come first; nothing rolled is kept.
8. Otherwise, in one mutation: the actor's sheet (Hope / Stress / HP / Armor from `plan.actor.after`, `featureUses` with
   the limit entry, the card's `cardTokens`, sheet effects and conditions, a card moved to the vault), each changed ally's
   sheet, the encounter instances (HP, Stress, defeated, conditions, tags; a Minion group loses one Minion per hit), the
   GM's Fear (gain or spend), countdown ticks after an action roll, and a Minion offer when damage earned extra defeats
   (picked with `combatActions.pickMinions`).
9. One actionLog group: the **public row** (kind `combat`: `Ash uses Bolt Beacon: Spellcast 15 with Hope; damage 7 mag
   (5) → Bandit: Hit`, the card's roll, the actor's `before`, `fearDelta`); one public row per changed ally (its `before`);
   one public row per manual step (kind `feature`: `Ash used Cinder Grasp: <text>`); the **GM row** (visibility `gm`:
   misses against the Difficulty, damage → severity → HP, marks, saves `reaction 9 vs 13 → fails`, conditions, HP / Stress
   now, `adversaryBefore` with conditions and tags).
10. Returns `{status: "resolved", entryId, cardId, useId, roll, damage[], success, targets [{tokenId, hit, defeated}],
    fearDelta, prompts [{kind: manual | move | pcSave | pcDamage | fold, text, tokenIds}], minionOffer}`.

Sheet effects: id `card:<cardId>:<n>`, source the card's name, `until` from the duration (temporary, nextRoll, manual,
permanent → manual), Evasion / attack / damage / one trait as `mods`, everything else in the text. Active card effects are
read back from that id (`effectActive` requirements); an `exclusive` use removes its card's old effects first.

### `combatCards.sanction {requestId, approve}` (GM) and `combatCards.pending`

Decline closes. Approve re-checks the card, targets and sight, skips the range check, runs the stored use and logs it with
the player who asked as actor. An ended encounter's request is declined. `pending`: open card sanctions with names and bands.

### `combatCards.hand {characterId}`

`{characterId, loadout[], vault[]}`; each card `{cardId, name, domain, level, type, recallCost, place, usage, state: ready
| exhausted | passive | outOfCombat, resetLabel, tokens, uses [{useId, name, activation, ready, resetLabel, usesLeft,
rolls, targets {side, range, count} | null, choices [{id, label, min}]}]}`. A card is exhausted when its `card:<id>` key
is used up or every limited use is. No enemy data.

### Undo (U4)

`actionLog.undo` of the public row (the player in its first minute: the row has a roll; the GM any time) restores the
actor's sheet (Hope, Stress, `featureUses`, `cardTokens`, effects, loadout), each ally's sheet, every instance's
`adversaryBefore` (HP, Stress, defeated, conditions, tags) and the Fear; tested with Hypnotic Shimmer, Flight and Share the
Burden.

## What a player receives (U1)

The result: their own roll (a fixed Difficulty is the card's printed number; a roll against targets has none), their
damage rolls, hit / miss / defeated per target, prompts made of card text and PC names. The feed: only public rows, which
name Hit / Miss / Defeated. Reaction rolls, Difficulties, HP and Stress are on the GM row only. Tests walk every key of the
result, the Hand, `pending` and the player's feed page (no hp, stress, difficulty, major, severe, thresholds,
adversaryBefore) and match the summaries against `HP|Stress|Difficulty|threshold|Minor|Major|Severe|(n/n)`.

## The domain tables' "Notes for CA4"

| Note | Handled |
|------|---------|
| Blade: riders with `to: "targets"` need the attack's targets | The client names them in `targetTokenIds`. |
| Blade: Reaper's Strike, picked must be a hit target, re-run with the same dice | `runCard`: a picked creature that is also a missed target is dropped and the use re-run with the recorded dice (generic; also Stunning Sunlight). |
| Blade: Onslaught floor is `auto` on every weapon attack | Not done: needs CA3's `resolveAttack` (convex/lib/combatActions.ts, not owned) to run auto riders. |
| Codex: pass `useId` for grimoires | `spell`. |
| Codex: Fireball `followUp` | `choices.followUp` token ids. |
| Codex: Banish optional default on | `DEFAULT_OPTIONALS`; `optional:banish` false declines. |
| Codex: Sigil `gather` (AA1 trigger source), `strike` rider | `triggerSource` / targets from the client; AA2 for the window. |
| Codex: Disintegration Wave, excluded as no number | The runner's `excluded` show as Miss publicly; the GM row says "not affected". |
| Sage: `useId`, riders' targets, Death Grip / Vicious Entangle `picked`, Healing Field `allies`, Steeds riders as targets, Wild Fortress `n:damage` | Through `spell`, `targetTokenIds`, `picked`, `allies`, `n:<id>`. |
| Sage: Wild Surge `rest` before `expire` | Not done: the rest flow (convex/rests.ts) runs no card timing uses yet. |
| Sage: Force of Nature upkeep | The runner's unpaid `pay` and the manual prompt. |
| Splendor: Second Wind situation from the host roll | Set by the server when the character's latest live action roll succeeded with Hope (a claimed one is stripped otherwise). |
| Splendor: Stunning Sunlight picks ≤ hit targets | Same re-run as Reaper's Strike; the count cap is the runner's. |
| Splendor: Salvation Beam splits | `split:<tokenId>`; without them `needsChoice`. |
| Grace: Share the Burden cap | `n:stress` capped at the target's marked Stress. |
| Grace: clearing Stunned ends the instance effect | No instance effects are written (see QUESTIONS). |
| Grace: Inspirational Words long-rest tokens | Rest flow, not owned. |
| Valor: two ally pickers | `picked` and `allies`. |
| Dread: Siphon Essence runner gap (dcm-0ib) | The server clears the HP the target marked and drops the manual prompt. |
| Midnight: Hush `picked`, Eclipse `allies` | Through the choices. |
| Arcana: Chain Lightning `followUp` | Through the choices; later links stay manual. |

## Checks

- `pnpm typecheck`, eslint on the changed files: clean.
- `vitest run tests/convex/combat-cards*.test.ts tests/convex/authz/combat.test.ts tests/convex/authz-matrix.test.ts`: 344 passed.
- Full `vitest --maxWorkers=4 --testTimeout=60000`: 263 files, 6409 passed, 1 expected fail.
- `convex/_generated/api.d.ts` was patched locally for the tests and not committed; the orchestrator regenerates it.

## QUESTIONS

1. **Adversary `effect` steps** (Glyph of Nightfall's Difficulty, Blighting Strike's half damage, Corroded): an instance
   `effects` entry can't be undone, because `adversaryBefore` (CA0's validator) has no `effects`. They are listed on the GM
   row "add in the tracker" instead. Widen `adversaryBeforeValidator` with `effects` (CA0-owned) to automate them?
2. **Damage to PCs** from a card (Fireball's blast on an ally) is a prompt ("mark it on the sheet"), not applied: Armor Slots
   and thresholds are AA2's window. Apply it directly, or open an incoming hit for it?
3. **Choices after the roll** (`choose` steps gated on success, damage splits): the use comes back `needsChoice` before
   anything is written, and the resubmitted use rolls again. Keep, or store the dice for a second call?
4. **convex/lib/cardRunner.ts is ~1,090 lines** (CH9 says under 800). Splitting the Hand and the row words into
   `convex/lib/cardHand.ts` / `convex/lib/cardRows.ts` needs those files in CA4's owns.
5. **Range of picked / ally / follow-up creatures** is not checked (their ranges are relative to areas and points the map
   doesn't model); only the targets (or an area's anchor) are measured. Fine?
