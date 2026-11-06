# TASK-RULES-RT: Optional rule Spotlight Tracker (action tokens per PC, CB p.89)

Plan `.omc/plans/rule-switches.yaml`, tracer RT (epic dcm-jh6d; absorbs part of dcm-bxp.134). Builds on RS0 (the
optional rule `spotlightTracker` and its number `spotlightTrackerTokens`, read through `ruleMode`) and RA / RA2 (every
PC action roll runs `rollAftermath.applyPcActionRoll`).

## Book passage

CB p.89, "Optional Tool: Spotlight Tracker":

> If your group prefers tactical play or structured player turns, you can limit the number of actions each PC has
> available to them at a time. We recommend that you start with three, but you can increase or decrease the number as
> your table prefers.
>
> If you use this system, when a battle begins, every player places action tokens on their character sheets to
> represent how many actions they can take. Players then act as usual, and each time they make an action roll or
> perform a significant action while in the spotlight, they remove 1 token from their sheet. […]
>
> Once every player has used all their available tokens, players refill their character sheet with the same number of
> tokens as before, then continue playing.

User decisions: optional, off by default (2026-10-30, bd dcm-bxp.134: "3 action tokens per PC default"); Q9 a
(2026-11-05): the GM sets the tokens per PC (1-6, default 3); action rolls spend automatically; at 0 the player is
warned, not stopped; all refill when every PC is out; the GM can refill early.

## What the app does

| Switch | Behaviour |
|---|---|
| Off (default) | Nothing: no rows read or written, `combatHud.party` rows carry no `tokens`, the HUD shows none, `combatSpotlight.refillTokens` refuses with `MECHANIC_DISABLED`. |
| On | Each PC with a token on the live Combat Map has N tokens (`spotlightTrackerTokens`). Each PC action roll of that PC spends one. At 0 the roll still goes through and spends nothing; the player's HUD says "No actions left: let another player act". After a roll, when every PC on the live map is at 0, all refill. The GM's "Refill actions" (spotlight popover, Party tab) refills early. |

Interpretations (each reversible; questions for the user below):

- Tracked only for a PC with a token on the live map ("when a battle begins"; the plan's "every PC with a token on the
  live map"). A roll by a PC who is not on the live map, or with no live map, spends nothing.
- A Tag Team (one roll for the pair, CB p.97) spends the first PC's token only: `afterPcActionRoll` gets the first
  character (`convex/rolls.ts`, not this tracer's file).
- The automatic refill also runs after a roll at 0 (everyone can be out without a spend: a PC with tokens left the map,
  or the GM lowered N).
- Undo does not give a token back (as the spotlight, bead dcm-bxp.99.32.10). The refill is not logged.
- Tokens do not reset at the start of an encounter or a scene; they carry over until everyone is out or the GM refills.
- Only action rolls spend; "a significant action while in the spotlight" without a roll spends nothing (the GM can
  refill if the table counts it differently).

## Code

- `convex/tables/combatSpotlight.ts`: table `actionTokens { campaignId, characterId, used, updatedAt }`, index
  `by_campaign_character` (its campaign prefix serves the refill and the purge; no separate `by_campaign`, which would
  be a prefix duplicate, CD15). No row = full.
- `convex/lib/actionTokens.ts`: `trackerTokens(campaign)` (N or null when off), `actionTokensOf` (the HUD's
  `{ left, of }`), `spendActionToken` (the spend and the automatic refill), `refillActionTokens`.
- `convex/lib/rollAftermath.ts`: `Aftermath.spendToken` (an action roll); `applyPcActionRoll` calls `spendActionToken`
  first. Every path that runs the aftermath (plain and manual rolls, Tag Team, weapon attacks, card and feature uses,
  the Cloaked roll) spends with no change of its own.
- `convex/lib/combatHud.ts`: `hudPartyMemberValidator.tokens?` (widened) filled by `partyMemberOf` when on.
- `convex/combatSpotlight.ts`: `refillTokens` (keyed GM mutation, returns `{ refilled }`, MECHANIC_DISABLED when off).
- `convex/cleanup.ts`: purges `actionTokens` with the campaign (bounded `take`).
- `src/components/combat-map/hud/spotlight/`: the player's pips and the at-0 warning under the disc (desktop, tablet)
  or beside it (phone), a polite live region; the GM's Party rows add "2 of 3 actions left"; "Refill actions" with an
  optimistic update of `combatHud.party`.

## For the orchestrator (files outside RT's owns)

- `tests/convex/schema-guard.test.ts`: add `"actionTokens"` to the campaign-scoped list (after `"combatSeen"`).
- `tests/convex/cleanup.test.ts` `seedCampaign`: seed one row, e.g.
  `await ins("actionTokens", { campaignId: c, characterId: <a seeded character>, used: 1, updatedAt: now });`.
- The party banners (`src/components/combat-map/hud/banners/`) could show the pips on every PC's banner too.

## Tests

- `tests/convex/rules-action-tokens.test.ts`: off (no rows, no HUD tokens, refill refused), default 3, spend per roll,
  at 0, reaction rolls, the automatic refill, N = 1, refill after a roll at 0, PCs off the live map, the GM's and co-GM's
  refill, a lowered N.
- `tests/convex/authz/rules-tokens.entries.ts`: `combatSpotlight.refillTokens`.
