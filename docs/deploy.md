# Production runbook: dualityheart.com

The site is live on Vercel at https://dualityheart.com. Open sign-up is on `master` (dcm-bxp.128). Tag `v1.0.0`
(2026-10-26, "Release: rebuild (dualityheart.com launch)") is an ancestor of `origin/master`. This file started as
the pre-launch runbook (dcm-bxp.133). Steps that are done are marked **Finished**. The rest is still operational.
Steps marked **USER** need the account owner. Do not record secret values here.

Hosting: Vercel project `petartosevski/daggerheart-campaign-manager` (linked in `.vercel/`), Convex production
deployment. Vercel builds from `master` (`vercel.json`: `npx convex deploy --cmd 'pnpm build'`; the `ignoreCommand`
skips every non-production build, so branches and PRs do not deploy).

## 0. Prepared before launch — Finished

- `dualityheart.com` and `www.dualityheart.com` are on the Vercel project, and the site is served at
  https://dualityheart.com.
- The Convex production deployment exists. Production deploys run inside the Vercel build.
- A 2026-10-26 snapshot said Convex production had only `ANTHROPIC_API_KEY`, and Vercel Production had only
  `CONVEX_DEPLOY_KEY`. That inventory is not current. This runbook does not list which values are set now.
  `NEXT_PUBLIC_CONVEX_URL` is injected by `convex deploy` during the build, so it is not set by hand.

## 1. GoDaddy DNS — Finished

The domain stays at GoDaddy's nameservers (`ns19/ns20.domaincontrol.com`). https://dualityheart.com serves the
Vercel project, so DNS points at Vercel. The records below are the ones this runbook specified. Re-check them;
do not add a second set.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `216.198.79.1` | 600 |
| A | `@` | `64.29.17.1` | 600 |
| CNAME | `www` | `e5ef9f0bca898c3d.vercel-dns-017.com.` | 600 |

(`cname.vercel-dns.com` also works for `www`; the values above are what Vercel reports for this project.)
Re-read them any time: `vercel domains verify dualityheart.com` and `vercel domains verify www.dualityheart.com`.
Do not touch GoDaddy's MX or TXT records; Resend's records (step 2) are added next to them.

Optional, and not recorded here: in Vercel, Project Settings, Domains, `www.dualityheart.com` may redirect to
`dualityheart.com`.

Check: `vercel domains inspect dualityheart.com` shows no warning; `curl -I https://dualityheart.com` returns 200.

## 2. Resend sender domain (USER first, then an agent)

Still operational. The sign-up and reset code mail is built (`convex/lib/authEmail.ts`). Invite mail uses the same
sender (`convex/lib/inviteEmail.ts`). Convex env names: `AUTH_RESEND_KEY` and `MAIL_FROM`. This runbook does not
record whether the domain is verified or what `MAIL_FROM` is set to.

1. **USER**: accept the Resend terms in the browser: https://vercel.com/petartosevski/~/integrations/accept-terms/resend?source=cli
2. Agent: install the integration (`vercel integration add resend`, load the `vercel:marketplace` skill first).
3. In the Resend dashboard, add the domain `dualityheart.com` (or a subdomain such as `send.dualityheart.com`,
   which keeps the apex mail records clean). Resend then shows the exact DKIM (TXT), SPF (TXT) and return-path (MX)
   records for that domain. **These come from the Resend dashboard after install; copy them from there.**
4. **USER**: add those records at GoDaddy, then press Verify in Resend. Verification can take up to a day.
5. Create a Resend API key restricted to sending. Store it only as `AUTH_RESEND_KEY` in the Convex production env
   (step 4), never in Vercel or git. Set `MAIL_FROM` to a sender on the verified domain, for example
   `Duality Heart <noreply@dualityheart.com>`.

The sign-up code email (Convex Auth `Password` provider with `verify`, `convex/lib/authEmail.ts`) and the campaign
invite email (`convex/lib/inviteEmail.ts`) both send through this key as `AUTH_RESEND_KEY`, from `MAIL_FROM` (step 4).

