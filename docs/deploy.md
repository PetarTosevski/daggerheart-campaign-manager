# Production launch runbook: dualityheart.com

Status when written (2026-10-26): everything below is prepared, nothing is live. Tracked in dcm-bxp.133 (go live),
dcm-bxp.128 (open sign-up) and dcm-bxp.136 (Resend sender domain). Steps marked **USER** need the account owner;
the rest an agent can run once the user confirms each step.

Hosting: Vercel project `petartosevski/daggerheart-campaign-manager` (linked in `.vercel/`), Convex production
deployment (already exists; its deploy key is already in Vercel as `CONVEX_DEPLOY_KEY`, Production only).
Vercel builds from `master` (`vercel.json`: `npx convex deploy --cmd 'pnpm build'`; the `ignoreCommand` skips every
non-production build, so branches and PRs do not deploy).

## 0. State already prepared

- `dualityheart.com` and `www.dualityheart.com` are added to the Vercel project (verified in the project, DNS not yet
  pointing at Vercel, so the domains show "not configured" until step 1).
- The Convex production deployment exists and has only `ANTHROPIC_API_KEY` set (`npx convex env list --prod`).
- Vercel Production env has only `CONVEX_DEPLOY_KEY`. `NEXT_PUBLIC_CONVEX_URL` is injected by `convex deploy`
  during the build, so it is not set by hand.

## 1. GoDaddy DNS (USER)

The domain stays at GoDaddy's nameservers (`ns19/ns20.domaincontrol.com`); add these records in GoDaddy
DNS Management. Delete any existing `A` record on `@` (the GoDaddy "parked" one) and any `CNAME` on `www` first.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `216.198.79.1` | 600 |
| A | `@` | `64.29.17.1` | 600 |
| CNAME | `www` | `e5ef9f0bca898c3d.vercel-dns-017.com.` | 600 |

(`cname.vercel-dns.com` also works for `www`; the values above are what Vercel reports for this project.)
Re-read them any time: `vercel domains verify dualityheart.com` and `vercel domains verify www.dualityheart.com`.
Do not touch GoDaddy's MX or TXT records; Resend's records (step 2) are added next to them.

Optional: in Vercel, Project Settings, Domains, set `www.dualityheart.com` to redirect to `dualityheart.com`.

Warning: once these records resolve, `dualityheart.com` serves the project's current production deployment. Do this
step at launch (after step 7), not earlier, unless the old master site may be shown.

Check: `vercel domains inspect dualityheart.com` shows no warning; `curl -I https://dualityheart.com` returns 200
once a deployment is live (certificates issue automatically within minutes).

## 2. Resend sender domain (USER first, then an agent)

1. **USER**: accept the Resend terms in the browser: https://vercel.com/petartosevski/~/integrations/accept-terms/resend?source=cli
2. Agent: install the integration (`vercel integration add resend`, load the `vercel:marketplace` skill first).
3. In the Resend dashboard, add the domain `dualityheart.com` (or a subdomain such as `send.dualityheart.com`,
   which keeps the apex mail records clean). Resend then shows the exact DKIM (TXT), SPF (TXT) and return-path (MX)
   records for that domain. **These come from the Resend dashboard after install; copy them from there.**
4. **USER**: add those records at GoDaddy, then press Verify in Resend. Verification can take up to a day.
5. Create a Resend API key restricted to sending. Store it only in the Convex production env (step 4), never in Vercel
   or git. The sender address will be on the verified domain, for example `Duality Heart <noreply@dualityheart.com>`.

Note: the sign-up code email itself (Convex Auth `Password` provider with `verify` and a Resend provider) is bead
dcm-bxp.128 and is not built yet. Its exact env var name is fixed when it lands; update step 4 then.

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
| `ANTHROPIC_API_KEY` | yes | already set | Lorekeeper, map generation, photo import. |
| `SITE_URL` | yes | agent | `https://dualityheart.com`. Convex Auth redirects here after OAuth. Dev has its own value; do not copy it. |
| `JWT_PRIVATE_KEY` | yes | agent generates | RS256 private key (PKCS8). Generate fresh for production, see below. |
| `JWKS` | yes | agent generates | Matching public JWKS. |
| `AUTH_GOOGLE_ID` | yes | **USER** | Google OAuth client id (see step 5). |
| `AUTH_GOOGLE_SECRET` | yes | **USER** | Google OAuth client secret. |
| Resend key | yes | **USER** | Name decided in dcm-bxp.128 (Convex Auth convention is `AUTH_RESEND_KEY`). Only in Convex env. |
| `CONVEX_SITE_URL` | automatic | none | Provided by Convex itself to `convex/auth.config.ts`. Do not set. |
| `LOREKEEPER_MODEL`, `LOREKEEPER_DAILY_QUESTIONS`, `LOREKEEPER_CAMPAIGN_MONTHLY_USD`, `LOREKEEPER_MONTHLY_USD`, `ANTHROPIC_MODEL` | optional | user | Defaults are fine; see `docs/lorekeeper.md`. |

