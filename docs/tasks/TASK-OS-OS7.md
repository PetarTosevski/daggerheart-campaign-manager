# TASK-OS-OS7: Email invites send an email

Status: Review. Plan: `.omc/plans/open-signup.yaml`, tracer OS7. Bead: `dcm-bxp.128`.

- `members.invite` stores the invite first, then (new invites only) `scheduleInviteEmail` (`convex/lib/inviteEmail.ts`) consumes the limits and schedules the internal action `lib/inviteEmail:send`.
- The email names the GM and campaign and links to `${SITE_URL}/signin`; sent through Resend like OS1 (`AUTH_RESEND_KEY`, `MAIL_FROM`). Needs `SITE_URL` in the Convex env.
- Limits: 20 per hour per campaign, 3 per day per recipient. Past a limit, on the e2e backend (`fakeCodeMode`), or for an address with an unverified account, the invite is kept and no email is sent.
- A failed send is logged without key or address and never rolls back the invite. No public function changed, so the authz matrix is unchanged.
- Follow-up: `SITE_URL` is read off the loosely typed env because `convex/convex.config.ts` does not declare it yet; add `SITE_URL: v.optional(v.string())` there.
