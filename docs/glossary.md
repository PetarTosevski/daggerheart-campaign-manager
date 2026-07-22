# Glossary

This glossary defines product, game, and data terms used throughout the
repository. Use these terms consistently in code, database names,
documentation, tests, and UI labels.

## Activity history

A chronological view of meaningful campaign operations and state changes.

Activity history may be assembled from operation and event records. It must not
invent events or silently omit relevant corrections.

## Advance

A deliberate change that moves a countdown toward completion or moves campaign
time forward.

## Archive

Hide an entity from normal active views without destroying its historical
records.

Archiving is preferred over deletion for characters, countdowns, inventory
items, and food stores that have campaign history.

## Automatic effect

A configured change proposed or applied because another operation occurred.

Examples may include food consumption during week advancement or a countdown
change linked to a confirmed campaign rule.

Automatic effects must be previewed when required and must not be invented by
the application.

## Campaign

The top-level container for all data belonging to one Daggerheart game.

## Campaign phase

An optional descriptive label for the current broad stage of the campaign.

Examples could include travel, settlement, recovery, or winter, but values are
campaign-defined unless formally specified elsewhere.

## Campaign state

The set of current values needed for fast display and operation, such as current
week and current Fear.

Campaign state is a current snapshot. Event history explains how it changed.

## Campaign week

An ordered unit of fictional campaign time used by this application.

The exact narrative meaning and automatic consequences of one week must be
defined in the campaign rules documents before implementation.

## Character

A player character belonging to a campaign.

## Compound operation

One logical user action that creates or updates several related records.

Examples:

- Advancing campaign weeks and consuming food
- Transferring inventory
- Completing a countdown and applying a linked effect

A compound operation must be atomic.

## Consequence

The outcome associated with completing or triggering a countdown.

A consequence may be narrative-only or may include explicitly configured
application effects.

## Correction

A new event or operation that fixes incorrect historical state while preserving
the original record.

A correction is not silent editing of history.

## Countdown

A tracker representing progress toward an outcome.

A countdown has a current value, a completion boundary, a direction, a status,
and event history.

## Countdown event

A historical record of a countdown change.

Examples:

- Advance
- Reverse
- Pause
- Resume
- Complete
- Cancel
- Correct
- Undo

## Countdown direction

The direction in which a countdown moves toward completion.

Supported initial values:

- `up`: increases toward a target
- `down`: decreases toward a target

## Current value

The latest cached numeric state of a resource or countdown.

Current values must remain consistent with the events or transactions that
produced them.

## Event

An immutable or append-oriented historical record of a meaningful state change.

## Fear

The tracked Daggerheart Fear resource for the campaign.

The exact official and campaign-specific behavior must be confirmed through the
rules references.

## Fear event

A record of one Fear increase, decrease, correction, undo, or approved automatic
change.

## Food category

A campaign-configurable classification used for food behavior.

Examples may include fresh or preserved, but no category is official for this
application until documented.

## Food store

A tracked quantity of food owned by a character, the party, or a location.

Food stores are separate from general inventory because they may participate in
time-based consumption and spoilage.

## Food transaction

A historical record of food acquisition, consumption, transfer, spoilage, loss,
correction, or undo.

## Game interpretation

The documented mapping between confirmed tabletop rules and application
behavior or data structures.

## Game Master

The authenticated user who owns and operates the campaign.

Use `GM` only after the full term has been established in a document or screen.

## Homebrew

A rule, mechanic, or interpretation created or deliberately changed by the
campaign owner rather than taken directly from the official SRD.

Homebrew must be identified explicitly.

## Idempotency

The property that retrying the same operation does not apply its effects more
than once.

## Inventory item

A tracked item or stack owned by a character, the shared party, or a location.

## Inventory transaction

A historical record of an inventory acquisition, consumption, transfer, loss,
discard, correction, or undo.

## Invariant

A rule that must always remain true in persistent application state.

Examples:

- Fear cannot be negative.
- Inventory quantity cannot be negative.
- A transfer preserves total quantity.

## Location

A campaign place capable of owning inventory or food.

Detailed location management is not part of the initial release unless added by
an approved task.

## Mechanic definition

A reusable, constrained description of a custom campaign mechanic and its
allowed fields.

It cannot contain arbitrary executable code.

## Mechanic instance

An active occurrence of a mechanic definition attached to a campaign entity or
scope.

## Operation

A recorded logical action performed by the user or system.

Operations may group multiple events and transactions.

## Owner

The authenticated user who controls a campaign.

This is distinct from an inventory owner, which may be a character, party, or
location.

## Party inventory

Items owned collectively by the adventuring party rather than by one character.

## Portion

A campaign-defined unit representing an amount of food available for
consumption.

The exact relationship between quantity, unit, and portions must be documented
before automatic consumption is implemented.

## Preview

A non-persistent representation of the changes that would occur if the user
confirmed an operation.

A preview must not modify database state.

## Private note

GM-only campaign text that may contain spoilers or sensitive campaign
information.

Private notes must not be exposed in unauthenticated or future player-facing
views.

## Progress countdown

A countdown used to represent advancement toward completing a project or
objective.

Use this label only where it matches the documented rules reference or an
explicit campaign convention.

## Reconciliation

A check that cached totals match the event or transaction history that produced
them.

## Reverse

Move a countdown away from completion, where the countdown configuration permits
it.

## Row-Level Security

PostgreSQL policies that restrict which authenticated users may read or modify
rows.

Abbreviation: RLS.

## Rule source

An authoritative or approved source used to determine application behavior.

Examples:

- Official Daggerheart SRD
- Explicit campaign house rules
- Confirmed game interpretation

## Session

A real-world play session.

A session is not the same as a campaign week.

## Shortage

A state where available food is insufficient for the configured consumption
requirement.

The application must not invent shortage consequences.

## Spoilage

A recorded reduction or status change caused by food becoming unusable.

The spoilage model is campaign-configurable.

## Starting value

The value a countdown has when created or reset.

## Target value

The boundary at which a countdown is complete.

## Transaction

A database operation in which all included changes succeed or all are rolled
back.

This term is distinct from an inventory or food transaction record, although
those records should often be created inside a database transaction.

## Undo

A new operation that reverses the effects of an eligible prior operation while
preserving both histories.

Undo does not erase the original operation.

## Vertical slice

A small, complete feature that includes data model, domain logic, server
boundary, UI, validation, tests, and documentation.

## Witherwild

The official campaign frame selected for the initial campaign. Use the singular
spelling `Witherwild` in product copy and new code identifiers.

## Wither token

A character-specific token introduced by the Witherwild campaign frame. Wither
tokens are distinct from Fear even when the same physical tokens are used at the
table.
