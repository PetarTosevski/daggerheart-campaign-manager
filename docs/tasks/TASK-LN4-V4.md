# TASK-LN4-V4: foundation widen 4 (plan lanes-2, wave 10)

Branch `lane4-v4`, lane `w3-vocabulary`. Types and validators only, widen only, no behaviour change. Every new field is
optional; no stored shape got a version bump (rule 7: optional members are a widen, old rows stay valid).

## What landed (every new name, with the tracer that uses it)

| Bead | Name | Where | Used by |
|---|---|---|---|
| dcm-dztv | `AdversaryDef.attack.keyword?: DamageKeyword` | `src/lib/srd/types.ts` (imports `DamageKeyword` from card-effects/types.ts, type only) | E2.4 reader; S3.4 data (Elemental Blast CB p.214, Burning Candlestick HF p.67, Spirit Flame HF p.77, Catrin's Spirit Flame HF p.81 per the 2026-11-01 answer) |
| dcm-n7kt | `markHp` step `keyword?: DamageKeyword` | `src/lib/domain/card-effects/types.ts` (an `OutcomeStep`, so adversary steps get it too) | E2.4 engine; S4.4 data (t4-hf.ts Fire Beam) |
| dcm-hqk1 | `RollEnd.situation?: string` | card-effects/types.ts | E1.4b (only a ticked Presence Roll ends the effect); S2.4 data |
| dcm-hqk1 | `Mod` `dualityDie` `situation?: string` | card-effects/types.ts | E1.4b dice box ("In conversation: use Reliable Backup"); S2.4 data (ranger-rogue.ts Reliable Backup: today the effect has `mods: []` and the die is a `modifyRoll hopeDie` step gated by a `situation` requirement) |
| dcm-1sk4 | `sanctionRollOptionsValidator.spiritWeapon?: boolean` | `convex/lib/validators/combatRequests.ts` | E1.4b consumer (held attack keeps the Spirit Weapon box) |
| dcm-mcgj | feature `sanctionActionValidator` member `riders?: Rider[]` | combatRequests.ts | E1.4a (`useFeature` stores, the sanction replays) |
| dcm-vx5n | kind `cloakPrompt`, `cloakPromptPayloadValidator` `{ schemaVersion: 1, kind, characterId, tokenId, label, groupId, targetTokenIds }`, type `CloakPromptPayload` | combatRequests.ts | E1.4a (`convex/lib/cloakPrompts.ts` opener, `cloakPrompts.answer { requestId, ends }`) |
| dcm-uxsd | kind `forcedAttack`, `forcedAttackPayloadValidator` `{ schemaVersion: 1, kind, characterId, instanceId, instanceLabel, feature, targetTokenIds, groupId }`, type `ForcedAttackPayload` | combatRequests.ts | E7.4 writes (convex/lib/forcedAttacks.ts); E1.4b reads (player query, locked Attack bar) |
| dcm-sk4r | `damageKeywordValidator` (`v.literal("fire")`, compile-time checked equal to `DamageKeyword`) | combatRequests.ts | E2.4 |
| dcm-sk4r | `incomingHit` payload `keywordAsk?: { keyword, characterId, feature, answer?: boolean, answeredBy?: Id<"users"> }` (`keywordAskValidator`, type `KeywordAsk`) | combatRequests.ts | E2.4 (opens the ask, records the GM's answer) |
| dcm-sk4r | `keywordAnswerValidator` `{ keyword, carries: boolean }` (type `KeywordAnswer`) | combatRequests.ts | E2.4 (args of the GM's answer mutation) |
| dcm-lztq | sheet `Effect.casterId?: string` (character id, 1..40 chars) | `src/lib/validation/characters.ts` | E1.4a (cards), E8.4 (features), E6.4 (readers + backfill migration) |
| dcm-qxb6 | sheet `Effect.targetInstanceId?: string` (encounterAdversaries id) | characters.ts | E6.4 (`endOnDefeat` ends only that assassin's effect) |
| dcm-wiwi | sheet `creatureTokens?: { name, count }[]` (`sheetCreatureTokensSchema`, at most `MAX_SHEET_CREATURE_TOKEN_KINDS` = 10, count 0..99), type `SheetCreatureTokens` | characters.ts | E7.4 writer (creatureTokens steps on PCs) |

Deviation from the brief, (4e): the brief suggested "a GM answer member of the hit choices". Adding a member to
`hitChoiceValidator` breaks three files outside my owns that assign a stored `choice` to narrower types
(`convex/adversaryActions.ts:314-315`, `convex/lib/adversaryHits.ts:778`,
`src/components/combat-map/actions/reactions/prompt.tsx:118`), one of them (adversaryActions.ts) not E2.4's either. So
the GM's answer is stored on the payload (`keywordAsk.answer` / `answeredBy`, it is not a responder's choice) and its
mutation args use `keywordAnswerValidator`. Nothing else outside owns breaks.

Tests: `tests/unit/card-effects/types-widen-4.test.ts` (fixtures for each type member; the sheet fields parse, caps
hold, old effects parse), `tests/convex/lane4-v4-requests.test.ts` (each new payload / field stores and reads back
through the real schema, malformed members are refused, old rows still conform).

## Beads

All are vocabulary halves only; none is closable by V4 alone.

- dcm-dztv: type done; open for E2.4 (reader) and S3.4 (data).
- dcm-n7kt: type done; open for E2.4 (engine) and S4.4 (data).
- dcm-hqk1: types done; open for E1.4b and S2.4.
- dcm-1sk4: validator done; open for E1.4b (store and replay).
- dcm-mcgj: validator done; open for E1.4a.
- dcm-vx5n: request shape done; open for E1.4a.
- dcm-uxsd: request shape done; open for E7.4 (writer) and E1.4b (player half).
- dcm-sk4r: hit shape done; open for E2.4.
- dcm-lztq: zod field done (no version bump: optional); open for E1.4a / E8.4 writers, E6.4 readers + migration. Needs
  the Convex mirror line below at merge.
- dcm-qxb6: zod field done; open for E6.4. Needs the Convex mirror line below.
- dcm-wiwi: zod field done; open for E7.4. Needs the Convex mirror line below.

## Merge-time actions (outside owns; reported, not edited)

1. **Required before batch A writes anything:** `convex/lib/validators/characters.ts` mirrors the zod sheet for query
   `returns` (`sheetValidator`) and for stored hit riders (`hitRiderValidator` uses `effectValidator`). Without these
   lines a sheet holding the new fields fails every sheet query's returns check, and an effect rider carrying `casterId`
   is refused on insert. No test fails today (no writer yet). Add:

   ```ts
   // effectValidator, after `mods`:
     /** Plan lanes-2, V4 (dcm-lztq, dcm-qxb6): `effectSchema.casterId` / `targetInstanceId`. */
     casterId: v.optional(v.string()),
     targetInstanceId: v.optional(v.string()),
   ```

   ```ts
   // d5SheetFields (or sheetValidator), next to `cardTokens`:
     /** Named tokens on the PC (`sheetCreatureTokensSchema`, plan lanes-2 V4, dcm-wiwi). */
     creatureTokens: v.optional(v.array(v.object({ name: v.string(), count: v.number() }))),
   ```

2. No exhaustive switch or `Record` breaks: `pnpm typecheck` is clean with the two new request kinds (no file maps
   `CombatRequestKind` exhaustively). The kind union lives in my file; `convex/tables/combatRequests.ts` needs no edit
   (it spreads `combatRequestFields`). Its doc comment lists only the first kinds; optional to touch.
3. Authz: no public function added or changed. Codegen: none needed (no new module).

## Follow-ups

- None filed. The halves above are the beads themselves.

## QUESTIONS

- None. (The four wave-10 questions were answered 2026-11-01.)

## Checks

- `pnpm lint`: clean.
- `pnpm typecheck`: clean.
- Focused: types-widen-4, lane4-v4-requests, sheet-d5-fields, schema-guard: 40 passed.
- Full suite (`pnpm vitest run --maxWorkers=1 --testTimeout=120000`): 419 files, 9840 passed, 1 expected fail.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml V4 rebuild HEAD`: OK.
