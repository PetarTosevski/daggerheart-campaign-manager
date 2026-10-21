# TASK-D12-H14: Authz matrix - frame trackers (Age of Umbra, Andaluria, Colossus, Five Banners, Horizon, Weredragon)

Plan `.omc/plans/d12-hardening.yaml`, tracer H14 (depends on H0). Harness API: `docs/tasks/TASK-D12-H0.md`.

## What landed

| File | Change |
|---|---|
| `tests/convex/authz/trackers.entries.ts` | 39 entries (ageOfUmbra 9, andaluria 7, colossus 5, fiveBanners 7, horizon 5, weredragon 6); `pending` is empty. |
| `tests/convex/authz/trackers.test.ts` | `runMatrix(area)` plus a wrong-frame test: the GM of a Witherwild campaign gets MECHANIC_DISABLED from each tracker (Five Banners' `state` reads null). |

## Access classes (read from the code)

| Functions | Wrapper | Class | Rows |
|---|---|---|---|
| `get` of ageOfUmbra, andaluria, colossus, horizon, weredragon; `fiveBanners:state` | campaignQuery `need: "view"`, `enough: "owner"` | `view` | class defaults plus otherPlayer ok and grantee ok (the player's view) |
| `weredragon:readNightSky`, `weredragon:submitSecret` | keyedCampaignMutation `need: "view"` | `view` | the same: every member may roll the night sky (HF p.140) and submit a secret |
| the 30 GM changes (pyres, branches, Lurking Darkness, hunts, clues, colossus track, relationships, sheets, reveals, objectives, week, Doom Track, Echoes, readings, revelations, secrets used) | keyedGmMutation (owner) | `gm` | class defaults plus grantee FORBIDDEN (the campaign edit grant is below owner) |
| `fiveBanners:operateObjective` | keyedUserMutation; owner on the countdown's campaign through `campaignAccess` | `scoped` | anon UNAUTHENTICATED, outsider NOT_FOUND, otherPlayer/player/grantee FORBIDDEN, gm ok |

Every entry runs on a world of its own frame (`age-of-umbra`, `dark-heart-of-andaluria`, `colossus-of-the-drylands`,
`five-banners-burning`, `journey-to-horizon`, `reign-of-the-weredragon`). Entry setups create what the GM's call needs
so every GM row resolves (no `okCodes`): a pyre (lit, or dark plus a Blessed Branch for `igniteBranch`), a hunt and a
clue, a Polaris major objective (also the `countdowns` row synthesis uses), a marked Doom Track box `1a`, a pending
night-sky roll, playerA's secret.

## Known bugs

None found: every row matched the expected access on the first run.

## Checks

- `pnpm vitest run tests/convex/authz/trackers.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`:
  214 passed (trackers 205 = 204 matrix rows + 1 wrong-frame test; guard 9).
- Area runtime: `trackers.test.ts` alone 18.4 s of tests (26 s wall with module loading) under parallel load.
- `pnpm typecheck` clean; `pnpm exec eslint` on both files clean.
