# Architecture

## Document status

Status: Reconciled through Task 012 — Character Food System

Product: Witherwild Campaign Manager

This document defines the technical architecture of the application. Product
requirements belong in `product-spec.md`. Database details belong in
`data-model.md`. Game-rule interpretations belong in
`game-interpretation.md`.


## Implementation reconciliation

This document currently describes the intended architecture. Before using it to
change an existing application, inspect:

- `package.json` and lockfile
- The actual application directory structure
- Supabase migrations and generated database types
- Authentication implementation
- Existing server actions or route handlers
- Test configuration and scripts
- Deployment configuration

When implemented behavior differs, do not assume either side is correct. Record
the discrepancy, decide deliberately, and update this document and the relevant
task together.

The installed package versions and scripts are authoritative for the current
repository. This document defines architectural boundaries, not exact dependency
versions.

The implemented Tasks 001–005 use one protected `/dashboard` route for the
current campaign's Fear and countdown vertical slices. Data loading remains in
Server Components and server-side data modules; interactive forms use Client
Components and named Server Actions; authoritative mutations use transactional
PostgreSQL functions. Campaign-specific nested routes remain a future layout
option rather than an implemented requirement.

Task 006 adds the shared append-only operation identity and campaign-scoped
idempotency foundation. Authenticated mutation uses an owner-authorized
transactional database function; RLS permits owner reads; later tasks may link
their compound event records without defining generic undo behavior here.

Task 007 adds campaign-time display, one-day preview and commit, correction,
and recent history to the protected dashboard. A pure campaign-time domain
module is the presentation source of truth for phase derivation and one-day
preview. The authoritative PostgreSQL function independently enforces the same
transition, updates cached state, and appends the operation and event in one
transaction. The browser cannot directly update canonical campaign time or
mutate its history.

Task 009 adds the persistent authenticated shell. It lives in the `app/(app)/`
route group at `app/(app)/layout.tsx`, not in a per-page or per-route-segment
layout. The route group carries no URL segment, so `/dashboard` is unchanged,
and every authenticated route placed under `app/(app)/` shares this one layout.
Because Next.js preserves a shared layout across navigation between routes that
share it, the primary navigation and campaign timeline mount once and are not
remounted when the route changes; future authenticated routes (Task 010+) added
under `app/(app)/` inherit the same shell automatically. The shell mounts
primary navigation and a display-only campaign timeline. The timeline
(`components/campaign-timeline/`) derives every value from the campaign-time
domain module, contains no advancement logic, and never mutates state; it loads
canonical state through `getCampaignTimelineState` behind a `Suspense` boundary
and shows a neutral placeholder rather than a fabricated Week 1 while loading.
Shell chrome lives under `components/layout/`. The authenticated route group is
named `(app)`; the default structure below sketches it as `(dashboard)`.

Task 010 adds the Characters module under the same `app/(app)/` route group, so
`/characters`, `/characters/new`, and `/characters/[characterId]` inherit the
persistent shell and campaign timeline without duplicating navigation. Character
business rules live in the domain layer: `lib/domain/characters` holds the pure
template-suggestion rule and the workspace-section catalog; `lib/validation/characters`
holds the Zod schemas; `lib/data/characters` holds server reads; and the guided
builder and workspace mutate only through the owner-authorized `create_character`
and `update_character` PostgreSQL functions behind named Server Actions. React
components stay presentation-only and never compute the class/template suggestion
or authorization themselves. Character classes and sheet templates are modeled as
campaign-scoped tables; PDF storage, template versions/fields, sheet field values,
inventory, food, wither tokens, artwork, and dice are explicitly deferred to their
own tasks and exist in the workspace only as labeled placeholders.

Campaign creation (Task 009A): the Campaign page (`/dashboard`, labeled
"Campaign" in the shell) shows an onboarding empty state ("No campaigns yet") to
an authenticated GM who owns none, with a validated **Create campaign** action
(`components/campaign/campaign-create-form.tsx` +
`app/(app)/dashboard/campaign-actions.ts`). It inserts through the caller's
RLS-scoped client (`campaigns_insert_own` enforces `owner_id = auth.uid()`); the
existing `create_initial_campaign_state()` trigger seeds the canonical starting
state (Week 1, DAY, cycle day 1, Fear 0) atomically. A unique index
(`campaigns_owner_name_unique`, migration
`20260724090000_campaign_name_unique_per_owner.sql`) enforces one campaign name
per owner (case-insensitive, trimmed). No service-role access or hard-coded UUID
is involved, and nothing is created merely by visiting a page. On success the
client soft-refreshes the route (`router.refresh()`), so the controls and
persistent timeline appear in place without a full page reload. The app loads the
single earliest-created active campaign deterministically (no switcher). Local
`seed.sql` optionally seeds a local-only GM login and demo campaign, but the app
never depends on it to become usable.

