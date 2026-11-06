# TASK-CONFIG-AU1: App admin Overview tab

Plan `.omc/plans/config.yaml`, tracer AU1 (bead dcm-jh6d.55), Part B. Design `reference/designs/config/Admin.dc.html`
(`.s-ov`). Server: AD2 `convex/adminOverview.ts`, AD13 `appAdmin.openCampaign`. Answers: Q27 (b), N1 (changed: the
owner's view shows everything), N10 (limit requests alert).

## What changed

- `src/components/admin/overview/index.tsx`: `OverviewTab` (slot contract `../slots.ts`). Four parts, each in its own
  `SlotBoundary` (rule 11):
  - Tiles: `adminOverview.stats({ month })`: 'Accounts N · 1 owner · n GM · n players', 'Campaigns N of M allowed',
    'Lorekeeper questions N this month', 'Lorekeeper spend $x of $y this month'. Bounded counts show "1000+".
  - Alerts: `adminOverview.alerts({ day, month })`. The server sends `{ code, params }`; `text.ts` writes the words
    ('Mira is at 27 of 30 Lorekeeper questions today'). Each alert has a button to the tab that fixes it via `onTab`:
    limit requests → Lorekeeper ('Review requests'), spend and daily caps → Lorekeeper, read-only and missing keys →
    Maintenance. No alerts: nothing renders.
  - Campaigns: `adminOverview.campaigns`, paginated. Each row shows the name, 'GM <name> · N players', the state
    ('Live now', 'Last played 29 Oct', 'Archived · …', 'Not played yet') and 'Open' on every campaign (Q27 b). Open
    calls `appAdmin.openCampaign` (the audited visit) and only after it succeeds goes to `/campaigns/<id>`. If the
    call fails, the card shows the error and does not navigate. The button reads 'Opening …' while the call runs.
  - Recent changes: `adminOverview.audit`, paginated ('Show older changes'), with the hint 'Every change on this page
    is logged with who made it.' Each line shows the local time ('2 Nov · 23:40'), who made the change and what changed.
- `src/components/admin/overview/text.ts`: the board's words and pure helpers (tiles, alert text, campaign line and
  state, log time, actor and sentence for every `ADMIN_AUDIT_ACTIONS` entry).
- `src/components/admin/overview/overview.css`: `.admo-*` (tiles, alerts, campaign rows, log), built on `admin.css`.

## Decisions (recommended defaults)

- **Open always logs.** The client cannot tell whether the owner is a member of a campaign: `campaigns` has no
  membership field and `appAdmin.me` gives no id. So Open calls `openCampaign` for every campaign, including the
  owner's own. That costs at most one extra audit row per campaign per day. The log line reads neutrally: 'opened a
  campaign from App admin'.
- **"You" in Recent changes.** Every action except `campaign.create` / `.delete` / `.restore` comes from an
  owner-only mutation, so its actor is shown as 'You' (as the board draws it). Campaign events show the actor's name,
  or 'Unnamed account' when there is none. If the owner changes, older rows still say 'You'.
- **No campaign or account names in log lines.** An audit row carries only a target id, and AD2 does not resolve it,
  so lines say 'created a campaign' or 'added a tester'. A later server change could add `targetName`.
- **Board 'Session 6 · live now'.** AD2 sends no session number, so the state reads 'Live now'.
- **Board alert 'Age of Umbra · resets at midnight'.** The alert has no campaign, so the detail reads 'Resets at
  midnight (UTC)'.
- **Periods.** The UTC day and month are fixed when the tab mounts. A tab left open past midnight UTC keeps the old
  day until it is reopened.
- Buttons are glass (`BrandButton` neutral sm).

## Tests

`tests/unit/admin/overview.test.tsx`: the tiles' text, bounded counts and the loading state; alert text for every
code, the limit-request alert → `onTab("lorekeeper")`, read-only → Maintenance; the campaigns rows; Open → the
`openCampaign` call, then `router.push`; a failed call shows an alert and does not navigate; paging and empty states;
a sentence for every audit action; a failing card's own boundary. `tests/unit/admin/shell.test.tsx`: OverviewTab
removed from the stub list.
