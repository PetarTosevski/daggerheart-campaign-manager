# TASK-LN-N1: World, maps, Codex pins, frame trackers

Lane N1 of `.omc/plans/lanes.yaml` (label `lane:w0-n1-world`). Status: **Review** (built and tested; the open
questions below need the user before the follow-ups).

## Beads

| Bead | What landed |
| --- | --- |
| dcm-bxp.27 | `frameTrackerMutation` and Five Banners' week advance no longer route through the exact-`Error` conversion: every module in `src/lib/frames/trackers/` throws `RuleError` with its own code, and anything else is a bug that propagates. `applyTrackerRule` stays only as a shim for `convex/characterExtras.ts` (not N1's); see "Orchestrator follow-ups". |
| dcm-bxp.60 | `tests/e2e/horizon.spec.ts` starts a session, marks a Doom Track box and expects "(session 1)". (Lunar Phases was covered by tests/convex/sessions.test.ts U6/K4.) |
| dcm-bxp.16 | `codex.dropPin` (GM, edit on the entry and the map): from the Codex pin picker, a click on the map drops a new pin of the chosen type for the location (named after it, ticked Location, hidden while the entry is secret) or moves its linked pin; in Journey to Horizon it snaps to its hex's centre (`snapToHexCentre`). The picker opens without existing pins. |
| dcm-bxp.18 | Umbra pyres: optional World-marker link per pyre (`linkPyre`), Show on map, lit/unlit badge on the marker (World board); "The party is at a Sacred Pyre" follows the map — the party marker within N km (`setVicinity`, default 1 km, per campaign) of a lit linked pyre — until the GM ticks or clears the checkbox; "Follow the map" (`setAtPyre(null)`) hands it back. The Lurking Darkness roll and rest hook use the effective value. |
| dcm-bxp.17 | Hex crawl regions, Soul Echo sanctuaries, Locate Soul Echoes, Collect Echo (below). |

## dcm-bxp.17: what is built (frame-trackers-spec §10, HF pp.169–177)

- **Generate region** (`trackers.horizon.generateRegion`): server rolls d20 habitat (1 = Shadowblighted: roll again;
  another 1 = overtaken; with the Doom Track Tier 2 rule in force a first 1 counts as a double 1), d12 size, d8+d6
  encounter, d4 terrain, d100 rumor. Each region is its own `frameTrackers` row (`horizonRegion:000001`, capped at
  500, counter in the `horizonCrawl` row). Habitat and Encounter tables are transcribed short (`src/lib/world/hex-crawl.ts`);
  the rumor is the roll plus the GM's text (Q10 default: the d100 table is not transcribed).
- **Painting**: the GM selects a hex and presses "Paint" on a region, which writes the hex's region, habitat and terrain
  through `maps.updateHex`. The panel shows "N of size hexes".
- **Encounters**: the region lists its rolled encounter with a used flag; "Roll another encounter" adds a d8+d6 roll.
  When a move activates an encounter, the travel result lists the destination region's unused encounters.
- **Rumor**: text and "the party knows it"; players see known rumors (region name + text).
- **Soul Echoes**: the GM marks up to nine sanctuary markers as holding an Echo (GM only); "Collect the Echo" marks it
  collected and raises the Soul Echoes count in the same mutation (level-up message; 10 unlocks Horizon).
- **Locate Soul Echoes**: 8-point bearing from the party's hex to the nearest (by hexes) sanctuary with an uncollected
  Echo, "here" in the same hex; the GM ticks "Alerts the Seekers-in-Shadow" (GM only). Players see the bearing and day.
- Already in place before N1: sanctuaries visible to players, long rest only in a sanctuary, short-rest limit (core),
  Endurance Countdowns.

## Open questions (dcm-bxp.17) — not guessed

1. **Overtaken region.** HF p.170: "If you roll another 1, the entire region has been completely overtaken and is nigh
   impossible to traverse." Now: shown as "Shadowblighted (overtaken)", travel is not blocked. Options: (a) keep as a
   label only; (b) `moveToHex` refuses entering its hexes unless the GM overrides; (c) entering costs extra days or
   forces d4 encounter dice.