Task 011A adds PDF-backed sheet-template storage and read-only rendering. Two new
runtime dependencies were approved and added: `pdfjs-dist` (client-side canvas
rendering) and `unpdf` (server-side page-count and corruption validation). PDF
bytes live in a private Supabase Storage bucket (`character-sheet-templates`),
accessed only through short-lived signed URLs; immutable version metadata lives in
`sheet_template_versions`, and `sheet_templates.active_version_id` points at the
rendered version. The boundary is preserved: pure PDF rules
(`lib/domain/sheet-templates`) hold constants, the deterministic object path, and
zoom/page clamping; server-only validation (`lib/pdf/validate.ts`) inspects bytes;
storage reads and signed-URL creation live in `lib/data/sheet-templates`; uploads
and archival mutate only through named Server Actions calling the owner-authorized
`create_sheet_template_version` / `archive_sheet_template_version` functions; and
the client `PdfTemplateViewer` renders, navigates, and zooms without editing the
PDF. Template management lives under `app/(app)/characters/templates`, separate
from the character's Character Sheet tab, which stays a placeholder. The
interactive sheet runtime (character values) is deferred to Task 011C.

Task 011B adds the GM sheet-template editor: interactive field definitions placed
as overlays on the rendered PDF pages, stored in `sheet_template_fields` with
coordinates normalized to page bounds (`x, y, width, height ∈ [0,1]`) so
placement is viewport/zoom independent. Versions gained a draft/published layout
lifecycle (`layout_status`, `published_at`): a draft's fields are editable;
publishing freezes them and sets the template's active version; editing a
published layout clones the version into a new draft revision (copying the PDF
object and fields) so assigned versions stay immutable. The boundary holds: pure
field rules (types, reserved keys, key normalization, coordinate clamping, set
validation) live in `lib/domain/sheet-templates`; Zod input schemas in
`lib/validation/sheet-template-fields`; editor reads in `lib/data/sheet-templates`
(`getTemplateEditorData`); and all writes go through the owner-authorized
`save_sheet_template_fields` / `publish_sheet_template_version` /
`create_sheet_template_revision` functions via named Server Actions. The client
`TemplateFieldEditor` (route `app/(app)/characters/templates/[templateId]/edit/[versionId]`)
handles selection, drag/resize, numeric placement, the field inspector, and an
unsaved-changes guard; it computes pixel positions from the normalized
coordinates and never embeds authorization or persistence rules.

Task 011C adds the interactive character-sheet runtime. Each character is pinned
to a specific published `sheet_template_versions` row via
`characters.sheet_template_version_id`; the runtime always reads the pinned
version (never the template's current active version), so publishing a newer
version cannot change an existing character. Character-specific values live in
`character_sheet_values`, entirely separate from the PDF and field definitions.
The runtime renders the pinned version's PDF page as a background (reusing the
011A pdf.js path) and overlays HTML controls at the fields' normalized
coordinates — same-page, zoom-safe, no dragging. The boundary holds: coordinate
conversion, per-type value normalization, save-state aggregation, and
stale-response handling live in `lib/domain/character-sheet`; Zod schemas in
`lib/validation/character-sheet`; runtime reads (pinned version, signed URL,
fields, values) in `lib/data/character-sheet` (`getCharacterSheetRuntimeData`,
returning an explicit no-template / no-version / ready state); and all writes go
through the owner-authorized `save_character_sheet_value` (validated,
optimistic-concurrency) and `pin_character_sheet_version` functions via
programmatic Server Actions. The client `CharacterSheetRuntime` (in the workspace
Character Sheet tab) handles debounced autosave, per-field save state, zoom, and
page navigation. Computed fields render read-only and are NOT evaluated: the task
document defines no safe expression language, so per the contract none was
invented (documented blocker). Image fields render a placeholder pending the
Task 015 asset library. Reserved keys (`food_rations`, `food_portions`,
`wither_tokens`) are ordinary fields with no Food/Wither integration.

