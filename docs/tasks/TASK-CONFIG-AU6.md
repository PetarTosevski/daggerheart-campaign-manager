# TASK-CONFIG-AU6: App admin link in Preferences (owner only)

Plan `.omc/plans/config.yaml` (Part B), bead dcm-jh6d.50, design `reference/designs/config/Settings.dc.html` (`.pm-adm`).

## What changed

- `src/components/config/prefs/admin-link.tsx`: `AppAdminLink` (S1's App admin slot in the Preferences popover, after
  the rows) reads `appAdmin.me` and, only for `{ isOwner: true }`, renders a link to `/admin`: a lock, 'App admin',
  'Limits, costs and feature switches · only you' and an arrow. It is an arcane glass link (`brandButton`, neutral,
  full width). While the query loads, when signed out (`null`) and for `{ isOwner: false }` it renders nothing, so the
  row never flashes for anyone. The check is UX only (CF22): AD0's `appOwner*` wrappers are the gate.
- `tests/unit/config/admin-link.test.tsx`: the owner sees the link to /admin; a non-owner (GM or player), loading and
  signed out see nothing.

## Decisions

- The link is in Preferences only, as the spec says; it is not in the Campaign settings gear.
- The design draws `.pm-adm` as a gold card; the link uses the neutral glass style (the slot rules ask for glass
  buttons, and AU6 owns no CSS file). Layout follows the design: icon, two text lines, arrow.
- The popover body renders only while open, so `appAdmin.me` runs only then.
