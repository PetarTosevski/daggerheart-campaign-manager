# Product Specification

## Document status

Status: Active draft — implementation reconciliation required

Product: Witherwild Campaign Manager

Primary user: Game Master

Initial deployment: Private, single-user application

This document defines what the application must do. Technical implementation
decisions belong in `architecture.md`. Database details belong in
`data-model.md`. Rules interpretations belong in `game-interpretation.md`.


## Current delivery status

The owner reports that authentication, dashboard, Fear, countdowns, and basic
characters have been implemented. The uploaded material did not include source
code, migrations, or test results, so those features remain in Review until
verified against their task acceptance criteria.

Before Phase 2 begins, reconcile the current repository and create missing task
specifications for the campaign shell/dashboard and basic characters if they do
not already exist.

## Product summary

The Witherwild Campaign Manager is a private web application used by a Game
Master to operate a Daggerheart campaign during and between sessions.

The application centralizes campaign state that would otherwise be distributed
across paper notes, character sheets, spreadsheets, and separate trackers.

The initial campaign uses the Witherwild campaign frame, but core features
should remain reusable for another Daggerheart campaign where practical.

The application is not:

- A virtual tabletop
- A rules compendium
- A character-building marketplace
- A public campaign-management service
- A replacement for the official rulebook
- A player-facing multiplayer application in the initial release

## Product goals

The application must help the GM:

1. Understand current campaign state at a glance.
2. Update common resources during live play with minimal interruption.
3. Track the passage of campaign time.
4. Preserve the history and reason for important changes.
5. Manage countdowns and long-running developments.
6. View and maintain player-character information.
7. Manage party and character inventory.
8. Track food acquisition, consumption, transfer, spoilage, and shortages.
9. Support selected Witherwild mechanics and campaign-specific homebrew.
10. Recover from accidental changes.

## Success criteria

The first useful release is successful when the GM can run a normal session
without needing a separate spreadsheet for:

- Current Fear
- Active countdowns
- Current campaign week
- Basic character state
- Party food
- Important inventory

During normal use:

- Common state changes require no more than two primary interactions.
- Important changes appear in activity history.
- Compound operations are not partially applied.
- Accidental changes can be corrected or undone.
- The dashboard remains practical at common laptop and tablet widths.

## Primary user

### Game Master

The initial release has one authenticated user who owns and manages the
campaign.

The GM can:

- View all campaign information.
- Create and modify campaign records.
- Advance time.
- Adjust resources.
- Manage characters.
- Manage private notes.
- Correct or undo eligible changes.

Player accounts and shared editing are outside the initial scope.

## Core product concepts

### Campaign

A campaign is the top-level container for characters, time, Fear, countdowns,
inventory, food, mechanics, notes, and activity history.

### Campaign state

Campaign state contains the values the GM needs immediately, including:

- Current campaign week
- Current Fear
- Current campaign phase
- Active countdown summary
- Food status
- Recent activity

### Campaign week

A campaign week is an ordered unit of fictional campaign time.

The exact game effects of advancing a week must come from documented rules,
campaign configuration, or explicit GM selections. The software must not invent
automatic consequences.

### Fear

Fear is a tracked numeric resource.

Every adjustment must record:

- Amount
- Direction
- Timestamp
- Associated campaign
- Associated compound operation, when applicable

The Fear resource is constrained as follows:

- Campaign Fear is limited to values from 0 through 12.
- The interface must prevent or reject adjustments outside that range.

### Countdown

A countdown represents progress toward an outcome.

A countdown has:

- Name
- Optional description
- Category
- Current value
- Target or starting value
- Direction
- Status
- Optional consequence
- Optional linked entity
- Event history

Phase 1 uses the constrained application categories `threat`, `project`,
`consequence`, and `other`. Countdowns begin at a positive integer and count
down to `0`.

### Character

A character represents a player character belonging to the campaign.

The character model will expand incrementally. The initial version must not
attempt to encode every possible rule before the basic workflow is validated.

### Inventory

Inventory records items owned by:

- A character
- The shared party
- A location

Quantity changes and transfers must preserve history.

### Food store

Food is tracked separately from general inventory because it participates in
time-based consumption, transfer, loss, and spoilage workflows.

### Custom mechanic

A custom mechanic is a configurable campaign-specific tracker that cannot be
represented adequately by Fear, countdowns, inventory, or food.

Custom mechanics must use a constrained field system. They must not execute
arbitrary user-supplied code.

## Core user journeys