Task 012 adds the character food system: a single authoritative, campaign-scoped
store held in portions across `food_batches`, with an append-only
`food_transactions` audit, per-campaign `food_settings`, and a
`food_week_processes` audit of committed weekly runs. The pure rules
(ration/portion conversion, active-roster requirement, fresh-spoilage
eligibility, FIFO ordering, the non-persistent weekly preview, and the
character-sheet projection) live in `lib/domain/food`; Zod schemas in
`lib/validation/food`; RLS-scoped reads in `lib/data/food`; and all authoritative
writes go through owner-authorized, idempotent `SECURITY DEFINER` functions
(`acquire_food_batch`, `process_weekly_food`, `correct_food_batch`) behind named
Server Actions. The weekly commit re-derives spoilage and consumption
independently in SQL under row locks — the client preview is informational only
and its quantities are never trusted. Consumption is FIFO by default; a GM may
override it with an explicit, reason-gated, audited ordered batch selection
(consuming only the chosen batches, in order, validated server-side and recorded
immutably in `food_week_processes`). Weekly processing is a standalone **Process
Weekly Food** action (not coupled to Task 008 time advancement) and is protected
against duplicate standard runs per week. The `food_rations`/`food_portions`
reserved sheet keys are now read-only projections of the shared store (011C's
runtime shadows any provisional per-character rows and rejects writes to them);
`wither_tokens` remains deferred to Task 014.

## Architecture goals

The architecture must:

1. Support a private, single-user Game Master application.
2. Keep game rules separate from presentation code.
3. Preserve an auditable history of important state changes.
4. Make compound operations transactional and recoverable.
5. Remain straightforward enough for AI-assisted development.
6. Support laptop and tablet use during live sessions.
7. Avoid unnecessary infrastructure and framework complexity.

## Technology stack

Use:

- Next.js App Router
- TypeScript with strict mode
- React Server Components by default
- Client Components only when browser-side interactivity is required
- Tailwind CSS
- shadcn/ui primitives
- Supabase PostgreSQL
- Supabase Authentication
- Supabase Row-Level Security
- Zod for runtime validation
- Vitest for unit and domain tests
- Playwright for critical end-to-end tests
- pnpm for package management

Do not add another ORM, state-management library, component library, form
library, or backend framework without documenting why the existing stack cannot
reasonably support the requirement.

Approved additions:

- `pdfjs-dist` — client-side PDF rendering to a canvas for the read-only template
  viewer (Task 011A). No comparable capability exists in the current stack.
- `unpdf` — server-side PDF page-count extraction and corruption detection during
  upload validation (Task 011A). Serverless-friendly and used only on the server.

Both were approved for Task 011A. See the resolved `OQ-ARCH-005` in
`open-questions.md`.

## High-level system design

The system consists of:

1. A Next.js web application.
2. Supabase Authentication for sign-in.
3. Supabase PostgreSQL for persistent storage.
4. PostgreSQL functions and transactions for compound domain operations.
5. Server Actions or route handlers as application mutation boundaries.
6. Domain modules containing game and campaign logic.
7. Event and transaction tables preserving important history.

The browser must never directly perform a multi-step domain operation by making
several unrelated database writes.

## Repository structure

Use this structure as the default:

```text
app/
  (auth)/
    login/
  (dashboard)/
    campaigns/
    campaign/
      [campaignId]/
        page.tsx
        fear/
        countdowns/
        characters/
        inventory/
        food/
        activity/
  api/

components/
  campaign/
  characters/
  countdowns/
  fear/
  inventory/
  food/
  layout/
  ui/

lib/
  domain/
    campaign/
    fear/
    countdowns/
    characters/
    inventory/
    food/
  validation/
  supabase/
    client.ts
    server.ts
    middleware.ts
  permissions/
  formatting/
  errors/

supabase/
  migrations/
  seed.sql

tests/
  unit/
  integration/
  e2e/

docs/
  architecture.md
  data-model.md
  glossary.md
  open-questions.md
  product-spec.md
  game-interpretation.md
  campaign-house-rules.md
  witherwild-notes.md
  rules-index.md
  tasks/
```