## 3. Convex production deployment

The deployment already exists. Deploying happens through the Vercel build (`npx convex deploy` runs inside the build
with `CONVEX_DEPLOY_KEY`), so no manual deploy is needed after the merge in step 7.

- If the existing key must be replaced: Convex dashboard, production deployment, Settings, URL and Deploy Key,
  "Generate production deploy key", then **USER** sets it: `vercel env add CONVEX_DEPLOY_KEY production`
  (paste at the prompt; never put it in a file or command line). Verify with `vercel env ls` (names only).
- First-time creation on a fresh project would be `npx convex deploy` from a machine logged in to Convex; not needed here.
- Look up the production URLs (not secrets) in the dashboard: the `.convex.cloud` URL (client) and the `.convex.site`
  URL (HTTP actions, used by auth). Call the latter `<PROD_SITE_URL>` below.

## 4. Environment variables

Found by grepping `env.*` / `process.env.*` in `convex/`, `src/`, `scripts/`.

### Convex production (`npx convex env set --prod NAME value`)

| Variable | Needed | Who | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | Lorekeeper, map generation, photo import. Recorded as set on 2026-10-26; not re-checked here. |
| `SITE_URL` | yes | agent | `https://dualityheart.com`. Convex Auth redirects here after OAuth; invite emails link to `<SITE_URL>/signin`. Dev has its own value; do not copy it. |
| `JWT_PRIVATE_KEY` | yes | agent, only if unset | RS256 private key (PKCS8). The site is live: do not generate a new pair if one is already set. Regenerating signs everyone out. |
| `JWKS` | yes | agent, only if unset | Matching public JWKS. Same warning. |
| `AUTH_GOOGLE_ID` | yes | **USER** | Google OAuth client id (see step 5). |
| `AUTH_GOOGLE_SECRET` | yes | **USER** | Google OAuth client secret. |
| `AUTH_RESEND_KEY` | yes | **USER** | Resend API key (step 2). Sign-up, password-reset and invite emails. Only in Convex env. |
| `MAIL_FROM` | yes | agent | Sender on the verified domain, e.g. `Duality Heart <noreply@dualityheart.com>`. |
| `CONVEX_SITE_URL` | automatic | none | Provided by Convex itself to `convex/auth.config.ts`. Do not set. |
| `LOREKEEPER_MODEL`, `ANTHROPIC_MODEL` | optional | user | Defaults are fine; see `docs/lorekeeper.md`. |
| `LOREKEEPER_DAILY_QUESTIONS`, `LOREKEEPER_CAMPAIGN_MONTHLY_USD`, `LOREKEEPER_MONTHLY_USD` | optional | user | **Fallbacks only.** The owner sets these limits in App admin (step 4a); a value saved there wins over the env var. |

Generate the key pair only when production has neither key. The site is live; a new pair signs everyone out.
Run locally, pipe straight into Convex, never print or save it:

```bash
node --input-type=module -e '
import { exportJWK, exportPKCS8, generateKeyPair } from "./node_modules/.pnpm/jose@5.10.0/node_modules/jose/dist/node/esm/index.js";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const pk = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
process.stdout.write(JSON.stringify({ pk, jwks }));
' > "$SCRATCH/keys.json"   # SCRATCH = a temp dir outside the repo; delete the file afterwards
npx convex env set --prod JWT_PRIVATE_KEY -- "$(node -p 'require(process.argv[1]).pk' "$SCRATCH/keys.json")"
npx convex env set --prod JWKS -- "$(node -p 'require(process.argv[1]).jwks' "$SCRATCH/keys.json")"
rm "$SCRATCH/keys.json"
```

(`jose` is not a direct dependency, so import it by its pnpm path as above (check the version with `ls node_modules/.pnpm | grep jose`). Check both values are non-empty afterwards: `npx convex env get --prod JWKS | wc -c`. `npx @convex-dev/auth` can also do this interactively.)
Changing `JWT_PRIVATE_KEY` or `JWKS` signs everyone out. Do not rotate them on the live site.

