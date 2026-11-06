# TASK-RULES-RD1: pin today's frame-rule values before the defaults turn off

Status: Review. Plan: `.omc/plans/rule-switches.yaml`, tracer RD1 (epic dcm-jh6d part A, bead dcm-bxp.134).

## Rule

User answer Q1 (a), 2026-11-05 (`.omc/plans/rule-switches-briefs.md`): running campaigns keep today's frame rules (on,
unless the GM turned them off); only new campaigns start with them off. The four rules are optional in the books:
Less Lethal (HF p.127), Transformations (HF p.34), Endurance Countdowns (HF p.176, "You can heighten the tension of
traveling through the wilderness with this optional rule") and Remnant Corruption (CB p.295, "OPTIONAL RULE:
CORRUPTION TRACK").

## What it does

`convex/migrations/ruleDefaults.ts` defines `pinFrameOptions` (`@convex-dev/migrations`, CD5: batched, resumable,
idempotent) on `campaigns`, every row including deleted and archived ones:

| Option | Frame that offers it | Value pinned |
|---|---|---|
| `lessLethal` | `castle-high` | `true` |
| `transformations` | `dark-heart-of-andaluria` | `true` |
| `enduranceCountdowns` | `journey-to-horizon` | `true` |
| `remnantCorruption` | `motherboard` | `true` |

Today's effective default, checked in `src/lib/frames/options.ts`: each option's `defaultFor(frameId)` is true in the
one frame that offers it, so an unset key resolves to on. The migration writes `options[key] = true` only when the
campaign's frame offers the option and the key is unset. Keys the GM already set (true or false), every other option
and campaigns of other frames are untouched; a row with nothing to pin is not written. The values are fixed in the
migration rather than read from `CAMPAIGN_OPTIONS`, so it still pins "on" after RD2 changes the defaults.

No field changes shape (CD4): only the default changes, in RD2, after this has run.

## Commands (orchestrator)

Dev, after RD1 is merged and deployed (before RD2 merges):

```bash
npx convex run migrations/run:run '{fn: "migrations/ruleDefaults:pinFrameOptions", dryRun: true}'
npx convex run migrations/run:run '{fn: "migrations/ruleDefaults:pinFrameOptions"}'
npx convex run --component migrations lib:getStatus --watch
```

Prod: only when the user deploys, the same two commands with `--prod`, and before the deploy that ships RD2. Rerunning
is safe (`reset: true` too).

## Tests

`tests/convex/migrations-rule-defaults.test.ts`: Castle High with no key, key false and key true; Andaluria with another
option set; a deleted Horizon campaign; Motherboard with an empty record; Witherwild with its own option; Witherwild
with a stray `lessLethal` key. A dry run changes nothing; the run pins only the missing keys of the offering frames;
rows with nothing to pin are unchanged; a second run and a `reset: true` run change nothing.