This structure may evolve, but changes must be documented here.

## Server and client boundaries

### Server Components

Use Server Components for:

- Initial page data loading
- Reading campaign state
- Reading character summaries
- Reading countdowns
- Reading activity history
- Reading inventory and food summaries
- Authorization checks before rendering protected pages

Server Components should call server-side data-access functions rather than
embedding SQL-shaped logic directly in pages.

### Client Components

Use Client Components only for:

- Interactive controls
- Forms with local validation
- Optimistic UI where failure is recoverable
- Dialogs, popovers, and keyboard interactions
- Live previews before submitting compound operations

Client Components must not contain authoritative game calculations that are
duplicated from the server.

### Mutation boundaries

All mutations must pass through:

- Named Server Actions, or
- Route handlers when an HTTP endpoint is specifically required

Every mutation must:

1. Authenticate the user.
2. Authorize access to the campaign.
3. Validate input with Zod.
4. Call a domain service or database function.
5. Return a structured success or error result.
6. Revalidate affected routes or data.

## Domain layer

Game and campaign logic belongs in `lib/domain`.

Domain functions should be:

- Explicitly named
- Small enough to test
- Independent of React
- Pure when possible
- Responsible for enforcing documented invariants

Examples:

```text
adjustFear
createCountdown
advanceCountdown
completeCountdown
advanceCampaignWeeks
transferInventory
consumeFood
reverseOperation
```

React components must not independently calculate official or house-rule game
effects.

### Canonical state and presentation values

Store canonical campaign state in the database and derive human-readable labels
in the domain layer.

Campaign phase names are presentation values. Business logic derives the
displayed phase from `current_cycle` and `current_cycle_day`. Phase names such as
`Dawn`, `Forenoon`, `Civil Twilight`, and `Dead of Night` must not be stored as
the authoritative campaign-time value in the database.

For campaign time, persist values such as:

```text
current_week = 8
current_cycle = DAY
current_cycle_day = 4
```

A domain function then derives the display model:

```text
Week 8 • Day Cycle • Forenoon
```

The phase lookup belongs in a domain module, for example
`lib/domain/campaign-time`, and must be covered by unit tests. UI components may
render the derived label but must not maintain an independent copy of the phase
mapping.

This rule does not prohibit a separate optional `campaign_phase` field used for
a GM-defined narrative label. Such a label is not part of the Day/Night calendar
and must not be used to store derived time-phase names.

## Validation

Use Zod at every external input boundary.

Validation occurs:

- In the browser for immediate feedback where useful
- Again on the server for every submitted mutation
- In PostgreSQL through constraints for persistent invariants

Client validation is not a security boundary.

## Authentication

Use Supabase Authentication.

Initial requirements:

- One authenticated owner per campaign
- No anonymous campaign access
- No public sign-up flow unless explicitly added
- No service-role credentials in browser code
- Session checks in protected server routes
- Middleware may be used to refresh sessions, but authorization still occurs at
  the data and mutation layer

The confirmed authentication method is Supabase email-and-password
authentication for a single private Game Master account. There is no public
registration UI; the initial user is created manually through Supabase. Magic
links, social login, player accounts, and multiple roles are out of scope. See
resolved `OQ-PROD-001` in `open-questions.md`.

## Authorization

All campaign-owned tables must use Row-Level Security.

The initial rule is:

- A user can access a campaign only when `campaigns.owner_id = auth.uid()`.

Related records are authorized through their parent campaign.

Do not rely only on hidden UI controls or route protection.

## Database access

Database access should be divided into:

- Read functions
- Single-record mutations
- Compound transactional operations

Prefer typed data-access functions under `lib/supabase` or a dedicated
`lib/data` directory if the repository later introduces one.

Do not scatter direct Supabase queries throughout presentation components.

## Transactions

Use PostgreSQL transactions or database functions for operations that affect
more than one record or derived total.

Transactional operations include:

- Adjusting Fear while recording a Fear event
- Advancing a countdown while recording a countdown event
- Completing a countdown and applying a configured effect
- Advancing campaign weeks
- Applying weekly food consumption
- Transferring inventory
- Transferring food
- Undoing a compound operation

