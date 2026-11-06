# TASK-CONFIG-AD12: Lorekeeper limit requests

Plan `.omc/plans/config.yaml`, tracer AD12 (bead dcm-jh6d.52), Part B. Server only (AU3 builds the Lorekeeper tab and
the GM's settings view). Q21 changed and N10 b: a GM or co-GM asks the app owner for higher Lorekeeper limits for
their campaign; the owner approves with the numbers they choose or declines, or sets a campaign's numbers directly;
the owner is also emailed for every request. No GM self-service.

## Data

AD0's tables: `lorekeeperLimitRequests` (one `pending` per campaign, `by_campaign_status`, `by_status_createdAt`;
decided rows expire after 365 days in `adminRetention`) and `lorekeeperCampaignLimits` (one row per campaign; a missing
field = the app default). AD6's `capLimits` reads `dailyQuestions` / `dailyWebSearches` from the row on the next
question. `bookCount` / `bookPages` are stored for LB1 / AU8 (book room); nothing enforces them yet.

## API (`convex/lorekeeperLimitRequests.ts`)

| Function | Wrapper (authz class) | Args | Notes |
|---|---|---|---|
| `request` | `gmMutation` (`gm`) | `campaignId`, `wants: { dailyQuestions?, dailyWebSearches?, bookCount?, bookPages? }` (whole, 0..1000, at least one), `reason` (trimmed, 1..300) | LIMIT_REQUESTS_OFF while `allowGmRequests` is off (default); LIMIT_REQUEST_PENDING while one is pending; RATE_LIMITED past 5 per GM per day; schedules `notifyOwner` |
| `cancel` | `gmMutation` (`gm`) | `campaignId`, `requestId` | deletes the campaign's pending request (GM or co-GM); NOT_FOUND otherwise |
| `forCampaign` | `gmQuery` (`gm`) | `campaignId` | `{ requestsOpen, current, pending, lastDecision }`; `current` = effective daily numbers, book numbers or null, `custom`; never the owner's identity |
| `list` | `appOwnerQuery` (`appOwner`) | `status`, `paginationOpts` (≤ 50) | one status per call: `pending` oldest first, decided newest first; campaign name, requester name (never an email), the campaign's `current` |
| `decide` | `appOwnerMutation` (`appOwner`) | `requestId`, `approve`, `numbers?` (whole, 0..10,000) | approve writes the owner's numbers (else the asked ones) into `lorekeeperCampaignLimits`, other fields kept; audited `limits.request.approve` per number (`from` the stored value or `"default"`), `limits.request.decline` once; NOT_FOUND missing, INVALID already decided |
| `setCampaignLimits` | `appOwnerMutation` (`appOwner`) | `campaignId`, `change: { field, value: number \| null }` | single field; `null` clears to the default; audited `limits.campaign.set` |

## Email (N10 b)

`request` schedules the internal action `notifyOwner` (not on the e2e backend, `fakeCodeMode`). It reads
`ownerEmailData` (internal query): the owner's address from their user row (`appConfig.ownerId`, verified email only),
the GM's name, the campaign's name, the asked numbers and the reason; null when the request is gone or decided. It
sends through Resend (`AUTH_RESEND_KEY`, `MAIL_FROM`, the link `SITE_URL/admin`) like the invite email. The reason is
GM-written: HTML-escaped in the HTML part; the subject is one line. A failure is logged without key or address and
never touches the request. The owner's address never reaches a client.

## Decisions taken (recommended defaults)

- Cancel: any GM or co-GM of the campaign may withdraw the pending request (they share `owner`), not only the asker.
- Rate limit: 5 requests per GM per UTC-day window (own `RateLimiter` in this module, so `lib/functions.ts` is
  untouched); the one-pending rule already bounds open requests and emails.
- `list` takes one status per call instead of a mixed pending-first stream; the page asks for `pending` first.
- The owner's numbers may go up to 10,000 (AD6's bound for daily counts); a GM may ask up to 1,000.
- Approving with fewer numbers than asked writes only those; declining changes no numbers.
- A request on an archived campaign is refused (the wrappers' archived guard); the owner can still decide old ones.

## Tests

`tests/convex/limit-requests.test.ts` (switch, one pending, validation, cancel, rate limit, scheduled email, the email's
address, escaping and no key, approve with owner numbers picked up by `capLimits` and `reserve`, decline, decide once,
direct set and clear with audit, list order and names) and the matrix area
`tests/convex/authz/admin-limit-requests.entries.ts`.