Generate the key pair (run locally, pipe straight into Convex, never print or save it):

```bash
node --input-type=module -e '
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const pk = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
process.stdout.write(JSON.stringify({ pk, jwks }));
' > "$SCRATCH/keys.json"   # SCRATCH = a temp dir outside the repo; delete the file afterwards
npx convex env set --prod JWT_PRIVATE_KEY -- "$(node -p 'require(process.argv[1]).pk' "$SCRATCH/keys.json")"
npx convex env set --prod JWKS -- "$(node -p 'require(process.argv[1]).jwks' "$SCRATCH/keys.json")"
rm "$SCRATCH/keys.json"
```

(`jose` is available through `@convex-dev/auth`; `npx @convex-dev/auth` can also do this interactively.)
Setting `JWT_PRIVATE_KEY` and `JWKS` before the first production sign-in matters: changing them later signs everyone out.

### Convex production: must NOT be set

- `ALLOWED_EMAILS`, `GM_EMAILS`: the invite allowlist. Open sign-up (dcm-bxp.128) deletes it from the code; until
  that lands, an unset list means nobody can sign up. **Blocker: do not launch before dcm-bxp.128 is merged.**
- `SEED_ACCOUNTS`, `ALLOW_SEED_ACCOUNTS`, `E2E_AUTH_ENABLED`, `E2E_AUTH_SECRET`, `LOREKEEPER_FAKE_MODEL`:
  test rails, off in production.

Check: `npx convex env list --prod | sed -E 's/=.*//'` lists names only.

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

## 6. Data migrations (run after the first production deploy, step 7)

The production deployment may hold data from old master. All migrations are idempotent and resumable. Dry run
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
npx convex run --prod migrations/run:run '{fn: "migrations/sessions:backfillSessions"}'
npx convex run --prod migrations/run:run '{fn: "migrations/slotBonuses:applySlotBonuses"}'
npx convex run --prod migrations/run:run '{fn: "migrations/motherboardEconomy:addTetherAndQuantum"}'
```

Status: `npx convex run --prod --component migrations lib:getStatus --watch`. If the migrations folder has gained
files since this was written, run `ls convex/migrations` and add them.

## 7. Merge rebuild into master (agent, user confirms each command)

Vercel keeps deploying `master`, so the merge is the deploy. Run from a clean checkout.

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

Do steps 1 to 5 before this push. The build runs `convex deploy`, which pushes the new functions and schema to
the production Convex deployment: that is the moment production data is read by the new code, so run the step 6
migrations right after the deployment turns Ready (`vercel ls`, or the Vercel dashboard). If production holds old
data, run the two hand-sharing migrations before opening the site to players.

## 8. Books for the Lorekeeper (agent; text files stay outside the repo)

Per `docs/lorekeeper.md` (renumbered text files in `~/books/`, or re-extract with `pdftotext`):

```bash
pnpm lorekeeper:ingest core ~/books/core.txt --dry-run              # check chunk and page counts first
pnpm lorekeeper:ingest core ~/books/core.txt --prod
pnpm lorekeeper:ingest hopeFear ~/books/hopefear.txt --prod
pnpm lorekeeper:ingest frame:witherwild ~/books/core.txt --prod     # core pp. 254-261
pnpm lorekeeper:ingest houseRules --prod                            # the switch only
```

Requires `ANTHROPIC_API_KEY` on the production deployment (already set). Set an Anthropic console spend limit as
the last line of defence.

## 9. Smoke test (https://dualityheart.com, a private window)

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
- [ ] Vercel runtime logs and Convex production logs show no errors during the above.

## 10. Rollback

- **Site only** (new build is broken, schema unchanged): Vercel dashboard, Deployments, previous Ready production
  deployment, "Promote to Production" (or `vercel rollback`). Convex functions stay on the new version, so this
  is safe only when the old frontend still matches them; otherwise use the full rollback.
- **Full rollback to old master**: `git switch master && git revert -m 1 <merge commit>` (or reset master to the
  `pre-rebuild-master` tag and force-push, only with the user's explicit approval), push; Vercel rebuilds and
  `convex deploy` restores the old functions. Data migrations are one way for new-shape rows: restore from a Convex
  backup if needed. Take one before step 7: Convex dashboard, production, Settings, Backups, "Backup now"
  (**USER**), and note the time.
- **Sign-in broken** (auth env wrong): fix `SITE_URL`, `AUTH_GOOGLE_*`, the Resend key with
  `npx convex env set --prod`; no redeploy needed. Never regenerate `JWT_PRIVATE_KEY`/`JWKS` as a fix, it signs
  everyone out.
- **Lorekeeper cost runaway**: `npx convex env set --prod LOREKEEPER_DAILY_QUESTIONS 0` or lower the monthly caps.
- **Domain trouble**: remove the A and CNAME records at GoDaddy, or `vercel domains rm`; the `*.vercel.app` URL keeps working.