### Open the campaign dashboard

The GM signs in and opens the campaign.

The dashboard displays:

- Campaign name
- Current week
- Current Fear
- Active countdowns
- Party food summary
- Character summaries
- Recent activity

The most important current state should be visible without navigating through
several pages.

### Adjust Fear

The GM:

1. Selects an increase or decrease.
2. Selects the one-point adjustment action.

The application:

- Validates the new value.
- Records a Fear event.
- Updates the displayed total.
- Adds the action to recent activity.
- Keeps the Fear pool to a minimum of 0 and a maximum of 12.

### Create and operate a countdown

The GM creates a countdown with its name, range, direction, category, and
optional consequence.

The GM can:

- Advance it.
- Reverse it when permitted.
- Pause it.
- Resume it.
- Complete it.
- Cancel it.
- Correct an erroneous change.
- View its event history.

Completion must not apply the same automatic effect more than once.
Reaching `0` completes automatically. Reversing a completed countdown above
`0` reopens it but does not reverse any narrative consequence.

### Advance campaign time

For manual daily movement, the GM previews and commits exactly one campaign
day. Days `1–6` increment only the cycle day. Day `7` increments the campaign
week, resets the cycle day to `1`, and alternates Day and Night. The GM may also
set a different valid canonical state through an auditable correction that
preserves prior history.

For the later compound week-advancement workflow, the GM chooses how many weeks
to advance.

Before committing, the application previews applicable effects, including:

- New week number
- Proposed food consumption
- Proposed spoilage
- Proposed Fear changes
- Eligible countdown changes
- Other configured campaign effects

The application stores:

- campaign week
- cycle
- cycle day

The interface displays the corresponding phase name (for example, "Forenoon"
or "Dead of Night") derived from cycle and cycle day. The phase name is not
stored as canonical campaign state.

The GM can enable, disable, or adjust effects where campaign rules permit.

Confirmation applies the operation transactionally. Either every selected
effect is recorded or none is.

### Manage a character

The GM can:

- Create a character.
- View a character summary.
- Edit supported character fields.
- Adjust tracked resources.
- Add conditions and notes.
- View associated inventory.
- Archive a character without deleting historical campaign records.

### Manage inventory

The GM can:

- Create an item.
- Assign it to a character, party, or location.
- Adjust quantity.
- Transfer some or all of it.
- Mark it consumed, lost, or discarded.
- Review transaction history.

A transfer must subtract and add the same quantity as one logical operation.

### Manage food

The GM can:

- Add food to a store.
- Record its unit and portion quantity.
- Record when it was acquired.
- Assign optional spoilage information.
- Consume food manually.
- Transfer food.
- Record loss or spoilage.
- Preview food use during week advancement.

The application must not assume a universal consumption or spoilage rule.
Campaign-specific behavior must be configurable.

## Functional requirements

### Authentication

- The application requires authentication.
- Anonymous users cannot access campaign data.
- The initial application supports one campaign owner.
- Public self-registration is not required.
- Authorization must be enforced on the server and in the database.

### Campaign management

The GM can:

- Create a campaign.
- Edit its name and basic description.
- Open its dashboard.
- Archive it.
- Export campaign data in a later phase.

Deleting an entire campaign is destructive and requires explicit confirmation.

### Dashboard

The dashboard must:

- Show current critical state.
- Provide direct access to common adjustments.
- Show loading, empty, and error states.
- Remain usable on tablet and laptop displays.
- Avoid displaying private GM information in unintended player-facing views.

### History and auditability

The application must preserve history for:

- Fear adjustments
- Countdown changes
- Week advancements
- Inventory quantity changes
- Inventory transfers
- Food changes
- Compound operations
- Eligible corrections and undo actions

History records may include a concise reason or description where the
individual feature requires one. Fear adjustments do not collect or store one.

### Undo and corrections

The product must distinguish:

- Undoing a recent reversible operation
- Correcting historical data
- Permanently deleting a record

History should generally be corrected through compensating events rather than
silently rewritten.

The exact undo window and eligible operation types remain product decisions.

### Notes

The GM can attach notes to supported campaign entities.

Notes may be private and can contain campaign spoilers.

The application should not log complete private note contents in general
application logs.

## Initial release scope

### Phase 1: Campaign control surface

Includes:

- Authentication
- Campaign shell
- Dashboard
- Campaign state
- Fear tracker
- Fear history
- Countdown creation
- Countdown operation
- Countdown history
- Basic characters
- Recent activity

