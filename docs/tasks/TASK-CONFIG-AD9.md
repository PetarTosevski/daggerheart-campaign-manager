# TASK-CONFIG-AD9: Feature switches server

Plan `.omc/plans/config.yaml`, tracer AD9 (bead dcm-jh6d.43), Part B. Server only: the feature catalogue, the owner's
switches, the caller's features and the one server check. The admin tab is AU4; the switches take effect in AF1.

## Features (Q25 b, N2 a; `src/lib/admin/features.ts`)

`FEATURES` lists every Feature switches row of the Admin board except the dropped "New combat HUD", in board order,
with the board's names and descriptions:

| Key | Name | Inert (N2 a) |
|---|---|---|
| `journal` | Journal | yes: "Always on for now: the old Sessions and Notes pages are gone." |
| `dice3d` | 3D dice | |
| `phoneLayout` | Phone layout | |
| `lorekeeperWeb` | Lorekeeper internet search | |
| `spriteTokens` | Sprite tokens | |
| `shareLinks` | Share links | yes: "Not built yet." |

An inert feature's switch is saved, audited and listed like the others, but the feature is always on for everyone
(`featureOn` and `features.mine` answer `true` whatever the mode). When N2 changes, drop `inert` for that row.

## Modes

`off` (nobody, the owner included), `owner` (Only me: the app owner), `testers` (the `appTesters` list and the owner),
`everyone` (signed out included). **A feature with no `featureSwitches` row is `everyone`**, so everything that ships
today stays on when switches land. Switching a feature off never deletes data. Testers are added and removed by AD3
(`adminAccounts.addTester` / `removeTester`); this tracer only reads `appTesters`.

## API (`convex/features.ts`)

| Function | Wrapper | Args | Returns |
|---|---|---|---|
| `features.mine` | `maybeUserQuery` | `{}` | `{ journal, dice3d, phoneLayout, lorekeeperWeb, spriteTokens, shareLinks }` booleans for the caller alone |
| `features.list` | `appOwnerQuery` | `{}` | `[{ key, mode, changedAt: number \| null }]` in board order (`null` = never saved) |
| `features.setMode` | `appOwnerMutation` | `{ key, mode }` | `null`; writes the row (`changedAt`, `changedBy`) and one `feature.set` audit row (`field` = key, `from`, `to`); the current mode is a no-op, not audited |

`mine` never returns a mode, the tester list, the owner or any other user. Signed out it answers with the Everyone
features (not null), so the unauthenticated sweep lists it in `EXEMPT` (the authz matrix covers it: `anon: ok`).

## Server check (`convex/lib/features.ts`)

- `featureOn(ctx, user, key)` is the **only** server check (AF1 uses it, for example to skip the Lorekeeper's web pass).
  One indexed read of the switch; the owner check (`isAppOwner`) and the tester read happen only for `owner` /
  `testers` modes.
- `requireFeature(ctx, user, key)` throws `FEATURE_OFF` when `featureOn` is false.
- `featuresFor(ctx, user)` builds `mine` (one read per feature, owner / tester reads at most once each).

## Tests

- `tests/convex/features.test.ts`: catalogue; defaults; every mode for owner / tester / other / signed out; `mine`
  leaks nothing; inert rows; tester and owner changes; list order; audit; no-op; server-side refusals; validators;
  `featureOn` / `requireFeature`.
- `tests/convex/authz/admin-features.entries.ts`: `mine` (maybe, anon ok), `list` and `setMode` (appOwner).

## Edits outside `owns`

- `tests/convex/unauthenticated-sweep.test.ts`: `features:mine` added to `EXEMPT` (a deliberate signed-out answer).
