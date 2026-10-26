# TASK-D5-T5: Wither tokens and temporary Start/End session buttons

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T5 (wave 2). Builds on the T0 contracts (`TASK-D5-T0.md`).

## What works

- **Withered damage.** `characters.applyDamage` takes optional `withered`. When the damage, after any Armor Slot, is Severe, the character gains one Wither token and the server rolls the Fear Die (d12). The roll is public: an `actionLog` row of kind `wither` that carries the roll. A roll at or below the tokens adds a scar (Hope is cut to the slots left) and clears the tokens. Scarring the last Hope slot sets `journeyEnds`. The result's `wither` field reports `{ tokens, fearDie, scarred, journeyEnds, entryId }`. Passing `withered` outside Witherwild is `MECHANIC_DISABLED`. Damage without `withered`, or below Severe, works exactly as before. The Wither row's `before` is the sheet after the damage, so undoing it takes back only the Wither change.
- **GM controls.** `wither.gain` is the "+ Wither" button: one token plus the Fear Die, the same as Withered damage. `wither.adjust` changes the tokens by a whole-number delta, kept within 0..99, with no roll. Both are `keyedGmMutation`s gated by `assertMechanicEnabled(witherTokens)`, and both write undoable `actionLog` rows. There is no per-PC cap. The book's pool of 20 tokens is shown for reference only.
- **Sessions.** `sessions.start` stamps `campaignState.sessionStartedAt` and runs `onSessionStart(sheet, rollDie)` for every active PC; pressing Start again does nothing. `sessions.end` handles every PC with a readable sheet: it runs `expire(sheet, "session")`, then `onSessionEnd`, then sets `wither = 0`. The tokens go to GM Fear through `gainFear`, which caps Fear at 12, and the end reports `fearGained` and `fearLost` ("N Fear lost"). It lists characters whose journey ends (not dead or retired) and writes one undoable group: one row per changed PC plus a campaign row that carries `fearDelta`. When no session is started and nothing would change, End writes nothing, so a second End is a no-op. `sessions.current` (`campaignQuery`, need `view`) returns `{ startedAt }`.
- **UI.** The sheet's damage calculator has a "Withered source" checkbox in Witherwild and shows the Fear Die result after Apply. The sheet's page one shows a Wither counter (Witherwild only): the token count for everyone, plus "+ Wither" and "−" for the GM. The party card shows a "Wither N" badge while tokens remain. The GM dashboard has a Session panel with Start and End buttons, each behind a confirm dialog. After End it reports "N Wither tokens → +X Fear, Y Fear lost" and names any character whose journey ends.

## Book references (re-checked)

- CB 261, "Corruption from the Witherwild": "Any time a PC takes Severe damage from a Withered adversary or environment, gain a Wither token and place it on that PC's character sheet. When you do, the PC must roll their Fear Die. If they roll equal to or below the number of Wither tokens on their sheet, they immediately gain a scar and clear all tokens, describing how the Witherwild changes them permanently." "At the end of each session, clear all Wither tokens from the PCs' sheets and gain an equal amount of Fear." "You also need about 20 Wither tokens" (reference only, decision).
- CB 106, "Scars": "cross out one of your Hope slots"; "If you ever cross out your last Hope slot, it's time to end your character's journey."

## Interpretations

- "Takes Severe damage" means the severity after an Armor Slot is marked. `hitPointsToMark` returns that severity, and an Armor Slot reduces the damage taken.
- The Fear Die is compared with the token count after the new token is added ("the number of Wither tokens on their sheet").
- Undoing a session start or end restores the sheets and the Fear but leaves `sessionStartedAt` as it is.

## Files

`convex/wither.ts`, `convex/sessions.ts`, `convex/characters.ts` (`applyDamage`), `src/lib/domain/wither/index.ts`, `src/components/party/wither/index.tsx`, `src/components/party/session/{index,boundary}.tsx`, `src/app/(gm)/campaigns/[campaignId]/party/[characterId]/damage-calculator.tsx`; tests `tests/unit/wither.test.ts`, `tests/convex/wither.test.ts`, `tests/convex/sessions.test.ts`, `tests/e2e/wither.spec.ts`.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`, local push with `--typecheck=enable`; e2e `wither.spec.ts`, `character-sheet.spec.ts`, `dashboard.spec.ts`, `party-roster.spec.ts`, `players.spec.ts`.
