# Config: tracer briefs (2026-11-03)

Plan: `.omc/plans/config.yaml` (8 waves, 47 tracers; `node scripts/plan-check.mjs .omc/plans/config.yaml` OK, no file
owned twice in a wave). Designs: `reference/designs/config/Settings.dc.html` (campaign settings = gear, Preferences =
avatar) and `reference/designs/config/Admin.dc.html` (App admin). Epic: bead dcm-jh6d (children dcm-jh6d.1 co-GM,
dcm-cd8 creation cap, dcm-bxp.134 rule switches; dcm-bxp.134 is **not** in this plan).

**Status:** every tracer follows the recommended default of the open questions at the end of this file. A tracer with
`blocked_on: Qn` changes a rule or needs an answer: check the user's answer first and rewrite its acceptance if it
differs. R4 (clock per scene) does not start before Q4 is answered. AD0 does not start before Q16 is answered (owner
identity is security-critical).

## User decisions (binding, from the epic notes and the planner brief)

- **Campaign settings** (GM, per campaign): At the table / House rules / Players / Lorekeeper / Sessions, as the
  Settings board draws them. "Changes save as you make them and reach every player at once."
- **No rule switches here.** The Book / Variant / Manual registry and homebrew are a later plan. The existing optional
  rules of `src/lib/frames/options.ts` stay exactly as they are and show in House rules.
- **Co-GM:** the GM can make another member a secondary GM of their own campaign. A co-GM can't delete the campaign or
  remove the owner. Everything through `permissionFor` (rule 2), with an authz matrix role.
- **Preferences** live on the **account** and follow the user to every device ("Only on this device" label changes):
  3D dice, dice sound + volume, reduce motion, text size, ping on spotlight. Migrate today's localStorage values once.
- **Admin** is a superadmin page, app owner only, checked server-side on every function; the owner is identified in one
  place. Token usage, Lorekeeper spend and key status are sensitive.
- **No GM approval flow:** anyone can GM their own campaigns. Drop "Who can create a campaign", "Make GM" and "Waiting
  for you".
- **Feature switches:** no combat HUD row (it cuts over in HUD wave 9).
- **Build order:** HUD wave 9 → Journal → Part A → Part B → rule switches / homebrew later.
- **Never guess a mechanic:** settings that change rules are open questions with book quotes (below).

## Batches and launch order

| Wave | Part | Tracers | Start |
|---|---|---|---|
| 1 | A | S0, S1 | at once, after the Journal plan is merged |
| 2 | A | G1, S2, P1, PR1 | when S0 is merged (G1 is L: start it first) |
| 3 | A | batch A server: G2, R1, R2, R3, L1 (R4 only after Q4) | after G1 / S0 as listed |
| 3 | A | batch B UI: U1, U2, U3, U4, U5, U6a, U6b, U6c, U6d | when S1 and each one's server tracer are merged |
| 4 | A | S3, JO1, JO2, JO3, then SX last | JO* need the Journal plan; SX after every Part A tracer |
| 5 | B | AD0, AD1 | after Part A, and after Q16 |
| 6 | B | AD2, AD3, AD4, AD5a, AD5b, AD6, AD8, AD9, AD10, AD11 | when AD0 is merged (at most 5 at once; AD10 first: it closes the read-only gap) |
| 7 | B | AD7, AU1-AU6, AF1 | when their server tracers are merged |
| 8 | B | AX | everything else merged, full e2e green |

At most 5 tracers run at once. Only the orchestrator merges, in dependency order, one squashed commit each; codegen after
every merge that adds or changes a Convex file. Part A never edits `convex/schema.ts`: S0 adds its tables to `campaignTables`
(already composed). Part B's AD0 adds `convex/tables/admin.ts` and is the only tracer that edits
`convex/schema.ts`.

**Shared files, owned once per wave:** `convex/lib/functions.ts` (G1 wave 2, AD0 wave 5, AD10 wave 6),
`convex/campaigns.ts` (S0 1, G1 2, R1 3, S3 4, AD5a 6), `convex/members.ts` (G1 2, AD5b 6),
`tests/convex/authz/harness.ts` + `world.ts` + `authz-matrix.test.ts` (G1 2, AD0 5), `src/lib/errors/app-error.ts`
(S0 1, AD0 5), `convex/crons.ts` (AD0 5), `convex/lib/lorekeeper/caps.ts` (AD6 6, AD7 7), `convex/lorekeeperRun.ts`
(AD6 6, AF1 7), `src/components/party/dice/settings.ts` (U6a 3, AF1 7).

**Concurrency with other plans:** while Part A runs, keep other lanes off `convex/lib/functions.ts`,
`convex/lib/permissions.ts`, `convex/campaigns.ts`, `convex/members.ts` and the authz harness. The Journal plan must be
fully merged (JX2 included) before wave 1, because R3, JO1-JO3 edit files it creates (`convex/sessions.ts`,
`convex/journalLog.ts`, `convex/journalTally.ts`, `src/components/journal/header/**`, `src/components/journal/tally/**`).

## Design element → code / data

Legend: **reuse** = exists, wire it; **widen** = optional field on an existing table; **new** = new table / function / UI.

### Campaign settings (gear, GM and co-GM)

