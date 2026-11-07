# TASK-LAND: the phone app as nine stacked PRs

Tracer LAND of `.omc/plans/phone.yaml` (epic dcm-gdzi). It lands PR #2 (the Expo app in `apps/mobile`, by
Nikola Blagoevski) on `rebuild` as nine stacked PRs, in the order from the review's "How to land it".

## The branches

All branches are local. Nothing is pushed.

| PR | Branch | Base | What it adds |
|----|--------|------|--------------|
| 1 | `phone/pr-1` | `rebuild` | Server auth for the app |
| 2 | `phone/pr-2` | `phone/pr-1` | Workspace, tooling, theme, ui, auth provider, campaign shell |
| 3 | `phone/pr-3` | `phone/pr-2` | Account |
| 4 | `phone/pr-4` | `phone/pr-3` | Dashboard and frame trackers |
| 5 | `phone/pr-5` | `phone/pr-4` | Party and character sheet |
| 6 | `phone/pr-6` | `phone/pr-5` | Codex, World, Players, Tome |
| 7 | `phone/pr-7` | `phone/pr-6` | Journal |
| 8 | `phone/pr-8` | `phone/pr-7` | Lorekeeper |
| 9 | `phone/pr-9` | `phone/pr-8` | Combat (behind a flag), adversaries, sprite packs |