### Convex production: must NOT be set

- `ALLOWED_EMAILS`, `GM_EMAILS`: the old invite allowlist. Sign-up is open (dcm-bxp.128) and the code no longer reads
  them; `GM_EMAILS` was set on prod for the invite-only launch, so remove it:
  `npx convex env remove --prod GM_EMAILS` (and `ALLOWED_EMAILS` if listed). Do not set them again to limit sign-up.
- `SEED_ACCOUNTS`, `ALLOW_SEED_ACCOUNTS`, `E2E_AUTH_ENABLED`, `E2E_AUTH_SECRET`, `LOREKEEPER_FAKE_MODEL`:
  test rails, off in production.

Check: `npx convex env list --prod | sed -E 's/=.*//'` lists names only.

## 4a. App admin (the app owner)

Limits, caps, switches and maintenance that used to need an env var or a code change now live in **App admin**
(`/admin`). Only the **app owner** can open it. Everyone else, a campaign's GM included, sees 'Not allowed', and
every admin function answers them `FORBIDDEN`. The check is on the server (`appOwnerQuery` / `appOwnerMutation` /
`appOwnerAction` in `convex/lib/functions.ts`); `tests/e2e/admin-superadmin.spec.ts` calls every admin function as a
GM and a player.

### Name the owner (once, Q16 a)

The owner is one stored account id (`appConfig.ownerId`), never an env var or an email matched at request time. Only
someone with the deployment's admin rights can set it:

```bash
# The account must exist and its email must be verified: sign in once on the site first.
npx convex run --prod adminSetup:setOwner '{"email": "you@example.com"}'   # drop --prod for the dev deployment
```

- Unknown or unverified email: `NOT_FOUND` ("Sign in once and confirm the email first"). A blank email, or one shared
  by two verified accounts: `INVALID`.
- Running it again with another email hands the role over at once. Every run is logged (`owner.set`).
- Changing the owner's email later does not move the role. An owner whose email is no longer verified is not the
  owner until it is verified again.
- The owner then finds 'App admin' in Preferences (the avatar menu), or goes to `/admin`.

### What lives where now

