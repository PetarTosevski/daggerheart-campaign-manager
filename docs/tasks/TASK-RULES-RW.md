# TASK-RULES-RW: Witherwild Wither tokens rule switch (W1)

Plan `.omc/plans/rule-switches.yaml`, tracer RW (epic dcm-jh6d part A). Rule W1 `witherTokens`, CB p.261: "Any time a
PC takes Severe damage from a Withered adversary or environment, gain a Wither token ... roll their Fear Die". Modes
Book · Manual (registry, RS0). Witherwild only.

| Mode | `characters.applyDamage` with `withered: true` and Severe damage (after the Armor Slot) |
|---|---|
| Book (default) | One Wither token and a public Fear Die roll (`gainWitherToken`, convex/wither.ts), as before |
| Manual | No token, no roll. One GM-only note: "Mira took Severe damage from a Withered source: add a Wither token and roll?" |

- The decision is the pure `witherOnDamage(severity, withered, mode = "book")` (`src/lib/domain/wither/index.ts`):
  `"gain" | "note" | "none"`.
- The note is written with `postRuleNote` (convex/lib/ruleModes.ts). Plain damage writes no `actionLog` row and has no
  action group, so the note carries no `characterId` and no `groupId` and is never undoable (a character note needs
  its action's group).
- The GM's own Wither panel (`wither.gain`, `wither.adjust`) works in both modes.
- Outside Witherwild `withered` is still MECHANIC_DISABLED (the frame's `witherTokens` mechanic).

Tests: `tests/convex/rules-wither.test.ts` (pure helper, Book, Manual note and feed visibility, no note for non-Severe
or non-Withered damage, `wither.gain` in Manual). Existing: `tests/convex/wither.test.ts`, `tests/unit/wither.test.ts`.