| Design element | Today | Data | Tracer |
|---|---|---|---|
| Gear button, slide-over, five-section nav, footer line | Players button + `players-dialog.tsx` in `campaign-shell.tsx` | - | S1, SX |
| At the table · Players can see each other's hands | `campaigns.playersSeeHands`, `campaigns.setPlayersSeeHands`, `combat-map/settings/hand-sharing.tsx` | reuse | U1 |
| · Players see the GM's Fear | Fear is always sent (`campaigns.fear`, feed `fearDelta`) | widen `tableSettings.playersSeeFear` | S0, R1, U1 |
| · Out-of-range actions Ask me / Refuse | Ask me = today's pending combat request (`combatActions`, `combatFeatures`, `featurePrompts`) | widen `tableSettings.outOfRange` | S0, R2, U1 |
| · Show spotlight balance to players | Journal JT bars (GM only, Journal Q5) | widen `tableSettings.spotlightToPlayers` | S0, JO3 (needs Journal), U1 |
| · Adversary HP, Stress, Difficulty "Always off" | Locked row, no setting; U1 adds a test that players never get them | - | U1 |
| House rules · rulings ("Pinned from the Lorekeeper · Session N", "Add a house rule") | `lorekeeperRulings` (list / pin / update / unpin; Lorekeeper context already quotes them) | reuse | U2 |
| House rules · Massive damage, Action tracker rows | Rule switches: **later plan** (dcm-bxp.134). This plan shows today's `CAMPAIGN_OPTIONS` for the frame via `campaigns.setOption` | reuse | U2 |
| Players · roster with "plays X · Class", Owner badge | `members.roster`, party | reuse; G1 adds `coGm` | U3 |
| Players · Online / Away | none | **new** `campaignPresence` + `presence.beat` / `presence.list` | S0, PR1, U3 |
| Players · invite link + Copy | `campaigns.joinCode`, `members.access`, `rotateJoinCode`, email `invite` | reuse | U3 |
| Players · co-GM (row menu) | none | widen `campaignMembers.role = 'coGm'`; **new** `members.setCoGm`, creator rank | S0, G1, G2, U3 |
| Lorekeeper · Sources it may search | `lorekeeperLibrary.list` / `setEnabled` | reuse | U4 |
| · "Your Witherwild notes · Uploaded by you" | The House rules (notes) book switch (GM pages shared with everyone) | reuse (Q24) | U4 |
| · Table rulings (locked on), GM-only notes (locked off) | Lorekeeper context already reads rulings, never GM-only pages | reuse | U4 |
| · Search the internet when the books don't say | per-conversation `webSearch` toggle | widen `tableSettings.lorekeeperWeb` (campaign gate) | S0, L1, U4 |
| · Who can ask Everyone / GM only | everyone (`lorekeeper.ask` need view) | widen `tableSettings.lorekeeperAsk` | S0, L1, U4 |
| Sessions · GM Fear at session start | carries over (`sessions.start` doesn't touch Fear) | widen `tableSettings.fearAtStart` | S0, R3, U5 |
| · Day and night clock per scene / manual | manual (`campaignTime.advance`, `endDay`, `setTimeOfDay`) | widen `tableSettings.clock` | S0, R4 (Q4), U5 |
| · A new session opens on Journal / Combat Map | Journal JH Start / HUD `pick/session.tsx` | widen `tableSettings.sessionOpensOn` | S0, JO1 (needs Journal), U5 |
| · Write the session log from the Combat Map | Journal JD2 (`convex/journalLog.ts`) assembles feed lines | widen `tableSettings.autoSessionLog` | S0, JO2 (needs Journal), U5 |
| · Archive this campaign | none (only delete: `deletedAt`, restore, purge) | widen `campaigns.archivedAt`; **new** archive / unarchive, wrapper write guard | S0, G1, S3 |

### Preferences (avatar, everyone)

| Design element | Today | Data | Tracer |
|---|---|---|---|
| Avatar popover, "Only on this device, only for you" → "Saved to your account · follows you to every device" | none | - | S1 |
| 3D dice | `localStorage dcm.dice.settings.threeD` (`party/dice/settings.ts`) | **new** `userPreferences.dice3d` | S0, P1, U6a |
| Dice sound + Volume | `dcm.dice.settings.sound`; no volume | `userPreferences.diceSound`, `diceVolume` | U6a |
| Reduce motion | OS `prefers-reduced-motion` only (many `matchMedia` reads) | `userPreferences.reduceMotion` | U6b |
| Text size Small / Medium / Large | none (px everywhere) | `userPreferences.textSize` | U6b (Q12) |
| Ping me when I get the spotlight | none | `userPreferences.spotlightPing` | U6d (Q14) |
| Hide cards (no board row; the hand's fold) | `localStorage dh.combat.handHidden:<campaign>:<character>` | **new** `handFolds` | S0, P1, U6c |
| HUD key `dcm:combat-hud` | deleted by HUD wave 9 (H8.1) | none: U6a removes the stale key | U6a |
| Kept local (Q15): Names switch, range circles, catalogue sort, wizard / custom-frame drafts | localStorage | unchanged | - |
| App admin link "only you" | none | `appAdmin.me` | AU6 |
| Campaign settings link, Sign out | sign-out exists | reuse | S1 |

`settings` (per-user `tableName`, `gmName`, `accent`, `expansions`, `defaultMapStyle`, the main menu's Settings dialog
and backup) stays as it is; preferences get their own row (`userPreferences`) because the volume and switches change
often and `settings` is read by the title menu (CD10).

### App admin (owner only)

| Design element | Today | Data | Tracer |
|---|---|---|---|
| Owner-only page, "GMs and players never see this page" | none; docs/lorekeeper.md: "there is no admin role" | **new** owner identity (Q16), appOwner wrappers | AD0, AD1 |
| Overview · Accounts N (owner / GM / players) | users (authTables) | bounded count, role derived (GM = owns a live campaign) | AD2, AU1 |
| · Campaigns N of M allowed | campaigns | appConfig caps | AD2 |
| · Lorekeeper questions / spend this month | **reuse** `lorekeeperUsage` deployment row (questions, costMicros: the existing per-question meter in `convex/lib/lorekeeper/caps.ts`) | reuse | AD2 |
| · Alerts ("Mira is at 27 of 30 questions today") | user-day usage rows | reuse | AD2 |
| · Campaigns card (GM, players, live / last played, Open) | campaigns, campaignState, sessions | reuse; Open only where the owner is a member (Q27) | AD2 |
| · Recent changes (audit) | none | **new** `adminAudit` + 365-day cleanup cron | AD0, AD2 |
| Accounts · New accounts: Invite link only / Open / Closed | open sign-up (open-signup plan; its "no invite-only switch" answer is superseded by this board) | **new** `appConfig.signUpMode`; enforced in `createOrUpdateUser` | AD3, AD4 (Q18) |
| · Who can create a campaign / Waiting for you / Make GM | - | **dropped** (user decision) | - |
| · Campaigns per GM, in the whole app | rate limit `createCampaign` only | appConfig caps; enforced in `campaigns.create` | AD3, AD5a |
| · Characters per player in a campaign | `MAX_CHARACTERS_CREATED_PER_CAMPAIGN` = 50 per campaign (dcm-cd8) | appConfig cap; per-campaign bound stays | AD3, AD5b (Q19) |
| · Players per campaign | none | appConfig cap; enforced in join / invite | AD3, AD5b |
| · Account table (role, campaigns, last seen, ···) | none | paginated users + `campaignOpens` | AD3, AU2 |
| Lorekeeper · Spend this month, monthly limit | env `LOREKEEPER_MONTHLY_USD` (default 150) | appConfig over env | AD6 |
| · Questions this month "412 of 1500" | deployment row questions; no monthly question cap | count only (Q22) | AD2 |
| · When the limit is reached: Pause / GMs only / Shorter answers | pause only (`LOREKEEPER_CAP_DEPLOYMENT`) | appConfig `atLimit` | AD6 (Q20) |
| · Email me at 80% | none; Resend exists (`lib/authEmail.ts`, `lib/inviteEmail.ts`) | `spendAlertMonth` | AD7 |
| · Questions per day per person | env `LOREKEEPER_DAILY_QUESTIONS` (40) | appConfig over env | AD6 |
| · Internet searches per day | none (per-answer `webSearches` max_uses only) | widen `lorekeeperUsage.webSearches` | AD6 |
| · Let GMs raise limits for their table | none | Q21 | AD6, AU3 |
| · Use by campaign | campaign-month usage rows | reuse | AD6 |
| · Book library Upload / Replace | `lorekeeperBooks` / chunks via CLI `pnpm lorekeeper:ingest` and internal mutations | reuse internals; **new** owner upload path | AD8 (Q23) |
| Feature switches Off / Only me / Testers / Everyone + Testers | none | **new** `featureSwitches`, `appTesters` | AD9, AU4, AF1 (Q25) |
| · New combat HUD | - | **dropped** (cuts over in wave 9) | - |
| Maintenance · Read-only for everyone + banner | none | **new** `appStatus`; wrapper guard | AD10, AU5 (Q31) |
| · Backups: last backup, Download | Convex dashboard backups / `npx convex export`; no function API | link + honest text (Q29) | AD10 |
| · Export everything as JSON | none | **new** `adminExports`, authenticated download | AD11 (Q30) |
| · Keys and connections | env (`convex/convex.config.ts`) | booleans only | AD10 |

## New data vs reused

- **New tables:** `userPreferences`, `handFolds`, `campaignPresence` (Part A, in `convex/tables/campaigns.ts`);
  `appConfig`, `appStatus`, `featureSwitches`, `appTesters`, `adminAudit`, `adminExports` (Part B, new
  `convex/tables/admin.ts`).
- **Widened:** `campaigns.tableSettings` (typed object of optional fields), `campaigns.archivedAt`,
  `campaignMembers.role` (`'coGm'`), `lorekeeperUsage.webSearches`; the index `campaigns.by_deletedAt` becomes
  `by_deletedAt_archivedAt` (AD5a).
- **Reused as is:** `playersSeeHands`, `options` / `CAMPAIGN_OPTIONS`, `joinCode` + members functions,
  `lorekeeperRulings`, `lorekeeperLibrary`, `lorekeeperUsage` and the whole reserve / settle meter, `campaignOpens` (last
  seen), the internal book ingest, Resend.
- **Growing data and cleanup:** `handFolds` and `campaignPresence` are bounded per campaign (members × characters) and
  purged with the campaign and with the member (G1); `adminAudit` only grows → `adminRetention.expireAudit` cron (365
  days, batched, self-rescheduling); `adminExports` → hourly expiry with its storage file; `userPreferences` is one row
  per user (no growth). `featureSwitches`, `appTesters`, `appConfig`, `appStatus` are tiny.

## Owner (superadmin) identification

- **One stored value, one helper.** `appConfig.ownerId` (a `users` id) is set only by the internal mutation
  `adminSetup.setOwner { email }`, run with `npx convex run adminSetup:setOwner '{"email":"..."}'`. Internal functions
  are callable only with the deployment's admin key, so whoever controls the deployment names the owner. It resolves
  the user by a **verified** email (`emailVerificationTime` set; rule 3) and stores the id, so later email changes or an
  unverified look-alike account never become owner.
- `convex/lib/appOwner.ts` `isAppOwner(ctx, user)` is the **only** owner check. `appOwnerQuery` / `appOwnerMutation` /
  `appOwnerAction` in `convex/lib/functions.ts` call it before every admin handler (FORBIDDEN otherwise,
  UNAUTHENTICATED signed out). Other uses (owner skips the Lorekeeper caps, owner bypasses read-only) call the same
  helper. The client only reads `appAdmin.me` (`{ isOwner }` for the caller) to show the link and the page; that is UX
  (CF22).
- The owner is **not** a GM of other people's campaigns: no admin path opens or reads another campaign's content (Q27).
- Alternatives are in Q16.

## Co-GM model (G1)

- `Role` gains `'coGm'` (a `campaignMembers` row with `role: 'coGm'`). `rolePermission('coGm') = 'owner'`, so a co-GM
  passes every existing `gm*` wrapper and `need: "owner"` check unchanged, and `campaigns.get` reports `role: 'gm'` +
  `isCreator: false`, so every GM screen works without client changes.
- A new campaign-only rank **`creator`** above `owner` (never stored in `grants`) is given only to `campaign.ownerId`.
  Creator-only: `campaigns.remove`, `restore`, `purge`, `campaignSettings.archive` / `unarchive`, `members.setCoGm`, and
  removing a co-GM. The creator has no member row, so nobody can "remove the owner".
- G2 then replaces every role-style `campaign.ownerId === user._id` comparison outside `lib/permissions.ts` (14 files
  today) with the permission-derived role, and keeps identity uses (whose journal is the GM journal, `createdBy`).

## Common rules (every tracer)

- Read `docs/best-practices.md` sections 1-4 first. Wrappers only (rule 1); access only via `need:` / `permissionFor`
  or `isAppOwner` (rules 2, 3); `args` + `returns` validators, no `v.any` (rule 4); `.withIndex` + bounded reads, no
  `.filter` (rule 5); new fields optional, never edit a validator in place (rule 7); growing tables cleaned (rule 8);
  `ConvexError<AppError>` codes from `src/lib/errors/config.ts` / `admin.ts` (rule 9); uploads per rule 10 (AD8's
  text/plain exception only on the owner path); every `useQuery` subtree in an error boundary (rule 11); single-field
  intents with optimistic updates (rule 12); no state copied in effects (rule 13).
- Settings mutations take `{ change: { key, value } }` unions, one per field. The client never sends the whole settings
  object.
- `campaigns.get` is the live source of the table settings for every member: a change reaches every player at once
  without a new subscription.
- Each server tracer owns its authz area file `tests/convex/authz/config-<area>.entries.ts` or `admin-<area>.entries.ts`
  (+ `.test.ts`); the inventory guard fails `pnpm test` for any public function without an entry. Tests assert
  `ConvexError.data.code`, never text.
- Every tracer writes `docs/tasks/TASK-CONFIG-<id>.md` (what changed, decisions, Qn used) and runs `pnpm lint`,
  `pnpm typecheck`, `pnpm test` and its own e2e spec; `pnpm tracer:guard config <id>` before handoff.
- UI text comes from the boards, except the changed Preferences label and the dropped Admin rows.

## Per-tracer briefs

### Part A, wave 1

**S0 · Data foundation.** Only data, helpers, codes and the summary. Put new tables in `campaignTables`; no
`schema.ts` edit. `tableSettings` is a typed `v.object` of optional fields (not a blob, so no `schemaVersion`). The
defaults table in `src/lib/config/campaign-settings.ts` is the single source for the server and the UI. Legacy-pref
parsing is pure and unit-tested (blocked storage, bad JSON, foreign keys).

**S1 · Panel shell.** Copy the Journal shell's slot pattern. Gear for `role === 'gm'` (co-GMs included), avatar for
everyone. Keep the Players button until SX. Mount `presence-beat.tsx` and `spotlight-ping.tsx` once in the shell as
empty components so U3 / U6d only fill files they own.

### Part A, wave 2

**G1 · Co-GM core.** The largest tracer: permissions, wrappers, `campaigns.get` / remove / restore / purge,
`members.setCoGm`, the archived write guard, and the matrix (role `coGm`, class `creator`). Every existing `gm` entry
automatically gains a coGm row; run the whole matrix. Archive guard: campaign mutation wrappers throw
`CAMPAIGN_ARCHIVED` unless `archived: "allow"`; queries unaffected.

**S2 · Settings setter.** One `gmMutation` in `convex/campaignSettings.ts`; patch only the changed key.

**P1 · Preferences server.** `userQuery` / `userMutation`; `importLegacy` is idempotent per account and never fails on a
fold it can't verify (it skips it).

**PR1 · Presence.** Own table and own query so beats never re-send the roster. Server throttle 60 s. No `Date.now()` in
the query.

### Part A, wave 3

**G2 · Co-GM sweep (Q6).** Classify each `ownerId` comparison (role vs identity) in the task doc. Notes visibility:
co-GM reads like the GM.

**R1 · Fear visibility (Q3).** `campaigns.fear` returns `fear: null` to players when off; strip Fear numbers from feed
rows for players. "With Fear" on rolls stays.

**R2 · Refuse (Q2).** Where today's code builds a pending request for out-of-range targets, Refuse throws instead (before
anything is paid). Riders' extra targets are dropped. GM / co-GM acting for a PC are not refused.

**R3 · Fear at start (Q1).** Inside `sessions.start`'s keyed `once` and its actionLog group; logged like any Fear change.

**R4 · Clock per scene (Q4).** Not started before the answer.

**L1 · Lorekeeper settings.** Enforce in `ask` / `editQuestion` via `ctx.permission`; `available` reports `canAsk` /
`webAllowed`.

**U1-U5 · Sections.** Each owns only its section folder. Reuse server functions listed in the map; move (don't copy) the
Players dialog's invite logic into U3. U5's Archive row is a stub for S3; Advance per scene stays disabled until R4.

**U6a · Preferences + import + dice.** One-shot import guarded by `legacyImported`; remove migrated keys only after the
mutation succeeds. Dice settings read the account; signed-out / loading uses today's defaults.

**U6b · Reduce motion + text size (Q12, Q13).** `prefs-sync.tsx` next to `accent-sync.tsx`; one `useReducedMotion()`
hook; CSS rule mirroring the media query under `[data-reduce-motion]`. Check the combat map's pointer math at Large.

**U6c · Hand folds.** Server-backed fold in the HUD hand; optimistic.

**U6d · Spotlight ping (Q14).** Chime + toast on a change to a holder the viewer owns.

### Part A, wave 4

**S3 · Archive (Q9).** Creator only; refuse while a session is live; Archived group in Load Campaign; banner.

**JO1 / JO2 / JO3 (need the Journal plan).** Thin switches on Journal code: navigation after Start, the log assembler's
automatic sources, the spotlight bars for players.

**SX · Cut-over (Q10).** Delete the Players dialog and the dashboard's Campaign Rules panel; keep the Combat Map's
hand-sharing shortcut; live two-browser spec and axe.

### Part B, wave 5

**AD0 · Admin foundation (Q16).** Owner identity, wrappers, tables, audit helper, retention crons, error module, matrix
role + class. Defaults keep today's behaviour (env values read as fallback) until the owner saves something.

**AD1 · Admin shell.** `/admin` under `(gm)`; Not found for non-owners; no admin query runs for them.

### Part B, wave 6

**AD2 Overview, AD3 Accounts server.** Bounded reads with an explicit `ADMIN_READ_BOUND`; paginate lists. Alerts carry
codes + params, the client writes the text.

**AD4 Sign-up mode (Q18).** In `createOrUpdateUser`, only for **new** users; read-only also blocks sign-ups.

**AD5a / AD5b Caps (Q19).** Count with `take(cap + 1)`; archived and deleted campaigns don't count; co-GMs count as
players for the players cap.

**AD6 Lorekeeper budget (Q20, Q21).** Extend the existing meter in `convex/lib/lorekeeper/caps.ts`; never a second
counter. The owner is uncapped.

**AD8 Library upload (Q23).** Owner path only; text file deleted after ingest; uses the existing chunker and internal
ingest mutations.

**AD9 Feature switches (Q25).** Missing row = Everyone (ships today); one helper `featureOn`.

**AD10 Maintenance (Q29, Q31).** The read-only guard sits in every mutation wrapper and `userAction`; an inventory test
proves coverage. Key status returns booleans only.

**AD11 Export (Q30).** Paginated internal reads, explicit exclusion list, authenticated download, 1-hour expiry.

### Part B, waves 7-8

**AD7** 80% email once a month. **AU1-AU5** the tabs. **AU6** the owner's link in Preferences. **AF1** switches take
effect (client hook + server checks). **AX** superadmin e2e, docs, close dcm-cd8.

## Risks

- **Secrets.** Key status must return booleans only. Nothing returns an env value, and the test compares every returned
  string with every env value. The export excludes every `auth*` table (password hashes, sessions, refresh tokens,
  verification codes), `lorekeeperChunks` (copyrighted book text) and rate-limiter state, and it is downloaded only
  through an owner-checked `httpAction`, never a `getUrl` link (CF18). The 80% email and the audit log never include
  keys or codes. AD8 deletes uploaded book text right after ingest.
- **Superadmin bypass.** The owner check exists in one helper and three wrappers. An admin function built on a plain
  user wrapper would be open to everyone, so the authz class `appOwner` and its guard make a misfiled function fail
  `pnpm test`. Owner exemptions (Lorekeeper caps, read-only) call `isAppOwner`, never a client flag. The owner is never
  silently a GM of others' campaigns (Q27). `setOwner` is internal only, and the owner is never chosen by email at
  request time.
- **Co-GM leaks.** Making a co-GM `owner` grants every GM read, GM-only notes included, so G2's sweep and Q6 must land
  before co-GMs are offered in the UI (U3 depends on G1, and SX depends on U3; G2 should merge before U3 ships to users).
  Missing one `ownerId` role check means a co-GM silently gets player rights there, which is safe but wrong. Missing a
  creator-only check would let a co-GM delete or archive, so the matrix class `creator` covers those functions.
- **Read-only mode coverage.** The guard lives in the wrappers, so raw `internal*` functions are not covered. Scheduled
  runs keep going (a Lorekeeper answer already started finishes; crons keep cleaning), and that is intended (Q31).
  `httpAction`s (uploads, export) need their own check. Auth sign-in still writes sessions (allowed), while sign-ups are
  blocked (AD4). `markOpened` and `presence.beat` must be exempt, or every page load fails. An inventory test checks
  that a sample per wrapper refuses. Every mutation adds one tiny `appStatus` read, kept in its own document so
  config edits never conflict (CD10).
- **Archived campaigns.** The guard sits in campaign mutation wrappers, so user-level mutations that touch campaign
  data indirectly (character functions on `userMutation` + `permissionFor`, notes entries) need the same check. G1 lists
  them in its task doc and adds `assertNotArchived` where a function is not on a campaign wrapper.
- **Migrating local prefs.** The import runs once per account (`legacyImportedAt`). Values from the first device win,
  and later devices' local values are dropped: accepted, and the task doc says so. Keys are removed only after a
  successful import. Blocked storage means nothing to import. Fold keys for campaigns the user can no longer see are
  skipped. The HUD key is just deleted (wave 9 removed its reader). Signed-out pages keep defaults.
- **Rule 13 exceptions.** The presence heartbeat and the one-shot legacy import are mutations started from effects.
  They follow the existing `markOpened` precedent in `campaign-shell.tsx`. The user should confirm the exception
  (Q11); otherwise presence moves to the `@convex-dev/presence` component and the import moves to a button.
- **Text size.** The app sizes text in px, so `zoom` is the only cheap global lever. It can break canvas pointer math
  and fixed overlays, and U6b must test the combat map.
- **Journal coupling.** R3, JO1-JO3 edit Journal files. If the Journal plan slips, they wait (the settings rows show and
  save, but have no effect until then; U5 labels Advance per scene "Coming soon" only).
- **Feature switch defaults.** A missing row means Everyone, so nothing that ships today disappears when Part B lands.
  Turning a feature Off must never delete data (board: "Nothing is lost when a feature is off").
- **Caps on existing data.** Lowering a cap never removes campaigns, players or characters; it only refuses new ones.
  Restore and unarchive check the caps too.

## Beads to create (one per tracer, children of dcm-jh6d; label `server` or `ui` as fits)

| Tracer | Title |
|---|---|
| S0 | Config S0: Part A data foundation (table settings, archive stamp, co-GM field, prefs / folds / presence tables) |
| S1 | Config S1: Settings slide-over and Preferences popover shell (gear + avatar) |
| G1 | Config G1: co-GM permission core, creator rank, archived write guard, authz role (absorbs dcm-jh6d.1) |
| S2 | Config S2: campaign settings single-field setter |
| P1 | Config P1: preferences server, legacy import, hand folds |
| PR1 | Config PR1: presence heartbeat and online / away list |
| G2 | Config G2: co-GM sweep of ownerId role checks |
| R1 | Config R1: Players see the GM's Fear (off hides the pool) |
| R2 | Config R2: Out-of-range Refuse |
| R3 | Config R3: Fear at session start: reset to number of PCs |
| R4 | Config R4: Day and night clock per scene (after Q4) |
| L1 | Config L1: Lorekeeper who can ask + campaign internet switch |
| U1 | Config U1: Settings / At the table |
| U2 | Config U2: Settings / House rules |
| U3 | Config U3: Settings / Players (roster, presence, invite link, co-GM) |
| U4 | Config U4: Settings / Lorekeeper |
| U5 | Config U5: Settings / Sessions |
| U6a | Config U6a: Preferences rows, legacy import, dice from the account |
| U6b | Config U6b: reduce motion and text size applied app-wide |
| U6c | Config U6c: Hide cards on the account |
| U6d | Config U6d: ping on spotlight |
| S3 | Config S3: archive a campaign |
| JO1 | Config JO1: a new session opens on Journal / Combat Map (needs Journal) |
| JO2 | Config JO2: session log from the Combat Map switch (needs Journal) |
| JO3 | Config JO3: spotlight balance to players (needs Journal) |
| SX | Config SX: Part A cut-over (Players dialog and Campaign Rules panel removed, live + a11y specs) |
| AD0 | Admin AD0: owner identity, appOwner wrappers, admin tables, audit + cleanup cron |
| AD1 | Admin AD1: /admin shell |
| AD2 | Admin AD2: Overview server |
| AD3 | Admin AD3: Accounts server (sign-up mode, caps, account table, testers) |
| AD4 | Admin AD4: sign-up mode enforced |
| AD5a | Admin AD5a: campaign caps enforced |
| AD5b | Admin AD5b: player and character caps (resolves dcm-cd8) |
| AD6 | Admin AD6: Lorekeeper budget, at-limit modes, daily internet searches, use by campaign |
| AD7 | Admin AD7: email at 80% of the Lorekeeper limit |
| AD8 | Admin AD8: book library upload / replace |
| AD9 | Admin AD9: feature switches server |
| AD10 | Admin AD10: read-only mode, banner status, key status, backups info |
| AD11 | Admin AD11: export everything as JSON |
| AU1 | Admin AU1: Overview tab |
| AU2 | Admin AU2: Accounts tab |
| AU3 | Admin AU3: Lorekeeper tab (+ GM raise row) |
| AU4 | Admin AU4: Feature switches tab + testers |
| AU5 | Admin AU5: Maintenance tab + read-only banner |
| AU6 | Admin AU6: App admin link in Preferences |
| AF1 | Admin AF1: feature switches take effect |
| AX | Admin AX: superadmin e2e, docs, close dcm-cd8 |

Dependencies between beads mirror `depends_on`. dcm-jh6d.1 closes with G1 + G2 + U3; dcm-cd8 closes with AD5b + AX;
dcm-bxp.134 stays open for the rule-switch plan.

## Open questions for the user

Each has a recommended default (**bold**), which the plan is built on. Book page numbers are the printed pages.

### Settings that change rules

**Q1. Fear at the start of a session: "Reset to number of PCs" (R3).**
> "When you start a campaign, you begin with an amount of Fear equal to the number of PCs. … You can hold up to a
> maximum of 12 Fear. … you should keep this pool visible to players during the game. Fear carries over between
> sessions, so note how many Fear you have at the end of each session and begin the next time with that same pool."
> (Core Rulebook p.154, Fear: Gaining Fear / Tracking Fear)

The book's rule is Carry over, which is the setting's default. "Reset to number of PCs" applies the campaign-start rule
at every session, so it is a variant.
- (a) **Reset at Start to the number of active PCs (not retired, not dead), capped at 12, in the same undoable step
  as Start, and logged as a Fear change.**
- (b) Count only the PCs whose players are present (online) at Start.
- (c) Count all PCs ever made in the campaign.

**Q2. Out-of-range actions: "Refuse" (R2).**
> "Out of Range: Anything beyond a character's Very Far range is Out of Range and usually can't be targeted."
> (Core Rulebook p.103, Range). Optional rule, same page: "Defined Ranges … Melee: 1 square · Very Close: 3 squares ·
> Close: 6 squares · Far: 12 squares · Very Far: 13+ squares · Out of Range: Off the battlemap."

Today's behaviour (the user's combat-actions Q1) is Ask me: an action whose target is outside the action's range band
becomes a request the GM approves.
- (a) **Refuse means the server rejects a player's action whose target is outside the action's range band. Nothing
  is paid and the message names the band. Extra targets a rider adds out of range are dropped, and the action goes
  on. A GM or co-GM acting for a PC is not refused.**
- (b) Same as (a), but also for the GM's actions.
- (c) Refuse only targets beyond Very Far (the book's "Out of Range"), and keep Ask me for range-band mismatches.

**Q3. "Players see the GM's Fear" off (R1).** The book says to keep the Fear pool visible to players (p.154, quoted in
Q1), so off is a house rule.
- (a) **Hide the pool number everywhere a player reads it: the Fear banner and panel, and the Fear numbers in the feed
  and log lines. "Rolled with Fear" on a roll result stays visible.**
- (b) Hide only the banner and panel.

**Q4. Day and night clock "Advance per scene" (R4).** The core book has no day / night clock. The Witherwild frame
says:
> "The day and night cycle occurs weekly, meaning the sun rises for an entire week before setting into a nighttime of
> the same length." (Core Rulebook p.259, The Witherwild: The Weeks of Day and Night)

Today every campaign has a manual clock (End day, Day / Dim / Night, Witherwild's Day / Night weeks). What should
advance when a scene ends?
- (a) The time of day moves one step (Day → Dim → Night → Day), and the Witherwild is excluded.
- (b) One day passes (End day: once-per-day uses end).
- (c) Witherwild only: one day of its week passes.
- (d) Drop "Advance per scene" and keep Manual only.
- **Recommended: leave the setting on Manual (today) and build R4 only after your answer. Option (a) is the
  placeholder.**

**Q5. "Show spotlight balance to players" (JO3).** No book rule (spotlight balance is a GM principle, not a mechanic).
- (a) **Players see the spotlight bars and the "least spotlight" line in Log & recap; the tally tiles stay GM-only.**
- (b) Players see the bars only.

### Co-GM

**Q6. What does a co-GM see in Notes (G2)?**
- (a) **The same as the GM: GM-only pages and every shared page. Pages they write are their own journal's.**
- (b) Player visibility in Notes; the co-GM is a GM only at the table.

**Q7. Who manages co-GMs and who can archive?**
- (a) **Only the creator promotes or demotes co-GMs and archives the campaign. A co-GM can remove players but not
  other co-GMs.**
- (b) Co-GMs can also promote other members.

**Q8. Who can become a co-GM?**
- (a) **Existing members only, promoted from the Players section.**
- (b) Also invite someone by email directly as co-GM.

### Campaign settings, other

**Q9. Archive (S3).**
- (a) **Archived means read-only for everyone. It cannot be archived while a session is live. It shows under
  "Archived" in Load Campaign, does not count toward the caps, and the creator restores it.**
- (b) Archived also hides the campaign from players' Load list.

**Q10. Duplicates after the cut-over (SX).**
- (a) **Remove the top bar's Players dialog and the dashboard's Campaign Rules panel. Keep the Combat Map's
  hand-sharing toggle as a shortcut to the same setting.**
- (b) Keep all of them.
- (c) Remove the Combat Map toggle too.

**Q11. Online / Away (U3) and the rule-13 exception.**
- (a) **Our own `campaignPresence` table. A tab beats every 60 s while it is visible; Online means seen in the last
  2 minutes. The heartbeat (and the one-shot prefs import) follow the `markOpened` effect precedent.**
- (b) Use the `@convex-dev/presence` component (a new dependency).

### Preferences

**Q12. Text size (U6b).** The app sets text in px.
- (a) **CSS `zoom` on the app root: Small 0.9, Medium 1, Large 1.15.**
- (b) Convert the app's text to rem (a large refactor).
- (c) Scale only reading text: sheets, cards, Journal, Lorekeeper.

**Q13. Reduce motion.**
- (a) **On = calmer even when the device doesn't ask. Off = follow the device. The app never forces motion on a device
  that asks for less.**
- (b) Off forces full motion.

**Q14. "Ping me when I get the spotlight."**
- (a) **A soft chime at the dice volume plus a toast "You have the spotlight", when the spotlight moves to a PC you own,
  on any campaign page.**
- (b) Also a browser notification when the tab is hidden (asks permission).
- (c) Toast only.

**Q15. Which browser values move to the account?**
- (a) **3D dice, dice sound and Hide cards. The token Names switch, range circles, catalogue sort orders and wizard /
  custom-frame drafts stay on the device. The dead HUD key is deleted.**
- (b) Move all of them.

### Admin

**Q16. How is the app owner identified (AD0)?**
- (a) **Stored in the database by `npx convex run adminSetup:setOwner '{"email": …}'`, which only someone with the
  deployment's admin key can run. It matches a verified email once and stores the user id.**
- (b) Env var `APP_OWNER_EMAIL`, matched against a verified email on every call.
- (c) Env var `APP_OWNER_USER_ID`.

**Q17 (decided, tell us if not).** A non-owner gets FORBIDDEN from admin functions, and the page shows "Not found".

**Q18. "Invite link only" sign-up (AD4).**
- (a) **A new account is allowed for an email with a pending campaign invite, or for a password sign-up that came
  through a join link (the code is passed with the sign-up). Google sign-up works only for invited emails. Existing
  accounts always sign in.**
- (b) Email invites only.

**Q19. Default caps (until you change them) and dcm-cd8.**
- (a) **Campaigns per GM 10, campaigns in the app 100, characters per player per campaign 5 (retired included),
  players per campaign 8 (co-GMs count, the creator doesn't). The caps apply to you too. The per-campaign bound of 50
  characters (dcm-cd8) stays as an abuse bound, and dcm-cd8 closes with the new per-player cap.**
- (b) The board's numbers: 3 / 6 / 2 / 6.
- (c) Other numbers.

**Q20. "Shorter answers" at the spend limit (AD6).**
- (a) **Sonnet only: no stronger-model retry, no internet pass, half the answer length. A hard ceiling of 120% of the
  limit then pauses. "GMs only" has the same 120% ceiling.**
- (b) Drop "Shorter answers".

**Q21. "Let GMs raise limits for their own table, up to the app limits above."**
- (a) **You also set ceilings ("GMs may raise up to N questions and M searches a day"). A GM sets their campaign's
  per-person numbers between your defaults and those ceilings, in their Lorekeeper settings.**
- (b) GMs may double your numbers.
- (c) Drop the switch.

**Q22. "Questions this month 412 of 1500."**
- (a) **Show the count only; there is no monthly question cap. Money is the cap.**
- (b) Add a monthly question cap.

**Q23. Book library Upload / Replace (AD8).** Today books are ingested with `pnpm lorekeeper:ingest` from a text file
outside the repo.
- (a) **Upload the same page-tagged `.txt` from the admin. It is chunked server-side, and the file is deleted right
  after. This is an owner-only exception to the image-only upload allowlist.**
- (b) Upload a PDF and parse it on the server (new dependency, heavier).
- (c) Keep the CLI. The admin shows the library read-only with the instructions.

**Q24. "Your Witherwild notes · Uploaded by you" / "38 pages · The Witherwild only".**
- (a) **This is the existing House rules (notes) book: the GM's pages shared with everyone. There is no per-campaign
  upload in this plan.**
- (b) Add per-campaign book uploads by GMs.

**Q25. Which feature switches?**
- (a) **3D dice, Phone layout (the HUD's phone layout under 600 px), Lorekeeper internet search and Sprite tokens.
  Drop Journal: it has cut over by then, and its old page is deleted. Add Share links when share links are built.
  A missing switch means Everyone, so nothing shipped disappears.**
- (b) Keep every board row, including Journal and Share links, as inert switches.

**Q26. Recent changes (audit).**
- (a) **Admin changes plus campaign created / deleted events, kept for 1 year.**
- (b) Admin changes only.

**Q27. "Open" on other people's campaigns in the Overview.**
- (a) **No access. "Open" shows only for campaigns you are in; the owner is not a GM of every campaign.**
- (b) Read-only view of any campaign.

**Q28. The account row's "···" menu.**
- (a) **Add to testers / Remove from testers only.**
- (b) Also suspend or delete accounts (needs its own design).

**Q29. Backups.** Convex keeps backups in its dashboard (and `npx convex export`). Functions have no API to list them
or read the last backup time.
- (a) **Show "Backups are managed in the Convex dashboard" with a link to this deployment's dashboard. No "last backup"
  time.**
- (b) Our own nightly export into storage as an extra backup (a cron, with retention).

**Q30. Export everything as JSON.**
- (a) **An in-app export to a temporary file, downloaded through an owner-checked route and deleted after 1 hour.
  Auth secrets, book text and rate-limit state are excluded.**
- (b) Instructions for `npx convex export` only.

**Q31. Read-only mode exemptions.**
- (a) **You are exempt. Opening a campaign and the presence heartbeat still record; sign-in works; sign-ups are
  blocked; background jobs keep running, so a Lorekeeper answer already started finishes.**
- (b) No exemptions, not even for you, except turning read-only off.

**Q32 (decided, tell us if not).** The 80% email goes to your verified email, once per month.
