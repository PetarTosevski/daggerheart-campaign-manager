# TASK-CONFIG-AD5a: Campaign caps enforced

Plan `.omc/plans/config.yaml`, tracer AD5a (bead dcm-jh6d.39), Part B. Server only. Caps come from `readAppConfig`
(AD0; defaults Q19 a: 10 per GM, 100 in the app), set by the owner with `adminAccounts.setCap` (AD3).

## Rule

`assertCampaignCaps(ctx, ownerId)` in `convex/campaigns.ts` refuses one more live, non-archived campaign:

- the GM's own count `>= campaignsPerGm` -> `CAP_CAMPAIGNS_PER_GM`;
- the app's count `>= campaignsApp` -> `CAP_CAMPAIGNS_APP`.

Archived and deleted campaigns don't count (Q9 a). The app owner is capped too (Q19 a). A lowered cap never removes
anything; it only refuses the next campaign. Codes live in `src/lib/errors/admin.ts`.

## Where it runs

| Function | When |
|---|---|
| `campaigns.create` | inside `ctx.once`, after the name check (a replayed key returns the stored result, never a cap error) |
| `campaigns.restore` | only when the campaign is not archived (a deleted archived campaign comes back archived, so it still doesn't count) |
| `campaignSettings.unarchive` | always, for the campaign's creator (archived didn't count; restored, it does) |

## Counting

Two bounded indexed reads, `take(cap)` each (one row more than the count needed to decide):

- per GM: new index `campaigns.by_owner_deletedAt_archivedAt` (`ownerId`, `deletedAt`, `archivedAt`), all three `eq`
  with `undefined` for the last two;
- app: new index `campaigns.by_deletedAt_archivedAt` (`deletedAt`, `archivedAt`), both `eq undefined`.

`by_deletedAt_archivedAt` replaces `by_deletedAt` (its prefix, CD15); its readers moved in the same change
(`cleanup.purgeDeletedCampaigns`, `adminOverview` live campaigns and the campaigns page). No counter table: the reads
are at most `cap` rows, and the read range makes concurrent creates conflict (OCC), so two GMs can't both take the
last slot.

## Decisions

- The per-GM count uses a dedicated index instead of `by_owner_deletedAt_lastOpened` + filtering archived in
  TypeScript (the plan's wording): with `take(cap + 1)` a GM with many archived campaigns would be undercounted.
- `adminOverview.campaigns` pages by the new index: among live campaigns, newest first, archived ones now sort ahead of
  the others (ordered by `archivedAt`).

- The e2e backend keeps every campaign the shared test GM creates across runs, so `scripts/e2e-setup.mjs` runs the
  internal `e2e:raiseCampaignCaps` (refuses unless `isE2EDeployment`), which saves both campaign caps at 1,000,000.
  Existing checkouts rerun `pnpm e2e:setup` once.

## Tests

`tests/convex/campaign-caps.test.ts`: per-GM and app refusals, the owner capped, deleted and archived not counted,
restore / unarchive refused past the caps, a deleted archived campaign restorable at the cap, lowering a cap removes
nothing. `tests/convex/campaigns.test.ts` (rate-limit test) raises the per-GM cap so the rate limit is what it tests.