Phase 1 is complete when the GM can create a campaign, adjust Fear, manage
countdowns, create basic character records, and see those changes reflected on
the dashboard and in history.

### Phase 2: Campaign time and survival

Includes:

- Campaign weeks
- Week advancement preview
- Transactional week advancement
- Food stores
- Food transactions
- Consumption
- Transfers
- Spoilage
- Shortage display
- Undo for supported compound operations

### Phase 3: Character and inventory expansion

Includes:

- Expanded character sheets
- Character resource tracking
- Conditions
- Equipment
- Shared inventory
- Character inventory
- Location inventory
- Inventory transactions and transfers

### Phase 4: Witherwild and custom mechanics

Includes:

- Confirmed Witherwild-specific mechanics
- Custom mechanic definitions
- Custom mechanic instances
- Links between mechanics and countdowns
- Configurable automatic effects

### Phase 5: Reliability and portability

Includes:

- Campaign export
- Campaign import
- Backup guidance
- Improved audit browsing
- Accessibility review
- Expanded end-to-end tests
- Optional offline-read support

## Explicit non-goals for the initial release

Do not build:

- Tactical maps
- Token movement
- Video or voice chat
- Dice physics
- Public character browsing
- A rules-search engine
- Automatic encounter generation
- Generative campaign writing
- A public account-registration system
- Player editing
- Multi-GM collaboration
- Marketplace integrations
- Mobile native applications
- Arbitrary plugin execution
- Arbitrary user-authored scripts

These may be reconsidered only through an explicit product decision.

## UX requirements

The interface is used while the GM is actively running a session.

Therefore:

- Critical state must be easy to scan.
- Frequent controls must be large enough for tablet use.
- Routine actions should avoid unnecessary modal dialogs.
- Destructive actions require confirmation.
- Forms must preserve entered information after recoverable errors.
- Keyboard navigation must be supported.
- Controls require accessible names.
- State must not be communicated through color alone.
- Animation must not delay routine interaction.
- The visual direction may be woodland-inspired but readability takes priority.

## Data and reliability requirements

- Important multi-record operations must be transactional.
- Retried requests must not apply the same effect twice.
- Numeric state must use numeric database types.
- Campaign-owned records must be associated with a campaign.
- User-owned records must be protected by row-level security.
- Important state changes require an event or transaction record.
- Database schema changes require committed migrations.
- Production or shared migrations must not be rewritten after application.

## Rules and content requirements

- Do not invent Daggerheart mechanics.
- Official behavior must be traceable to the SRD through `rules-index.md`.
- House-rule differences must be recorded in `campaign-house-rules.md`.
- Software interpretations must be recorded in `game-interpretation.md`.
- Campaign-specific context belongs in `witherwild-notes.md`.
- Substantial rulebook text and protected artwork must not be copied into the
  application.

## Open product decisions

The following require confirmation before implementation depends on them:

- What does one campaign week represent narratively?
- What actions cause a campaign week to advance?
- Is Fear capped, and is the cap configurable?
- Which week effects are automatic versus manually selected?
- How many food portions does each character consume per week?
- Do different character states affect food consumption?
- Which food categories exist?
- How is spoilage calculated?
- Can a countdown move in both directions?
- Which countdown completions trigger automatic effects?
- How long should undo remain available?
- Which character-sheet fields are required in the first usable version?
- Does the GM need a temporary player-safe display mode?

Confirmed answers should be moved from this section into the appropriate
requirements section and, where relevant, into the supporting rules documents.

## Feature acceptance-criteria format

Every implementation task in `docs/tasks/` must specify:

- User goal
- Included behavior
- Excluded behavior
- Preconditions
- Normal flow
- Validation rules
- Empty state
- Loading state
- Failure state
- Authorization behavior
- History or audit behavior
- Undo or correction behavior
- Unit-test requirements
- End-to-end test requirements
- Documentation updates
- Unresolved questions

## Definition of MVP completion

The MVP is complete when:

1. The GM can sign in securely.
2. The GM can create and open a campaign.
3. The dashboard displays current campaign state.
4. Fear can be adjusted with history.
5. Countdowns can be created and operated with history.
6. Campaign weeks can be advanced transactionally.
7. Food can be acquired, consumed, transferred, and lost.
8. Basic character records can be maintained.
9. Basic party and character inventory can be maintained.
10. Important operations can be corrected or undone where defined.
11. Unauthorized access is blocked.
12. Required automated checks pass.
13. The application can be deployed without relying on private reference files.