| What | Before | Now (App admin tab) | Fallback / default |
|---|---|---|---|
| Who can sign up | open sign-up only | Accounts › Who can join: Open sign-up / Invite link only / Closed | open |
| Campaigns per GM, campaigns in the app | no limit | Accounts › Who can join | 10, 100 (archived and deleted campaigns don't count) |
| Characters per player in a campaign | 50 per campaign (dcm-cd8) | Accounts › Who can join | 5 (retired included; GM and co-GM characters exempt) |
| Players per campaign | no limit | Accounts › Who can join | 8 (co-GMs count, the creator doesn't) |
| Lorekeeper monthly spend, questions per day | `LOREKEEPER_MONTHLY_USD`, `LOREKEEPER_DAILY_QUESTIONS` | Lorekeeper › Budget, Limits per person | the env var, then 150 / 40 |
| Lorekeeper monthly budget per campaign | `LOREKEEPER_CAMPAIGN_MONTHLY_USD` | no control yet (`adminLorekeeper.setLimit` `campaignMonthlyUsd`) | the env var, then 50 |
| Internet searches per day, what happens at the limit, the 80% email, GM limit requests, one campaign's own limits | none | Lorekeeper | 20, Pause, on, off |
| Shared rulebooks | `pnpm lorekeeper:ingest` only | Lorekeeper › Book library (PDF upload, Replace) | the script still works |
| Feature switches: 3D dice, phone layout, Lorekeeper internet search, sprite tokens (Journal and Share links are saved but do nothing yet, N2 a) | none | Feature switches: Off / Only me / Testers / Everyone; testers are picked there | Everyone |
| Read-only mode with a banner | none | Maintenance › Maintenance mode | off |

- The caps apply to the owner too. Lowering a cap never removes anything; it only refuses the next one.
- The campaign-wide bound of 50 characters (`MAX_CHARACTERS_CREATED_PER_CAMPAIGN`) stays in code as an abuse bound
  under the per-player cap (dcm-cd8 closed with that cap).
- Every change is logged in Overview › Recent changes with who made it, together with campaigns created and deleted.
  The log is kept 1 year (Q26 a).
- Lorekeeper details (the at-limit modes, PDF uploads by the owner and by GMs and their limits, limit requests): see
  `docs/lorekeeper.md`.

### Read-only mode (Maintenance)

'Read-only for everyone' takes an optional banner message (up to 200 characters). Every signed-in page and the
sign-in page show the banner. Every write is refused with `READ_ONLY_MODE` and the message, and new accounts are
refused. Exempt (Q31 a): the owner, background jobs (crons, an answer already running), opening a campaign and
presence. Use it around a risky migration, and turn it off from the same switch.

### Keys and backups (Maintenance)

- Keys and connections shows only Set / Missing for the database, `ANTHROPIC_API_KEY`, email (`AUTH_RESEND_KEY` and
  `MAIL_FROM`), `SITE_URL` and Google sign-in. Keys are never shown or changed in the app: change them with
  `npx convex env set`.
- Backups is a link to the Convex dashboard's Backups page (Q29 a). The app shows no backup time; take backups there.

### Export everything (Maintenance › Backups)

Export builds one JSON file in the background, and Download saves it as `dualityheart-export-YYYY-MM-DD.json`. The
download goes through `GET <convex site>/admin/export?id=…` with the owner's sign-in token in a header, checked on
every download. The file is deleted after **1 hour** (Q30 a).

- **Contains** every table of the schema as stored (`_id` and `_creationTime` included): accounts, campaigns,
  members, characters, sessions, Journal pages, maps, Lorekeeper conversations and usage, admin settings and the audit
  log. Uploaded files (portraits, map images) appear by storage id only, without their bytes.
- **Excludes** auth secrets and sessions (`authAccounts` with password hashes, `authSessions`, `authRefreshTokens`,
  `authVerificationCodes`, `authVerifiers`, `authRateLimits`), book text (`lorekeeperChunks`), idempotency records
  (`operations`), the export rows themselves (`adminExports`), the e2e codes table and the rate limiter's state. Each
  campaign's `joinCode` is removed. The file lists its `excludedTables` and `redactedFields`.
- It is not a restore format. For a full backup and restore, use the Convex dashboard or `npx convex export`.

### The owner's read-only view of a campaign (Q27 b, N1 changed)

Overview › Campaigns lists every campaign with 'Open'. Open logs the visit (`campaign.view`, once per campaign per
day) and opens the campaign as its GM sees it, **with everything: players' private notes and private Lorekeeper
conversations included**. A banner says 'Read-only view · You are not in this campaign. Nothing can be changed here.'
There is no gear and no Players button, and the server refuses every write. The owner never shows as a member, as
Online or in 'Last seen'.

### Not built yet

Suspending and deleting accounts from Accounts (Q28 b, AD14 / AU9) waits for its own design (N11). Until then,
remove an account through the Convex dashboard.

### e2e

The e2e backend's owner is the test account `e2e-owner@example.test`, named by the specs that need it
(`tests/e2e/owner.ts`). Every owner spec uses this one account and puts back any app-wide setting it changes.
`pnpm e2e:setup` raises both campaign caps to 1,000,000, on the e2e backend only (`e2e:raiseCampaignCaps`).

### Vercel Production (`vercel env ls`, names only)

| Variable | Needed | Who | Notes |
|---|---|---|---|
| `CONVEX_DEPLOY_KEY` | yes | already set (Production) | Production deploy key. |
| `NEXT_PUBLIC_CONVEX_URL` | automatic | none | Injected by `convex deploy` at build. |
| `CONVEX_SITE_URL` | optional | none | `src/proxy.ts` derives it from `NEXT_PUBLIC_CONVEX_URL`; set only if the log says it cannot. |
| `NEXT_PUBLIC_E2E_AUTH`, `NEXT_DIST_DIR`, `PDFJS_DIR`, `SHARP_DIR`, `CI` | no | none | Test and build tooling; leave unset. |

No secret belongs in Vercel except the deploy key.

## 5. Google OAuth (USER)

In Google Cloud Console, APIs and Services, Credentials, the OAuth client used by the app (or a new "Web application"
client for production):

- Authorized redirect URI: `<PROD_SITE_URL>/api/auth/callback/google` (the Convex `.convex.site` URL of the
  production deployment, for example `https://<name>.convex.site/api/auth/callback/google`). Convex Auth runs the
  OAuth callback on the Convex site, not on dualityheart.com.
- Authorized JavaScript origins: `https://dualityheart.com` and `https://www.dualityheart.com`.
- OAuth consent screen: set the app name, add `dualityheart.com` as an authorized domain, and publish the app
  ("In production") so players outside the test-user list can sign in.
- Give the agent the client id and secret to set as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (step 4), or set them
  yourself with `npx convex env set --prod`.

## 6. Data migrations

The first production deploy already happened (step 7). These commands are still the migration runbook. This file
does not record whether they have been run. All migrations are idempotent and resumable. Dry run
first (one batch, rolled back): add `, dryRun: true`. Run each once:

```bash
npx convex run --prod migrations/run:run '{fn: "migrations/handSharing:moveSwitch"}'
npx convex run --prod migrations/run:run '{fn: "migrations/handSharing:moveHidden"}'
```

These two are required (else hand sharing reads wrong). The remaining migrations in `convex/migrations/` are
no-ops on a database that never held the old shapes, and necessary if production data predates them; running them
is safe either way. Order as listed:

```bash
npx convex run --prod migrations/run:run '{fn: "migrations/trackers:stampSchemaVersion"}'
npx convex run --prod migrations/run:run '{fn: "migrations/characters:versionSheets"}'
npx convex run --prod migrations/run:run '{fn: "migrations/characterExtras:moveFromTrackers"}'
npx convex run --prod migrations/run:run '{fn: "migrations/maps:splitMaps"}'
npx convex run --prod migrations/run:run '{fn: "migrations/mapTrailMode:rewriteTrailMode"}'
npx convex run --prod migrations/run:run '{fn: "migrations/codex:splitText"}'
npx convex run --prod migrations/run:run '{fn: "migrations/codex:countEntries"}'
npx convex run --prod migrations/sessions:backfillSessions '{}'   # a runner series: call it directly
npx convex run --prod migrations/run:run '{fn: "migrations/slotBonuses:applySlotBonuses"}'
npx convex run --prod migrations/run:run '{fn: "migrations/motherboardEconomy:addTetherAndQuantum"}'
```

Status: `npx convex run --prod --component migrations lib:getStatus --watch`. If the migrations folder has gained
files since this was written, run `ls convex/migrations` and add them.

## 7. Merge rebuild into master — Finished

Done 2026-10-26. Tag `v1.0.0` is that merge; `pre-rebuild-master` is the rollback anchor. `master` has commits after
the tag. Do not run this merge again. The commands below are the record of what shipped. Vercel still deploys
`master`.

```bash
git switch rebuild && pnpm lint && pnpm typecheck && pnpm test   # all green first
git fetch origin
git tag pre-rebuild-master master                                   # rollback anchor for old master
git push origin pre-rebuild-master                                  # USER confirms every push
git switch master
git merge --no-ff rebuild -m "Release: rebuild (dualityheart.com launch)"
git tag -a v1.0.0 -m "dualityheart.com launch"
git push origin master v1.0.0                                       # triggers the Vercel production build
```

The launch push already happened. That build ran `convex deploy` and pushed the functions and schema to the
production Convex deployment. Step 6 remains the migration runbook; this file does not record whether those
commands have been run.

## 8. Books for the Lorekeeper (agent; text files stay outside the repo)

Per `docs/lorekeeper.md` (renumbered text files in `~/books/`, or re-extract with `pdftotext`):

```bash
pnpm lorekeeper:ingest core ~/books/core.txt --dry-run              # check chunk and page counts first
pnpm lorekeeper:ingest core ~/books/core.txt --prod
pnpm lorekeeper:ingest hopeFear ~/books/hopefear.txt --prod
pnpm lorekeeper:ingest frame:witherwild ~/books/core.txt --prod     # core pp. 254-261
pnpm lorekeeper:ingest houseRules --prod                            # the switch only
```

Requires `ANTHROPIC_API_KEY` on the production deployment. The 2026-10-26 runbook recorded it as set; this file
does not re-check env. Set an Anthropic console spend limit as the last line of defence.

## 9. Smoke test (https://dualityheart.com, a private window)

Not recorded as run. The site being live does not check these boxes.

- [ ] `https://dualityheart.com` and `https://www.dualityheart.com` load over HTTPS with a valid certificate.
- [ ] Sign up with a new email and password: a 6-digit code arrives from the dualityheart.com sender, entering it
      signs in. A wrong code shows a clear error.
- [ ] Sign out, sign in with Google: lands back on dualityheart.com signed in.
- [ ] Forgot password sends a code and resets.
- [ ] Create a campaign, copy the join link, join from a second browser as a player.
- [ ] Player sees the player view; GM sees GM controls; a third account cannot open the campaign URL.
- [ ] Create a character through the wizard; the sheet saves and reloads.
- [ ] Combat map: place a token, play a card; the second browser sees it live.
- [ ] Hand sharing switch and "hide my hand" behave (migration check).
- [ ] Lorekeeper: ask a rules question; the answer quotes a page of the Core Rulebook.
- [ ] Upload a portrait (png) succeeds; a non-image is rejected.
- [ ] The owner (step 4a) opens App admin and every tab loads; a second, non-owner account sees 'Not allowed' at
      `/admin`.
- [ ] Vercel runtime logs and Convex production logs show no errors during the above.

## 10. Rollback

- **Site only** (new build is broken, schema unchanged): Vercel dashboard, Deployments, previous Ready production
  deployment, "Promote to Production" (or `vercel rollback`). Convex functions stay on the new version, so this
  is safe only when the old frontend still matches them; otherwise use the full rollback.
- **Full rollback to old master**: `git switch master && git revert -m 1 <merge commit>` (or reset master to the
  `pre-rebuild-master` tag and force-push, only with the user's explicit approval), push; Vercel rebuilds and
  `convex deploy` restores the old functions. Data migrations are one way for new-shape rows: restore from a Convex
  backup if needed. Before a full rollback, take one: Convex dashboard, production, Settings, Backups,
  "Backup now" (**USER**), and note the time. This file does not record whether a backup was taken before launch.
- **Sign-in broken** (auth env wrong): fix `SITE_URL`, `AUTH_GOOGLE_*`, `AUTH_RESEND_KEY`, `MAIL_FROM` with
  `npx convex env set --prod`; no redeploy needed. Never regenerate `JWT_PRIVATE_KEY`/`JWKS` as a fix, it signs
  everyone out.
- **Lorekeeper cost runaway**: in App admin › Lorekeeper, lower the monthly spend limit (with 'Pause the
  Lorekeeper') or Questions per day. A value saved there wins over the env vars, so
  `npx convex env set --prod LOREKEEPER_DAILY_QUESTIONS 0` only helps while the owner has never saved that number.
  Feature switches › Lorekeeper internet search › Off stops the internet pass for everyone.
- **Risky change in progress**: App admin › Maintenance › 'Read-only for everyone' stops every write except the
  owner's.
- **Domain trouble**: remove the A and CNAME records at GoDaddy, or `vercel domains rm`; the `*.vercel.app` URL keeps working.
