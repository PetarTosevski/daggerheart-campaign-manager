# TASK-LN-N3: Campaign settings, dashboard and sign-up leftovers

Status: Review. Plan: `.omc/plans/lanes.yaml`, tracer N3. Beads: `dcm-hlj`, `dcm-bxp.140`, `dcm-bxp.40` item 10.

## dcm-hlj: GM Fear tokens reach 44 px on touch screens

- Each token is now centred on its spiral point (`left`/`top` = the point, `.fz { translate: -50% -50% }`), so a size
  floor grows a token around its point instead of shifting it off the line.
- `dashboard.css`: under `(pointer: coarse), (max-width: 1279px)` the spiral grows from 330 px to 440 px wide where
  the column allows it (768x1024: single column) and every token has a 44 px floor (1024x768: the 340 px sidebar).
  Desktop at 1280 px and wider keeps the board's 330 px spiral.
- Verified: `tests/e2e/a11y-entry.spec.ts` dashboards at 768x1024 and 1024x768 pass with the Fear assertion raised
  to the default 44 px (temporary local edit, not committed: the spec is outside N3's owns).

## dcm-bxp.140: open sign-up leftovers

- `players-dialog.tsx`: the invite hint now says the player gets an email with a sign-in link and the campaign
  appears once they sign in or sign up with that address (Google or a verified password account).
- `convex/convex.config.ts`: dropped `ALLOWED_EMAILS` and `GM_EMAILS`; declared `SITE_URL`; comment updated.
- `scripts/e2e-setup.mjs`: comment no longer names the removed fixed password accounts.
- `docs/deploy.md`: `AUTH_RESEND_KEY` and `MAIL_FROM` rows, `SITE_URL` notes the invite link, the allowlist section
  says to remove `GM_EMAILS` from prod (no launch blocker any more), rollback names the new vars.

## Left for the orchestrator (outside N3's owns)

- `tests/e2e/a11y-entry.spec.ts` l.228-230: replace the dcm-hlj comment and assert the default 44 px:
  `await expectTouchTargets(page.getByRole("button", { name: /^Fear \d+ of \d+$/ }));`
- `convex/lib/inviteEmail.ts` l.69: the comment "`SITE_URL` is a Convex env var not (yet) declared" is now stale.
- `tests/convex/authz/core.entries.ts` l.124: the `auth:signIn` exemption can also cite `tests/e2e/signup.spec.ts`.
- `tests/e2e/lorekeeper-shell.spec.ts` l.16, `tests/e2e/notes-shell.spec.ts` l.13: "An allowlisted account" ->
  "A test sign-in account".
- Flaky under load (not touched): `auth-signup.test.ts` global sign-up bucket, `schema-guard` inventory timeout.
- `dcm-bxp.40` item 10 (paper look for the session, rest launcher, roll feed, party card and import pieces): those
  classes live in `src/components/party/**` and `party-section.tsx`, none in `dashboard.css`; not done here.
- `convex/_generated` needs regenerating after merge (env type: `SITE_URL` in, `ALLOWED_EMAILS`/`GM_EMAILS` out).
