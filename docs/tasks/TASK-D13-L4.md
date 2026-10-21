# TASK-D13-L4: Campaign context with permission checks, table rulings, Ask the GM, house rules

Plan `.omc/plans/d13-lorekeeper.yaml`, tracer L4 (wave 2). Bead dcm-bxp.82. Analysis: `.omc/autopilot/d13-analysis.md`
5.4 and 9. User answers Q4, Q7, Q8 and Q14 are binding.

Status: Review (implemented and tested in the worktree; the orchestrator merges).

## What landed

| File | Role |
|---|---|
| `convex/lib/lorekeeper/context.ts` | `buildContext(ctx, user, campaign)` (L0 signature): frame, the asker's own characters, the party's class lines, the newest 50 rulings, and house-rule pages when the GM switched the house-rules book on. |
| `convex/lorekeeperRulings.ts` | `list`, `pin`, `update`, `unpin`. |
| `convex/lorekeeperAsks.ts` | `send`, `mine`, `listOpen`, `resolve`. |
| `tests/convex/lorekeeper-context.test.ts` | Canary tests and the structural import / table-read checks (7). |
| `tests/convex/lorekeeper-rulings.test.ts` | Rulings and asks behaviour and codes (9). |
| `tests/convex/authz/lorekeeper-rulings.{entries,test}.ts` | Matrix entries for all 8 public functions. |

## buildContext (Q4, Q7)

- **Frame:** `contextFrame(campaign)` (id and published name).
- **Characters:** one bounded read (`partyOf`, at most 50). A character is the asker's when they own it **and**
  `permissionFor(character) >= edit`. The GM edits every sheet but gets only the characters they own: no player
  sheet reaches the GM's prompt (Q4: "the asker's own character sheet"). Fields: name, class, subclass, level,
  heritage (ancestry / mixed / shapeshifter form, transformation, community), domain-card names (loadout + owned) and
  feature names (hope feature, class features, subclass features up to `subclassRank`, heritage features, multiclass).
  Never notes, description, background, connections, inventory or any other sheet field. Dead and retired characters
  are left out; a corrupt sheet is skipped.
- **Party:** class and subclass names of every character in play (the Party page shows them to every member). No names.
- **Rulings:** `by_campaign_pinned`, newest first, `.take(50)`, with the ruling id (`ContextRuling.id`, optional,
  added so L3 can map ruling quotes; the type only widened).
- **House rules (Q7):** only when the `houseRules` book exists **and** the campaign's `lorekeeperLibrary` row for it
  has `enabled: true` (no row = off). Then only the GM's journal (`journals.by_campaign_user` with the GM's id), its
  pages that are not torn out with visibility `everyone`, each read through `pageAccess` as the asker (a refusal skips
  the page). At most 10 pages, 4,000 characters each, 12,000 in all. Mention tokens become "(a codex entry)": a GM can
  mention a hidden Codex entry, whose name must never reach a prompt.

`context.ts` imports only `characterSheet`, `notes` (`pageAccess`), `permissions`, the SRD, frames, the notes mention
regex, character types and `validators/lorekeeper`. The test reads its imports (no codex, encounter, adversary,
countdown, session, fear, journalState or notesJournals module) and its table reads (exactly `journals`,
`journalPages`, `journalEntries`, `lorekeeperBooks`, `lorekeeperLibrary`, `lorekeeperRulings`).

### Canary coverage

Seeded with unique `CANARY_*` markers: a hidden codex entry (name, description), a known entry's GM notes, the GM's
private page (title, entry), a GM page chosen for player A, a torn-out GM `everyone` page, player A's `private`, `gm`
and `everyone` pages, a hidden entry mentioned on the shared house-rule page, a custom adversary, an encounter (name,
notes), a private countdown (name, description, consequence), session prep hooks, Fear, player B's sheet (name,
notes) and player A's own notes and description. With house rules **on**, `JSON.stringify(buildContext(...))` for
player A, player B, the GM and an edit grantee contains none of them (player B's own sheet name excepted for player
B). Positive checks: player A's own sheet ("Ash") is present, the party has two class lines, the ruling and the GM's
shared page are present, the GM's context has no character at all, house rules stay out when the book is missing or
switched off, a GM-owned character is the GM's, dead characters leave the party.

## Rulings (Q14)

- `list` (campaignQuery view): newest 50 with `meta` "Pinned by the GM" or "Pinned by the GM · Session N" (derived
  from `sessions.n` on read), `sessionN`, `fromMessageId`, times. Returns validator.
- `pin` (gmMutation): title trimmed 1-80, text 1-600 (`INVALID`); `LOREKEEPER_RULING_LIMIT` at 50;
  `fromMessageId` must be an answer of this campaign that is the GM's own **or one sent to the GM with Ask the GM**
  (else `LOREKEEPER_NOT_FOUND`); `sessionId` of another campaign is `NOT_FOUND`.
- `update` (gmMutation): `title?`, `text?` (single-field intents), same limits. `unpin` (gmMutation) deletes.
  Another campaign's ruling: `LOREKEEPER_RULING_NOT_FOUND`.

## Ask the GM (Q8)

- `send` (campaignMutation view): the caller's own `done` answer in this campaign (else `LOREKEEPER_NOT_FOUND`; still
  streaming → `INVALID`); one open ask per answer (`LOREKEEPER_ASK_EXISTS`); after a resolution it can be sent again.
- `mine` (campaignQuery view): the caller's own open asks (message ids) so the UI can show "Sent to the GM".
- `listOpen` (gmQuery): up to 50 open asks, oldest first: account name, the asker's active character name, the
  question (the message just before the answer), verdict and suggested call. Asks whose answer is gone are skipped.
- `resolve` (gmMutation): `rulingId?` → `pinned` with that ruling (another campaign's → `LOREKEEPER_RULING_NOT_FOUND`),
  none → `dismissed`; a resolved or foreign ask → `LOREKEEPER_ASK_NOT_FOUND`.

## Role table (matrix)

| Function | anon | outsider | player | otherPlayer | grantee | GM |
|---|---|---|---|---|---|---|
| lorekeeperRulings.list | UNAUTHENTICATED | NOT_FOUND | ok | ok | ok | ok |
| lorekeeperRulings.pin / update / unpin | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |
| lorekeeperAsks.send | UNAUTHENTICATED | NOT_FOUND | ok (own answer) | LOREKEEPER_NOT_FOUND | LOREKEEPER_NOT_FOUND | LOREKEEPER_NOT_FOUND |
| lorekeeperAsks.mine | UNAUTHENTICATED | NOT_FOUND | ok (own) | empty | ok | empty |
| lorekeeperAsks.listOpen / resolve | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |

## Notes for other tracers

- **L2:** the house-rules switch needs a `lorekeeperBooks` row with key `houseRules` (no chunks). Until one exists,
  house rules are off everywhere.
- **L3:** `conversations.remove` should also delete the asks of the deleted answers (`lorekeeperAsks.by_message`);
  `listOpen` already skips asks whose answer is gone.