A compound operation must either complete fully or make no persistent changes.

## Idempotency

Operations that may be retried must accept or generate an idempotency key.

At minimum, use idempotency protection for:

- Week advancement
- Food consumption tied to week advancement
- Countdown completion effects
- Inventory transfers
- Import operations

A retried request must not apply the same effect twice.

## Event history

Important state changes must create event or transaction records.

Current totals may be stored for fast reads, but event history remains the audit
source of truth.

Do not silently rewrite historical events to correct mistakes. Use correction or
compensating events unless a documented administrative repair is required.

## Error handling

Use structured application errors.

Errors should distinguish:

- Validation failure
- Authentication failure
- Authorization failure
- Not found
- Conflict
- Invariant violation
- Retryable infrastructure failure
- Unexpected internal error

User-facing errors must be actionable and must not expose secrets, SQL, tokens,
or private campaign content.

## Logging

Log:

- Error category
- Operation name
- Request correlation identifier
- Campaign identifier when safe
- Duration
- Retry information

Do not log:

- Authentication tokens
- Service credentials
- Full private GM notes
- Complete character biographies
- Full rulebook or SRD content

## UI architecture

The dashboard is the primary operational surface.

Prefer:

- Server-rendered summaries
- Focused interactive controls
- Large tablet-friendly targets
- Inline actions for frequent operations
- Dedicated pages for history and detailed editing

Avoid:

- Deep nested navigation
- Routine actions hidden behind several dialogs
- Decorative animation that delays interaction
- A global client-side store without a demonstrated need

## State management

Prefer:

1. Server state
2. URL state
3. Local component state

Do not add a global state-management library unless a concrete cross-page state
problem cannot reasonably be solved with the existing approach.

## Testing architecture

### Unit tests

Use Vitest for:

- Domain rules
- Validation schemas
- Boundary conditions
- Pure calculations
- Undo and correction planning

### Integration tests

Use integration tests for:

- Database functions
- RLS behavior
- Transactions
- Idempotency
- Constraint enforcement

### End-to-end tests

Use Playwright for critical workflows:

1. Sign in and open a campaign.
2. Adjust Fear and verify history.
3. Create and advance a countdown.
4. Advance campaign weeks with preview and confirmation.
5. Edit a character.
6. Transfer inventory.
7. Consume or transfer food.
8. Undo an eligible operation.

## Deployment

Initial recommended deployment:

- Web application: Vercel
- Database and authentication: Supabase

Deployment requirements:

- Environment variables documented in `.env.example`
- No private reference files included in the build
- Database migrations applied before incompatible application code
- Production build must pass locally or in CI
- RLS must be enabled in the deployed database
- Service-role credentials must remain server-only

The application must not require files inside `.reference-private/` at runtime.

## Environment variables

Expected variables may include:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Only add `SUPABASE_SERVICE_ROLE_KEY` if a server-only administrative operation
requires it. Prefer normal user-scoped access through RLS.

Do not commit `.env` or `.env.local`.

## Migration policy

All schema changes require migration files in `supabase/migrations`.

Rules:

1. Do not modify a migration already applied to a shared or production database.
2. Create a new migration for every subsequent schema change.
3. Review destructive changes before applying them.
4. Include data migration steps when changing stored representations.
5. Test migrations from a clean local database.
6. Update `data-model.md` with every schema change.

## Security boundaries

The application must:

- Validate all inputs
- Enforce authorization through RLS and server checks
- Escape or safely render user-supplied text
- Avoid arbitrary code execution in custom mechanics
- Avoid exposing private notes in public or unauthenticated routes
- Keep secrets out of client bundles
- Avoid copying protected source material into public assets

## Architectural non-goals

Do not introduce during the initial phases:

- Microservices
- Message queues
- Kubernetes
- A custom authentication system
- GraphQL
- Event-stream infrastructure
- Arbitrary plugin execution
- Real-time multiplayer synchronization
- A separate native mobile application

## Architecture decisions to confirm

Track unresolved decisions in `open-questions.md`, including:

- Supabase authentication method
- Whether the application supports one or multiple campaigns initially
- Whether real-time subscriptions are needed
- Whether offline read access is required
- Whether current totals are trigger-maintained or function-maintained
- Whether deployment begins immediately or after local MVP completion