2. **Encounter 2.** HF p.171: "2 Roll on this table twice and combine the resulting entries." Now: the GM presses
   "Roll another encounter" twice. Options: (a) keep manual; (b) a 2 auto-rolls two more (rerolling a further 2);
   (c) auto-roll two more and allow nested 2s.
3. **Optional encounter effects.** HF p.171: "4 … Optional: The GM gains a Fear for each PC." / "12 … Optional: Each PC
   gains a Hope." Now: text only. Options: (a) text only; (b) a campaign option that applies them when the GM marks
   the encounter used; (c) a one-click "Apply" button on those encounters.
4. **Locate Soul Echoes as a downtime move.** HF p.176: "the players gain access to an additional downtime move: Locate
   Soul Echoes." Now: a GM button on the World board's crawl panel. Options: (a) keep the GM button; (b) add it to the
   rest picker's downtime moves (needs `src/lib/domain/rest/**` and `convex/lib/validators/rests.ts`, lane E8);
   (c) both.
5. **Ties in "nearest sanctuary".** HF p.176 "the nearest sanctuary with a Soul Echo". Now: by hex distance, ties to
   the lowest marker id. Options: (a) keep; (b) straight-line distance between markers; (c) the GM picks among ties.
6. **Collect Echo location.** Not specified whether the party must be in the sanctuary's hex. Now: not enforced.
   Options: (a) keep; (b) require the party's hex; (c) warn but allow.
7. **Region contiguity.** HF p.170: "The shape of the region can be whatever you want, as long as you don't encircle
   empty hexes." Now: not checked. Options: (a) keep; (b) warn when a painted hex isn't adjacent to the region;
   (c) refuse.
8. **Sanctuary generation and settlement names** (HF pp.174–175 d20/d12/d10/d10/d8/d6/d4 tables and the d100×2 name
   table): spec Q10 defaults to transcribing Name, not built here. Options: (a) build the sanctuary roller and the name
   generator; (b) name generator only; (c) leave as page references.

## Tests

- `tests/convex/authz/world.entries.ts`: `codex.dropPin`, the pyre-link functions and every crawl function (anonymous,
  outsider, player, grantee, GM).
- `tests/e2e/horizon.spec.ts`: Doom Track session stamp; Echo sanctuary, Locate Soul Echoes (bearing, Seekers flag GM
  only), region generation and known rumor reaching a player, Collect Echo; Codex picker drops a hidden pin.
- No unit or Convex behaviour test file is in N1's `owns` (see follow-ups).
- Run 2026-10-30: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 8994 passed with 1 failure in
  `tests/convex/combat-riders.test.ts` (dice-dependent, not touched; it passed on 3 reruns), `tests/e2e/horizon.spec.ts`
  3/3 passed twice (servers started by hand, `E2E_REUSE_SERVERS=1`; host load 10–27). The player's test sign-in
  retries (`toPass`), because under load it was typed before the form hydrated.

## Orchestrator follow-ups (outside N1's owns)

- `convex/characterExtras.ts`: stop calling `applyTrackerRule` (call `apply` directly; the extras modules already
  throw `RuleError`), fix the stale comment "The domain's plain `Error`s become `EXTRA_RULE`", then delete
  `applyTrackerRule` from `convex/lib/trackers.ts` and its `describe("applyTrackerRule")` block in
  `tests/convex/andaluria.test.ts`. That finishes dcm-bxp.27.
- Unit tests to add (a tests/unit file N1 doesn't own): `src/lib/world/hex-crawl.ts` (habitat reroll and Tier 2 double
  1, bearing sectors, nearestEcho ties, setEcho cap) and `src/lib/frames/trackers/age-of-umbra.ts`
  (`partyNearLitPyre`, `effectiveAtPyre`, `atPyreMode` legacy default).
- Data model doc: `frameTrackers` rows `horizonCrawl` and `horizonRegion:<id>`; Umbra state widened with
  `pyres[].tokenId`, `atPyreMode`, `vicinityKm` (all optional, no migration needed).
- Later: a dedicated `mapRegions` table instead of `frameTrackers` rows if regions grow fields queried on their own.
