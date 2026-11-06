# TASK-CONFIG-AD7: Email the owner at 80% of the monthly Lorekeeper limit

Plan `.omc/plans/config.yaml`, tracer AD7 (bead dcm-jh6d.46), Part B, Q32 (a): the 80% email goes to the owner's
verified email, once per month. Server only.

## Detection (`convex/lib/lorekeeper/caps.ts`)

`spendAlert(ctx, month, spentMicros, limitMicros, now)` runs inside the booking mutation:

- `reserve` and `reservePass` pass the deployment's spend **before** their own worst case; `settle` passes the spend
  **after** the real cost is booked. So one question's worst case never triggers the email alone; the real cost does.
- It acts when the limit is positive, the spend is at least `SPEND_ALERT_SHARE` (0.8) of it, `month` is the current UTC
  month (the stale-run sweep settling last month's answer never sends), an owner is set and
  `appConfig.spendAlertMonth` is not already `month`. Then it patches `spendAlertMonth` and schedules
  `spendAlert:send` with `{ month }` (by `makeFunctionReference`, no regenerated api needed).
- A second crossing in the month sends nothing; two concurrent crossings conflict on `appConfig` and the retry sees
  the mark. A new month sends again.

## Sending (`convex/spendAlert.ts`)

| Function | Kind | What |
|---|---|---|
| `emailData` | `internalQuery` `{ month }` | `{ to, month, spentMicros, limitMicros, atLimit }`, or null when the month is not the marked one, no owner is set or the owner's email is not verified |
| `send` | `internalAction` `{ month }` | Resend (`AUTH_RESEND_KEY`, `MAIL_FROM`, link to `SITE_URL/admin`), as `lorekeeperLimitRequests.notifyOwner`; returns at once on the e2e backend (`isE2EDeployment` or `fakeCodeMode`); failures logged without key or address, not retried |

`spendAlertEmail` (pure) builds the subject ("Lorekeeper at N% of its monthly limit"), the spend against the limit for
the month, and what happens at the limit (`atLimit`). No key, id or address other than the recipient.

## Decisions taken (recommended defaults)

- **The "Email me at 80%" switch is not stored yet.** `LorekeeperSettings` / `lorekeeperSettingsValidator` have no
  such field and AD7 does not own them, so the email is always on (Q32 a). Adding the switch is a follow-up for the
  owner of `src/lib/admin/config.ts`, `convex/lib/validators/admin.ts` and `adminLorekeeper.setLimit`: read it in
  `spendAlert` before marking the month.
- One threshold (80%); `spendAlertMonth` is the "sent this month" mark.
- The month is marked even if the send then fails (no retry, no second email); the Overview's spend alert (AD2) still
  shows it.
- Booked spend (settled costs plus other answers' in-flight worst cases) is what is compared, the same number the
  caps use.
- The owner's own questions count toward the spend like everyone's.

## Tests

`tests/convex/spend-alert.test.ts`: under 80% nothing; reserve, reservePass and settle detect the crossing and mark the
month; a second crossing sends nothing; a past month's settle never sends; a new month sends again; no owner or a
limit of 0 sends nothing; `send` goes to the owner's verified address with no key, nothing on the e2e backend, for an
unmarked month or an unverified owner; a Resend failure is logged without key or address; the email text.
