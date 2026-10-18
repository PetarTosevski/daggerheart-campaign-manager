# TASK-RF4: Motherboard rules from the book (Corruption track, downtime swaps, tether and quantum)

- **Plan:** `.omc/plans/rules-fixes.yaml`, tracer RF4 (settles decisions 20, 23, 24)
- **Branch:** tracer worktree off `rebuild`

## Rules

- CB 295, Optional Rule: Corruption Track: "If a Beastbound ranger has a remnant companion, they can use the following rules … At the beginning of downtime, the ranger rolls their Fear Die. If it lands on a 1, they must mark a Corruption … Specialized technomancers may be able to temporarily repair the remnant (which clears 1d4 Corruption) … If the companion's last Corruption is ever marked, the remnant becomes violent and can no longer be commanded or repaired. The ranger must take a new companion with two new Experiences. They carry over the same number of level-up options they've already chosen to this new companion." The track has six boxes.
- CB 301: "PCs may freely swap augments they've already crafted during downtime."
- CB 301: "Each PC adds a Network tether to their inventory at character creation."
- CB 302: "In this campaign frame, gold is not used as a currency. Instead, PCs can gather scrap to trade for a currency known as quantum. … All PCs start with 5 quantum." (10 quantum = 1 handful of gold.)

## Change

### Corruption Track

- The data stays in the campaign's `motherboard.corruption` frame tracker. `corruptionStateSchema` gains `remnant: string[]`, with a default, so older rows read as having no remnants. There is no schema or table change.
- Domain (`src/lib/domain/rest/frame-hooks/index.ts`): `CORRUPTION_TRACK_SIZE = 6`, `corruptionOf` (counts above 6, which pre-RF4 data allowed, read as a full track), `isRemnant`, `companionLost` (6 marks), `rollsCorruption`, `setRemnant`, `repairCorruption` (1d4, never below 0) and `replaceLostCompanion`. `rollCorruption` stops at six and reports `lost`. Refusals throw `RuleError("EXTRA_RULE")`.
- Rest hook (`convex/lib/restHooks.ts`): only a Beastbound ranger whose companion is marked a remnant, and isn't lost, rolls the Fear Die. The feed shows "Corruption N of 6", or a line saying the companion turned violent.
- `convex/characterExtras.ts`. Each function returns `MECHANIC_DISABLED` outside Motherboard, for a non-Beastbound character, or with `remnantCorruption` off.
  - `corruption` (query, view): the track, the last roll, `canEdit` and `canRepair`. It returns null where the rule doesn't apply.
  - `setCompanionRemnant` (owner or GM). Refused for a lost companion.
  - `repairCompanion` (GM only, `owner` on the character): rolls 1d4 on the server and returns `{ die, cleared, marks }`. Refused for a companion that isn't a remnant, is lost, or has nothing marked.
  - `replaceCompanion` (owner or GM, lost companions only): clears the track and the remnant mark, and resets the companion sheet to blank. It keeps `training`, `vicious` and `bonusTraining` ("carry over the same number of level-up options").
- UI: a Corruption Track box at the end of the Ranger Companion sheet (`src/components/party/extras/corruption-box.tsx`). It holds the remnant checkbox, six diamonds, the last roll, the GM's "Repair (clear 1d4)" and, when the companion is lost, the book's warning and "Take a new companion".

### Downtime swaps

- `installAugments` refuses with `EXTRA_RULE` (message quoting CB 301) unless the campaign has an open rest (`rests` `by_campaign_status_started`, status `open`). Crafting and salvage are unchanged.
- `augmentSwapOpen` (query) tells the Augments card whether a rest is open. Outside one, Install/Uninstall are disabled and the card says to swap during the rest.

### Tether and quantum

- `sheetFromDraft` with an Ikonis (Motherboard) adds "Network tether" to the starting inventory and starts with no gold. The 5 quantum were already in `INITIAL_MOTHERBOARD`.
- The Wealth box in Motherboard shows a Quantum stepper (it sets the count through `correctWallet`) instead of handfuls, bags and chest. The starting-inventory line names the tether. Other frames are unchanged.
- `migrations/motherboardEconomy:addTetherAndQuantum` runs batched over `characters` and is idempotent. For Motherboard characters only, it adds the tether unless one is already carried (any case). It seeds an Ikonis module row with 5 quantum when the character has neither a row nor a legacy `frameTrackers` row. Existing gold and quantum are left alone.
  - `npx convex run migrations/run:run '{fn: "migrations/motherboardEconomy:addTetherAndQuantum", dryRun: true}'`

### Other

- The `horizonDaysPassed` comment no longer mentions a GM-forced fourth short rest (RF2 removed it). `gmOverride` is optional and is still honoured for old rows.

## Tests

- Unit `tests/unit/motherboard.test.ts`: six boxes, only remnants roll, the sixth mark loses the companion, pre-RF4 rows read correctly, repair clears 1d4 and never goes below 0, a lost companion can't be repaired or unmarked, the companion replacement, and tether detection.
- Convex `tests/convex/motherboard.test.ts`:
  - Creation gives the tether, no gold and 5 quantum; other frames keep their gold.
  - The migration runs once and is idempotent on reset. It leaves other frames alone and keeps existing quantum.
  - The swap gate refuses without a rest and allows with one; crafting and salvage stay open.
  - Authorization for each new function: anonymous gets UNAUTHENTICATED, outsiders get NOT_FOUND, another player gets FORBIDDEN, and only the GM can repair.
  - Lost-companion rules.
- `tests/convex/rest-frame-hooks.test.ts`: only remnants roll; the sixth mark stops the rolls.
- `tests/convex/character-extras.test.ts`, `tests/convex/motherboard-ikonis.test.ts` and `tests/e2e/character-sheet.spec.ts`: open a rest before installing augments.
- e2e `tests/e2e/motherboard-ikonis.spec.ts`:
  - Uninstall is disabled until the GM starts a rest.
  - Wealth shows Quantum 5 and the stepper raises it.
  - The inventory has the Network tether.
  - On the companion sheet, a ranger's remnant shows "Corruption: 0 of 6", with Repair disabled at 0.

## Questions (reversible defaults taken)

- Repair is GM-only: the book's "specialized technomancers" are NPCs.
- Existing Motherboard characters keep any stored gold, hidden. It is not converted to quantum at 10 per handful.
- Marks can't be set by hand: only the downtime roll marks a box. A GM correction control would be a small follow-up.
