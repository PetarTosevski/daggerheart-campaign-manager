# TASK-105 — D2.5: Accounts and roles (multi-user)

- **Status:** Done (2026-10-17)
- **Phase:** D2.5 of `docs/design-port-roadmap.md` (added by the user's decision that the app is multi-user)
- **bd:** `dcm-bxp.12`
- **Decisions:** `docs/decisions-d3-d11.md`

## Delivered

- **Sign-in:** Google plus email + password sign-up and sign-in (Convex Auth `password` provider). Both are limited to the allowlist `ALLOWED_EMAILS` ∪ legacy `GM_EMAILS` ∪ emails in `SEED_ACCOUNTS`. `npx convex run accounts:seed` creates the `SEED_ACCOUNTS` logins (`email:password;…`). Seed accounts (allowlisting and `accounts:seed`) work only on a local e2e deployment or where `ALLOW_SEED_ACCOUNTS` is exactly `true` (follow-up X1, `dcm-bxp.24`).
- **Account safety:** a new password account is refused when a user with that email already exists; a Google sign-in onto a user created by password (unverified) deletes that password login and its sessions, so nobody can pre-register someone else's address. `?next=` returns to the page you came from (for example a join link), limited to same-site paths (`safeNextPath`).
- **Roles per campaign** (`convex/lib/access.ts`): the creator is the GM; a `campaignMembers` row or an email invite makes a player; anyone else gets `NOT_FOUND`, and players calling GM-only functions get `FORBIDDEN`. Every existing function moved from `requireGm` + owner checks to `requireUser` + role checks.
- **Joining** (`convex/members.ts`): GM email invites (accepted on first open), join codes (8 characters, no 0/O/1/I/L, uniformly random; the GM can replace the code; removing a player replaces it too), `/join/<code>` links with a confirm screen, "Join Campaign" on the title menu, players can leave, the GM can remove players.
- **Player view:** Load Campaign shows a Game Master / Player badge (Leave instead of Delete for players); the dashboard is read-only for players (GM Fear, countdowns and the time arc are visible but not changeable); the GM gets a Players dialog (join code and link, invites, table roster).

## Reviews

- Architect: approved with fixes; security review: pass with fixes. All fixes applied: open redirect via `next`, Google sign-in ignoring join links, password pre-registration takeover, invites left behind after joining, removed players rejoining with the old code, join-code modulo bias, auto-join on link visit (now a confirm), players seeing the GM's last-opened time, "Game Master" label in Settings.
- Open (accepted for now): `SEED_ACCOUNTS` emails are allowlisted even if seeding skipped them, and the passwords live in env vars, so **don't set `SEED_ACCOUNTS` on production**. `campaigns.list` reads all of a user's campaigns (fine at table scale).

## User steps

- **`ALLOW_SEED_ACCOUNTS`:** to use the seed accounts on the cloud dev deployment, run `npx convex env set ALLOW_SEED_ACCOUNTS true` there, then `npx convex run accounts:seed`. **Never set `ALLOW_SEED_ACCOUNTS` (or `SEED_ACCOUNTS`) on production**: it would make the env-stored passwords real logins. Without the flag, cloud deployments ignore `SEED_ACCOUNTS` and `accounts:seed` refuses to run.

- Optionally rename `GM_EMAILS` to `ALLOWED_EMAILS` on each Convex deployment and add the players' emails (`npx convex env set ALLOWED_EMAILS "you@…,player@…"`). Until then `GM_EMAILS` keeps working as the allowlist.

## Checks (2026-10-17)

| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Pass |
| `pnpm test` | 19 files, 141 tests passed (new: `tests/convex/members.test.ts`, password cases in `create-or-update-user.test.ts`, `tests/unit/safe-next.test.ts`, allowlist sources) |
| `pnpm test:e2e` (includes build) | 18 passed (new: `tests/e2e/players.spec.ts`: join by code, email invite + leave, password sign-up/sign-in, refusals) |