The source is `phone/land-base`: `phone/on-rebuild` (the finished app, Nikola's commits kept under his name)
merged with `rebuild`. The tree of `phone/pr-9` equals `phone/land-base`. Each PR is one squashed commit. A
screen whose PR has not landed yet is a `NotBuiltYet` stub (`apps/mobile/src/shell/not-built-yet.tsx`), so
every route renders from PR 2 on.

Open each PR against the one before it. Retarget each PR to `rebuild` after the one below it merges.

Every PR passes these checks on its own:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @dualityheart/mobile run check   # PR 2 onward: ESLint, tsc --noEmit and Jest for apps/mobile
```

Jest checks the phone's fixtures against the real Convex `returns` validators
(`apps/mobile/scripts/convex-returns.mjs`). A fixture that no longer matches the server fails the test.

To run the app, see "How to run it" in `docs/phone-client.md`. The device checklists named below are in that file.

---

## PR 1

**Title:** Phone 1/9: server auth for the Expo app (Apple native sign-in, native redirects)

**Description:**

The first of nine stacked PRs that land the phone app (PR #2) on `rebuild`. This one changes only the server.

What it adds:

- Apple native sign-in in `convex/auth.ts`. The app sends Apple's identity token. The server verifies it against
  Apple's keys (`convex/lib/appleIdentity.ts`), which it caches. Sign-in attempts are rate-limited
  (`convex/lib/appleSignInLimit.ts`). The dev bundle id is accepted only on a local deployment or where
  `ALLOW_DEV_APPLE_SIGN_IN=true`.
- An allowlist of native redirects for the app's schemes (`convex/lib/nativeRedirect.ts`). Google sign-in from
  the phone returns over https.

How to test:

- `pnpm test` runs `tests/convex/apple-native.test.ts`, `tests/convex/create-or-update-user.test.ts`,
  `tests/unit/apple-identity.test.ts` and `tests/unit/native-redirect.test.ts`.
- The website's sign-in does not change. Sign in on the website with email, Google and Apple.

Device checks: none. Nothing here runs on the phone yet.

---

## PR 2

**Title:** Phone 2/9: pnpm workspace with apps/mobile, root checks, theme, ui and the campaign shell

**Description:**

The second of nine stacked PRs that land the phone app. It adds the app's skeleton. Each feature screen is a
`NotBuiltYet` stub until its own PR.

What it adds:

- A pnpm workspace with `apps/mobile` (`@dualityheart/mobile`): Expo, React Native, Jest and Skia. The stack is
  added to AGENTS.md and CLAUDE.md.
- Root `pnpm lint`, `pnpm typecheck`, the pre-commit hook and CI also check `apps/mobile`. Vercel installs only the
  website (`pnpm install --filter .`).
- Theme, ui kit, the auth provider and token storage, and the campaign shell: tab bar, More menu, campaign
  provider, offline and read-only frames, one shared `QueryBoundary`, and the route error boundary.
- The Jest harness. Its fixtures are checked against the Convex return validators. `test/shared-imports.test.ts`
  makes the phone import shared logic from `src/lib` instead of copying it.
- `docs/phone-client.md` and the phone's task notes.

How to test:

- `pnpm --filter @dualityheart/mobile run check`.
- `cd apps/mobile && pnpm exec expo start --dev-client`. The app boots. Every campaign route shows the shell with a
  "Not built yet." page.

Device checks (`docs/phone-client.md`): "Builds and store identity (PX16)". This covers the status bar, the
preview and dev app names, and a Vercel build log with no Expo packages.

---

## PR 3

**Title:** Phone 3/9: account (sign-in, campaigns, join, settings)

**Description:**

The third of nine stacked PRs that land the phone app.

What it adds:

- Email and password sign-in with the website's accounts. Google and Apple stay off unless
  `EXPO_PUBLIC_SOCIAL_SIGN_IN=true`. Password reset.
- Home and the campaign list. Archived campaigns are listed under "Archived": Open for every member, Restore for
  the creator. Co-GM campaigns are listed.
- New campaign and custom campaign, and the frame intro.
- Join by code and by link. A signed-out `/join/<code>` goes through sign-in and comes back.
- `campaigns.markOpened` from the campaign layout.
- Account settings, campaign settings, preferences and account deletion.
- Shared code: the website's date formatting moves to `src/lib/dates.ts`, and its custom-tome chapters move to
  `src/lib/frames/tomes.ts`. Both apps import them.

How to test:

- `pnpm --filter @dualityheart/mobile run check` (`test/auth/*`, `test/features/account/*`,
  `test/shell/campaign-layout.test.tsx`).
- `pnpm test` covers the website's Journal and Tome after the shared-code move.
- On a device: sign in, create a campaign, join one with a code from a second account, and archive and restore
  a campaign.

Device checks: "Polish and account (PXL)". That list covers the splash and fonts, sign-in with the keyboard,
offline, the day-then-month dates and the Archived section. The Players item belongs to PR 6.

---

## PR 4

**Title:** Phone 4/9: campaign dashboard and frame trackers

**Description:**

The fourth of nine stacked PRs that land the phone app.

What it adds:

- The campaign dashboard: header, Fear, party strip, countdowns, rests, roll feed, last session, tome card and GM
  panels. Fear is hidden when the campaign has none. Archived, owner-view and read-only banners.
- Frame trackers: Witherwild, Age of Umbra, Andaluria, Colossus, Five Banners, Horizon and Weredragon. GMs and
  co-GMs can edit them.
- Shared code: the website's countdown items move to `src/lib/domain/countdowns/items.ts`.

How to test:

- `pnpm --filter @dualityheart/mobile run check` (`test/features/dashboard/*`, `test/features/trackers/*`,
  `test/shell/read-only.test.tsx`).
- On a device: open a campaign as GM and as player. Change Fear and a countdown on the website and watch the phone
  follow.

Device checks: the offline item in "Polish and account (PXL)" (the dashboard is the first campaign page).

---

## PR 5

**Title:** Phone 5/9: party and character sheet

**Description:**

The fifth of nine stacked PRs that land the phone app. It is the largest (about 15k lines added) because the
website's party models move to `src/lib` in the same PR.

What it adds:

- The party roster and the character wizard. The wizard's draft is kept on the account, as on the website
  (`drafts.get`, `drafts.save` and `drafts.clear`). Portrait upload.
- The character sheet:
  - Resources move optimistically through `applyResourceDelta` under the D4 switch. Traits send `setTrait` deltas.
  - Cards, equipment, class features, Lunar, heritage and story.
  - Dice and Tag Team play the rolls the server returned.
  - Rests and downtime, level-up and death moves.
  - Incoming hits in every mode.
- Shared code: the website's wizard logic and draft, level-up helpers, roll copy, features helpers and incoming-hit
  model move to `src/lib/party/*` and `src/lib/combat-map/reactions.ts`. The website now imports them from there.
- `features/adversaries/use-tracker.ts`, `intent.ts` and `types.ts` come in this PR because the sheet uses their
  optimistic helpers. The adversary screens land in PR 9.

How to test:

- `pnpm --filter @dualityheart/mobile run check` (`test/features/party*`, `test/features/sheet*`).
- `pnpm test`: the website's wizard, level-up, dice, features and incoming-hit unit tests run against the
  moved models.
- On a device: create a character, mark HP and Stress, roll a trait, take a rest and level up. Watch the website
  update live.

Device checks: no checklist in `docs/phone-client.md` targets the sheet. Check the steps above by hand.

---

## PR 6

**Title:** Phone 6/9: Codex, World, Players and Tome

**Description:**

The sixth of nine stacked PRs that land the phone app.

What it adds:

- Codex (Characters and Locations): list, GM detail, player view, gallery and pins.
- The world map. Skia paths are parsed once per change, and pinch and pan work. Horizon gets hex markers. The
  travel legend is shown. GMs can edit the world map.
- Players:
  - The creator makes a member co-GM and back, and invites by email as Player or Co-GM.
  - Join code.
  - Remove, with a confirmation. A co-GM can remove players only.
- The campaign tome: chapter editor, mechanics and custom notes.
- Shared code: the website's codex list model moves to `src/lib/codex/list-model.ts`.

How to test:

- `pnpm --filter @dualityheart/mobile run check` (`test/features/codex`, `world`, `world-edit`, `players`,
  `tome`).
- On a device: open a codex entry as player and GM, pan and pinch the world map, make a member co-GM, and edit a
  tome chapter.

Device checks: the Players item in "Polish and account (PXL)".

---

## PR 7

**Title:** Phone 7/9: Journal

**Description:**

The seventh of nine stacked PRs that land the phone app. The Journal is a new port of the website's Journal, which
replaced Sessions and Notes.

What it adds:

- Sessions, with the log, the tally and After the session.
- Notes pages, with sharing, mentions and export.
- `/sessions` and `/notes` redirect into the Journal's sub-tabs.
- Six notes helpers are still copies of website code. They are listed in `KNOWN_COPIES`
  (`test/shared-imports.test.ts`) until they move to `src/lib`.

How to test:

- `pnpm --filter @dualityheart/mobile run check` (`test/features/journal`, `notes`, `sessions`,
  `test/shell/routes.test.ts`).
- On a device: open a session and a notes page, share a page with a player, and export one.

Device checks: the dates item in "Polish and account (PXL)" ("Sun 2 Nov" in the Journal).

---

## PR 8

**Title:** Phone 8/9: Lorekeeper

**Description:**

The eighth of nine stacked PRs that land the phone app.

What it adds:

- Lorekeeper chat, with the composer.
- Answers with quotes and verdicts, rulings, the library, pins and the conversations menu.
- Copy via Share.
- Access follows `lorekeeper.access`: who can ask, the web search switch and the daily limits.
- Shared code: the website's Lorekeeper answer, composer, names and selection models move to `src/lib/lorekeeper`.
  `errorCode` moves with them, and the combat HUD queue now imports it from there.

How to test:

- `pnpm --filter @dualityheart/mobile run check` (`test/features/lorekeeper`).
- `pnpm test` (`tests/unit/lorekeeper-ui/model.test.ts`, `tests/unit/hud/queue-model.test.tsx`).
- On a device: ask a question, pin an answer, and hit the daily limit with a player account.

Device checks: none listed. Check the steps above by hand.

---

## PR 9

**Title:** Phone 9/9: combat map, play and GM tools, editing, sprite packs and adversaries (behind a flag)

**Description:**

The last of nine stacked PRs that land the phone app.

The combat map sits behind a flag (`apps/mobile/src/features/combat-map/flag.ts`). It is on in development builds.
A release build needs `EXPO_PUBLIC_PHONE_COMBAT_MAP=1`.

What it adds:

- The combat map view:
  - The map paints once per layout change and pans on shared values.
  - Players see fog, on generated and image maps. The GM sees every token.
- Player play:
  - Hand with every action use.
  - Attack with range, line of sight and cover.
  - Results, Minion picks and ally picks.
- GM tools: adversary attacks, view as PC, fog brush, doors and per-PC reveal.
- Combat map editing and sprite packs.
- The adversaries tracker and the encounter screens.
- Seven combat-map and packs helpers are still copies of website code. They are listed in `KNOWN_COPIES` until they
  move to `src/lib`.

How to test:

- `pnpm --filter @dualityheart/mobile run check` (`test/features/combat-*`, `adversaries`, `packs`,
  `test/shell/adversaries.test.tsx`, `combat-map-gate.test.tsx`, `gm-stubs.test.tsx`).
- `test/features/combat-view/paint-budget.test.tsx` checks that 300 gesture frames make no paint.

Device checks (`docs/phone-client.md`):

- "Combat map: paint budget and device checks (PX14)": paint time, 60 fps, pinch, fog, Android texture limit and
  large-map painter speed.
- "Combat play and GM tools: device checks (PX15)".
- "Combat map, checked on a simulator": the empty GM map buttons were not tried on a device.

---

## Landing order

1. Merge PR 1 into `rebuild`. Retarget PR 2 to `rebuild`, then repeat up the stack.
2. After each merge, run `npx convex codegen` on `rebuild` and rerun the checks. PR 1 adds
   `convex/lib/appleIdentity.ts`, `appleSignInLimit.ts` and `nativeRedirect.ts`, which `convex/_generated/api.d.ts`
   lists. The branches leave `convex/_generated` as `rebuild` has it, as PR 1 and PR 2 always did.
3. If `rebuild` moves before the stack lands, merge it into `phone/land-base` and cut the stack again. The cut is
   a fixed list of paths per PR.
