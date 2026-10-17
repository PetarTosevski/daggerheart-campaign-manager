# Best practices (binding)

Decided 2026-10-18 from four audits (`.omc/audit/convex-data.md`, `convex-functions.md`, `client.md`, `testing-code-health.md`). Binding for every agent and human, next to `AGENTS.md` and `docs/workflow.md`. Where this file and an audit disagree, this file wins.

Each rule: the rule, then **Why** · source · **Enforced by** (lint rule / test / config / review). A rule enforced by a tool that is not installed yet names the tracer in `.omc/plans/hardening.yaml` that adds it; until then, review enforces it.

## Top 15 rules (paste into AGENTS.md / CLAUDE.md)

1. Every client-callable Convex function is `userQuery` / `userMutation` / `userAction` (or a campaign wrapper built on them) from `convex/lib/functions.ts`. Raw `query`/`mutation`/`action` appear only in that file, `convex/auth.ts` and `convex/http.ts`; `internal*` functions are exempt.
2. Campaign and GM access is decided only by `permissionFor` (wrapper option `need: "view" | "edit" | "owner"`). No role checks anywhere else.
3. Identify the caller from `ctx.auth` (via the wrapper's `ctx.user`), never from an argument and never from an unverified email.
4. Every public function has an `args` validator with no `v.any()`. No stored field is `v.any()` (only exception: `operations.result`). Player-facing queries declare a `returns` validator.
5. Queries on growing tables use `.withIndex()`. No `.filter()` on database queries; `.collect()` only on provably small results, otherwise `.take()`, `.paginate()` or a counter.
6. Growing collections are their own table with a back-reference index, never an array inside one document. Fields that change often live outside documents that many queries read.
7. Every JSON blob that is not yet a typed validator carries `schemaVersion`. Change a shape by widen → migrate (`@convex-dev/migrations`, batched) → narrow; never edit a validator in place.
8. Every table that only grows (idempotency records, soft-deleted campaigns, orphan uploads) has an internal, batched, self-rescheduling cleanup cron in `convex/crons.ts`.
9. Throw `ConvexError<AppError>` with an object payload `{ code, message? }` from `src/lib/errors/*`. Convert only `RuleError` and `ZodError`; let programming errors throw.
10. Uploads: issue URLs only from access-checked, rate-limited mutations; after upload check size and an explicit type allowlist (png/jpeg/webp/gif); delete rejected files; never accept a storage id as proof of access.
11. Wrap every `useQuery` subtree in an error boundary; every route segment has `error.tsx`, the root has `global-error.tsx`.
12. Mutations send intents (delta, id, single field), never a client-computed snapshot of a whole object; add an optimistic update wherever a click has visible latency.
13. Never fire mutations from effects, never copy props into state in effects, never `key=` a subtree on live content.
14. Every public Convex function appears in `tests/convex/authz-matrix.test.ts` for anonymous, outsider, player and GM. Tests assert `ConvexError.data.code`, never message text.
15. Work in tracer bullets in worktrees (`docs/workflow.md`): change only your tracer's `owns`, and run lint, typecheck and tests before handoff. New lint rules land as warnings and are raised to errors once they are clean.

---

## 1. Convex schema & data

**CD1. Give every stored field a real Convex validator; no `v.any()` except `operations.result`.**
Why: `v.any()` turns off Convex's deploy-time check of existing documents. · https://docs.convex.dev/database/schemas · Enforced by: `no-restricted-syntax` (`v.any`) + `tests/convex/schema-guard.test.ts`.

**CD2. Until a blob is converted, read it only through `parseOrCorrupt(schema, raw, code)` (`convex/lib/blobs.ts`), which throws `*_CORRUPT`. Never `row.data as T` and never a bare `.parse()`.**
Why: unchecked casts let bad data reach domain code, and raw `ZodError`s show users "Something went wrong". · https://stack.convex.dev/typescript-zod-function-validation · Enforced by: review + a corrupt-data test per reader.

**CD3. Every JSON blob carries `schemaVersion: v.number()`, and its reader dispatches on it.**
Why: without a version you cannot migrate or read old and new shapes side by side. · https://stack.convex.dev/intro-to-migrations · Enforced by: review + migration test (TE5).

**CD4. Change a shape by widen (new field or union) → migrate → narrow. Tighten with `.staged()` plus `npx convex deploy --dry-run`. Push schema separately from code.**
Why: changing a validator in place fails the deploy, or breaks reads, on existing documents. · https://docs.convex.dev/database/schemas · Enforced by: review.

**CD5. Write data migrations with `@convex-dev/migrations` in `convex/migrations/<domain>.ts`: batched, resumable, dry-run first. Never one mutation that `.collect()`s a table.**
Why: whole-table mutations hit transaction limits on real data. · https://www.convex.dev/components/migrations · Enforced by: review + `@convex-dev/no-collect-in-query`.

**CD6. Store references as `v.id("table")` / `v.id("_storage")` fields, never as strings inside JSON or encoded keys (`character:<id>:extra`).**
Why: only fields can be validated and indexed. · https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas · Enforced by: review.

**CD7. Turn client or JSON strings into ids with `ctx.db.normalizeId(table, s)`; never `as Id<...>`.**
Why: `db.get` on a non-id string throws and fails the whole query. · https://docs.convex.dev/database/document-ids · Enforced by: `no-restricted-syntax` (`TSAsExpression > TSTypeReference[typeName.name='Id']`).

**CD8. Embed an array only when it is small and hard-capped (tens of items). Growing children get their own table, with a back-reference field and an index on it.**
Why: arrays cannot be indexed, and every edit rewrites the whole document. · https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas · Enforced by: review + doc-size test (CD9).

**CD9. Keep the worst-case document under 512 KB (hard limits: 1 MiB per document, 8,192 elements per array, depth 16).**
Why: the 1 MiB limit is hard, and large documents multiply bandwidth on every re-run. · https://docs.convex.dev/production/state/limits · Enforced by: `tests/convex/doc-size.test.ts`.

**CD10. Keep frequently written fields (open times, counters) out of documents that many queries read. Split hot state into per-item documents.**
Why: each write re-runs every subscribed query that read the document, and concurrent writes conflict under OCC. · https://stack.convex.dev/queries-that-scale ; https://docs.convex.dev/error · Enforced by: review.

**CD11. Read growing tables with `.withIndex()` ranges. No `.filter()` on database queries: put conditions such as `deletedAt` in the index, or filter the already bounded result in TypeScript.**
Why: `.filter` scans and widens the read set. · https://docs.convex.dev/understanding/best-practices/ · Enforced by: `@convex-dev/no-filter-in-query`.

**CD12. Use `.collect()` only on provably small results. Otherwise use an index range, `.take(n)`, `.paginate()` with `usePaginatedQuery`, or a counter. Any disable needs a one-line reason.**
Why: unbounded reads grow cost and OCC conflicts with the data. · https://docs.convex.dev/database/pagination · Enforced by: `@convex-dev/no-collect-in-query` (warn).

**CD13. Mutations read only the documents they need.**
Why: every document read joins the read set and can force a retry. · https://docs.convex.dev/database/advanced/occ · Enforced by: review + read-cost tests (TE6).

**CD14. For counts or sums over large sets, keep a counter document or use `@convex-dev/aggregate`; never `.collect().length`.**
Why: a count should not read every row. · https://www.convex.dev/components/aggregate · Enforced by: review.

**CD15. Delete an index that is a field-prefix of another index on the same table, and never list `_creationTime` in an index.**
Why: it is redundant write cost. · https://docs.convex.dev/database/reading-data/indexes/ · Enforced by: `@convex-dev/no-duplicate-indexes` + schema-guard test.

**CD16. Pass the table name to `ctx.db.get/patch/replace/delete` (for example `ctx.db.get("characters", id)`).**
Why: it is the documented API; the plugin autofixes it. · https://docs.convex.dev/understanding/best-practices/ · Enforced by: `@convex-dev/explicit-table-ids`.

**CD17. Give every table that only grows a retention policy in `convex/crons.ts`: an internal mutation that deletes in bounded batches, reschedules itself with `ctx.scheduler.runAfter`, and is not pinned to minute 0.**
Why: storage otherwise grows forever. · https://docs.convex.dev/scheduling/cron-jobs · Enforced by: schema-guard retention list + `@convex-dev/no-top-of-hour-crons`.

**CD18. A soft delete opens a 30-day undo window; then a purge removes every row with that `campaignId`, plus its storage blobs.**
Why: user data must actually go away, and storage must not grow forever. · https://docs.convex.dev/scheduling/scheduled-functions · Enforced by: `tests/convex/cleanup.test.ts`.

**CD19. Define validators once in `convex/lib/validators/<domain>.ts` (hand-written, or derived from zod with convex-helpers `zodToConvex`) and derive client types with `Infer<>`. Keep zod only for cross-field rules.**
Why: parallel schemas drift. · https://stack.convex.dev/argument-validation-without-repetition · Enforced by: review.

**CD20. Each domain's tables live in `convex/tables/<domain>.ts`. `convex/schema.ts` only composes them, and every schema change is reflected in `docs/data-model.md`.**
Why: tracers can then own their tables without merge conflicts. · `docs/workflow.md` · Enforced by: `scripts/tracer-guard.mjs` + review.

## 2. Convex functions & security

**CF1. Every client-callable function uses `userQuery` / `userMutation` / `userAction`, `maybeUserQuery`, or a campaign wrapper from `convex/lib/functions.ts`. Raw builders are allowed only there, in `convex/auth.ts` and in `convex/http.ts`; `internalQuery/Mutation/Action` are exempt.**
Why: one blessed builder per role means authorization cannot be forgotten. · https://stack.convex.dev/custom-functions · Enforced by: `no-restricted-imports` (**warning**, by decision) + `tests/convex/authz-matrix.test.ts`. `convex/` must have zero warnings.

**CF2. Decide campaign and GM access only with `permissionFor`, through the wrapper's `need` option (strongest of campaign role and grants). No role checks in handlers, and no second authorization model.**
Why: two models diverge; today an `edit` grant on a character does not reach its extras. · https://stack.convex.dev/authorization · Enforced by: review + authz matrix.

**CF3. Take identity only from `ctx.auth`, through the wrapper's `ctx.user`. Never authorize by a client-sent value or by an email without `emailVerificationTime`.**
Why: anyone can register a password account with an invited, unverified email. · https://docs.convex.dev/understanding/best-practices/#use-some-form-of-access-control-for-all-public-functions · Enforced by: `tests/convex/invite-verification.test.ts`.

**CF4. Handlers use the already-authorized `ctx.user`, `ctx.campaign` and `ctx.permission`, never ids re-read from `args`.**
Why: it prevents authorizing one resource and then acting on another. · https://stack.convex.dev/custom-functions · Enforced by: review.

**CF5. Give every public function an `args` validator with no `v.any()`. Describe the shape with `v.object`/`v.union` or generate it from zod.**
Why: `v.any()` accepts 16 MiB of anything, and its type is `any` to callers. · https://docs.convex.dev/functions/validation · Enforced by: `@convex-dev/require-args-validator` + `no-restricted-syntax` (`v.any` in `args`).

**CF6. Give player-facing queries a `returns` validator, using a union for GM and player shapes.**
Why: a stray `...doc` spread would otherwise leak GM notes or emails without any error. · https://docs.convex.dev/functions/validation · Enforced by: `scripts/check-returns.mjs` (warn) + review.

**CF7. Await every promise (`ctx.db`, `ctx.storage`, `ctx.scheduler`).**
Why: an unawaited call may never run, or may fail silently. · https://docs.convex.dev/understanding/best-practices/#await-all-promises · Enforced by: `@typescript-eslint/no-floating-promises`.

**CF8. Share code as plain helpers in `convex/lib`. No `ctx.runQuery`/`ctx.runMutation` inside queries or mutations. Actions batch into one `runQuery` and one `runMutation`.**
Why: each `ctx.run*` call is a separate transaction. · https://docs.convex.dev/understanding/best-practices/#use-helper-functions-to-write-shared-code · Enforced by: review.

**CF9. Schedule and `ctx.run*` only `internal.*` functions, crons included.**
Why: public functions re-check auth and are callable by anyone. · https://docs.convex.dev/understanding/best-practices/#only-schedule-and-ctxrun-internal-functions · Enforced by: review.

**CF10. No `Date.now()` in queries. Pass a coarse time as an argument, or store a flag that a scheduled function flips.**
Why: it breaks query caching and reactivity. · https://docs.convex.dev/understanding/best-practices/#date-in-queries · Enforced by: review.

**CF11. Keep mutations deterministic, with no side effects outside the transaction, and call them once per user action (no loops from the client or from actions).**
Why: OCC retries them, and each call is its own transaction. · https://docs.convex.dev/database/advanced/occ · Enforced by: review.

**CF12. Keyed mutations go through the wrapper's idempotency hook (`ctx.once`). A replay is bound to `createdBy`, and the request is stored as a SHA-256 hash, not as raw JSON.**
Why: it removes about 60 copies of boilerplate and stops cross-user replays. · `AGENTS.md` (Data and history rules) · Enforced by: `tests/convex/functions.test.ts`.

**CF13. Throw `ConvexError<AppError>` with an object payload `{ code: AppErrorCode, message? }`. Codes live in `src/lib/errors/*`, shared with the client. Never use string payloads.**
Why: production redacts other errors, and two payload shapes break client mapping. · https://docs.convex.dev/functions/error-handling/application-errors · Enforced by: typecheck (`AppErrorCode` union) + review.

**CF14. Convert only `RuleError` (thrown from `src/lib/domain/**`) and `ZodError` into `ConvexError`. Rethrow everything else.**
Why: a `TypeError` must surface as a bug, not as a user message. · https://docs.convex.dev/functions/error-handling/application-errors · Enforced by: `tests/convex/functions.test.ts`.

**CF15. Rate-limit abusable endpoints with the wrapper's `rateLimit` option (`@convex-dev/rate-limiter`): upload URLs, `joinByCode`, campaign create and invites now; password sign-up before the allowlist opens.**
Why: Convex Auth limits only failed sign-ins. · https://www.convex.dev/components/rate-limiter · Enforced by: review.

**CF16. Issue upload URLs only from access-checked mutations. After upload, go through `acceptUpload`: check size and an explicit type allowlist (png/jpeg/webp/gif; never `image/*`, never SVG). Delete a rejected file and *return* `{ ok: false, code }` (throwing would roll back the delete).**
Why: upload URLs enforce no size limit, and the content type is whatever header the client sent. · https://docs.convex.dev/file-storage/upload-files · Enforced by: `tests/convex/upload-claims.test.ts`.

**CF17. Never accept a storage id as proof of access. Resolve it through its `files` row (`kind`/`refId`).**
Why: storage ids are just strings. · https://docs.convex.dev/file-storage/serve-files · Enforced by: review + upload-claims test.

**CF18. Treat `getUrl` links as permanent bearer links: hiding an image does not revoke them (an accepted risk). Use an authenticated `httpAction` wherever revocation matters.**
Why: they cannot be revoked short of deleting the file. · https://docs.convex.dev/file-storage/serve-files · Enforced by: review.

**CF19. Read environment variables through the typed `env` from `_generated/server`, inside handlers, never at module scope. Secrets never go behind `NEXT_PUBLIC_`.**
Why: typos fail silently, and module-scope reads are frozen at deploy time. · https://docs.convex.dev/production/environment-variables · Enforced by: `@convex-dev/no-process-env` (`auth.config.ts` exempt).

**CF20. Seed and test accounts exist only on e2e/local deployments, and sign-up errors never reveal whether an email is allowlisted or registered.**
Why: known passwords in prod, and account enumeration. · https://docs.convex.dev/understanding/best-practices/ · Enforced by: `tests/unit/allowlist.test.ts` + `tests/convex/create-or-update-user.test.ts`.

**CF21. Keep `"use node"` files to actions only, and never import them from non-Node files.**
Why: wrong-runtime imports break bundling. · https://docs.convex.dev/functions/runtimes · Enforced by: `@convex-dev/import-wrong-runtime`.

**CF22. Treat Next.js proxy and UI redirects as UX only; the Convex function is the gate.**
Why: the client can skip them. · https://stack.convex.dev/authorization · Enforced by: review.

## 3. Client (Next.js / React / Convex React)

**CL1. Wrap every `useQuery` subtree in an error boundary (one per dashboard panel). Add `error.tsx` per route segment (using the `retry` prop) and a root `global-error.tsx`.**
Why: Convex throws query errors at the `useQuery` call site, so one corrupt tracker blanks the app. · https://docs.convex.dev/functions/error-handling/ ; https://nextjs.org/docs/app/api-reference/file-conventions/error · Enforced by: `tests/e2e/error-boundary.spec.ts`.

**CL2. `useQuery` returning `undefined` means loading and `null` means "none"; pass `"skip"` for conditional queries. Loading UI is the shared `<Loading>` with `role="status"`.**
Why: it keeps states consistent and announces loading to screen readers. · https://docs.convex.dev/client/react · Enforced by: review + axe (TE13).

**CL3. Send intents (a delta, an id, a single field), never a client-computed snapshot of a whole object or array.**
Why: Convex serialises server-side read-modify-write, but a stale client snapshot silently reverts concurrent edits. · https://docs.convex.dev/database/advanced/occ · Enforced by: `tests/convex/character-intents.test.ts` + review.

**CL4. Add `.withOptimisticUpdate` wherever a click has visible latency. Check `getQuery(...) !== undefined` first, never mutate store objects, and share updaters per query (`src/lib/optimistic/*`).**
Why: double clicks otherwise send the same value twice. · https://docs.convex.dev/client/react/optimistic-updates · Enforced by: RTL test (double-click "+" gives +2).

**CL5. Preload above-the-fold data in the Server Component layout with `preloadQuery(..., { token: await convexAuthNextjsToken() })` plus `usePreloadedQuery`, at most one per page.**
Why: it removes the shell-then-children request waterfall. · https://docs.convex.dev/client/nextjs/app-router/server-rendering · Enforced by: review.

**CL6. Never fire mutations from effects to initialise data. Do it on the server (for example in `campaigns.create`) or in an event handler.**
Why: it races across tabs and StrictMode, and turns reads into writes. · https://react.dev/learn/you-might-not-need-an-effect · Enforced by: review checklist.

**CL7. Never copy props into state in an effect: derive during render. Reset with `key` only on identity (`characterId`), never on content (`key={value}`, `key={JSON.stringify(state)}`). Text inputs re-sync only while unfocused (`useBlurField`).**
Why: content keys remount inputs on every live update and wipe typing. · https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes · Enforced by: `react-hooks/set-state-in-effect` + review.

**CL8. Load per-frame code (trackers, extras panels, tomes) with `next/dynamic` / `import()`. Check shared-module changes with `next experimental-analyze`.**
Why: only one frame applies per campaign. · https://nextjs.org/docs/app/guides/lazy-loading · Enforced by: review + recorded analyze numbers.

**CL9. In `src/app` and `src/components`, import SRD leaf modules (`@/lib/srd/classes`), never the `@/lib/srd` barrel. Read-only cards get display fields from the server.**
Why: the lookup helpers close over the full arrays (~370 KB), so tree-shaking cannot drop them. · https://nextjs.org/docs/app/building-your-application/optimizing/package-bundling · Enforced by: `no-restricted-imports` (`@/lib/srd`).

**CL10. Render art with `next/image` (`sizes`; `priority`/`preload` for the LCP image), never CSS `backgroundImage`. Every design asset over 500 KB needs a webp/avif sibling, and `/design-assets/*` is served `immutable`.**
Why: CSS backgrounds skip resizing, modern formats and lazy loading. · https://nextjs.org/docs/app/api-reference/components/image · Enforced by: `no-restricted-syntax` (`backgroundImage`) + `scripts/check-image-weight.mjs`.

**CL11. Keep `"use client"` at the leaves.**
Why: Server Components ship no client JS. · https://nextjs.org/docs/app/getting-started/server-and-client-components · Enforced by: review.

**CL12. Build modals on native `<dialog>` with `showModal()` (`src/components/brand/modal.tsx`), with the padding on an inner wrapper.**
Why: the browser gives focus containment, Escape and focus return; padding on the `<dialog>` turns clicks inside it into backdrop clicks. · https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog · Enforced by: axe e2e + review.

**CL13. Never nest interactive controls inside a `role="button"` element; use real `<button>`s as siblings.**
Why: screen readers announce nested controls inconsistently. · https://dequeuniversity.com/rules/axe/4.10/nested-interactive · Enforced by: `jsx-a11y/recommended` + axe.

**CL14. Use stable ids as list keys, never indexes. Respect `prefers-reduced-motion`. Move focus with refs, not timers, and clear timers on unmount.**
Why: index keys move focus and state after a removal. · https://react.dev/learn/rendering-lists · Enforced by: review.

**CL15. Give every route a meaningful `<title>`.**
Why: tabs and screen readers rely on it. · https://nextjs.org/docs/app/api-reference/functions/generate-metadata · Enforced by: review.

## 4. Testing

**TE1. Run Convex tests with convex-test under `edge-runtime`, passing `schema` and the shared `import.meta.glob` modules. Assert `ConvexError.data.code` (`expectConvexError`), never message text or id formats.**
Why: messages and id formats change, codes are the contract. · https://docs.convex.dev/testing/convex-test · Enforced by: review.

**TE2. Cover every public function for `anon`, `outsider`, `player` and `gm` in `tests/convex/authz-matrix.test.ts`, whose guard enumerates `api` and fails on any missing function.**
Why: a missing access check is the riskiest bug, and lint cannot see it. · https://docs.convex.dev/testing/convex-test · Enforced by: the guard test.

**TE3. Shared setup (`makeUsers`, `setupWithCampaign`, `expectConvexError`, character drafts) lives in `tests/convex/helpers.ts` and `tests/fixtures/*`; no per-file user inserts or GM constants.**
Why: the copies drift. · https://vitest.dev/guide/test-context · Enforced by: review.

**TE4. Test size- and time-limit paths on the local backend; convex-test enforces neither.**
Why: those limits are not simulated. · https://docs.convex.dev/testing/convex-backend · Enforced by: review.

**TE5. Every blob version bump ships a migration test (old shape in, new shape out, or both readable).**
Why: CD3/CD4 depend on it. · https://stack.convex.dev/intro-to-migrations · Enforced by: review.

**TE6. Hot list queries (`codex.list`, map reads, `permissionFor`) have a read-cost budget test that counts documents and bytes read.**
Why: read-cost regressions are invisible until production. · https://docs.convex.dev/production/state/limits · Enforced by: the budget tests.

**TE7. e2e signs in once per role in a `setup` project and reuses `storageState`; only `auth.spec.ts` drives the sign-in form.**
Why: speed, and Convex Auth's JWT lives in localStorage, which `storageState` captures. · https://playwright.dev/docs/auth · Enforced by: review.

**TE8. e2e runs `fullyParallel`, with per-worker accounts or unique data (`crypto.randomUUID()` or `workerIndex`, never `Date.now()`).**
Why: parallel runs collide otherwise. · https://playwright.dev/docs/test-parallel · Enforced by: `playwright.config.ts`.

**TE9. Shared flows (create campaign, join as player, seed a character through `ConvexHttpClient`) are fixtures in `tests/e2e/fixtures.ts`. The UI is used only for the behaviour under test.**
Why: one UI change today means editing 13 specs. · https://playwright.dev/docs/test-fixtures · Enforced by: review.

**TE10. Use role/label locators scoped to a container (no `.first()`/`.last()`/`.nth()`), web-first assertions, and no `waitForTimeout`.**
Why: flakiness. · https://playwright.dev/docs/best-practices · Enforced by: `eslint-plugin-playwright` (`no-nth-methods`, `prefer-web-first-assertions`, `no-wait-for-timeout`, `missing-playwright-await`, `no-focused-test`).

**TE11. Use `trace: "retain-on-failure"`, and the `github` reporter on CI.**
Why: a local failure should leave a trace without retries. · https://playwright.dev/docs/trace-viewer · Enforced by: `playwright.config.ts`.

**TE12. Unit-test pure domain rules and zod schemas. Regression-test lost updates (two intents from one stale snapshot) and double clicks (RTL).**
Why: these are the bugs the audits found. · https://docs.convex.dev/testing/convex-test · Enforced by: review.

**TE13. Run axe on the title menu, dashboard, sheet, codex with the lightbox open, and world: zero serious or critical violations.**
Why: static lint misses nested-interactive and focus issues. · https://playwright.dev/docs/accessibility-testing · Enforced by: `tests/e2e/a11y.spec.ts`.

**TE14. Measure coverage on `convex/**` and `src/lib/**` (`pnpm test:coverage`, with thresholds).**
Why: gaps should not be found only by grep. · https://vitest.dev/guide/coverage · Enforced by: vitest thresholds.

## 5. Code health & tooling

**CH1. Compile with `strict` plus `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and `noImplicitOverride`, in both tsconfigs.**
Why: SRD and tracker indexing is the main source of `undefined` bugs. · https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess · Enforced by: `pnpm typecheck`.

**CH2. Typed lint (`projectService: true`): `no-floating-promises`, `no-misused-promises` (`checksVoidReturn.attributes: false`), `switch-exhaustiveness-check` and `no-unnecessary-type-assertion`.**
Why: they catch real bugs today (2 floating promises, 1 non-exhaustive switch). · https://typescript-eslint.io/getting-started/typed-linting/ · Enforced by: typescript-eslint.

**CH3. Apply `@convex-dev/eslint-plugin` recommended (plus `no-collect-in-query` as warn) to `convex/**`.**
Why: it locks in CD11–CD16, CF5 and CF19. · https://docs.convex.dev/eslint · Enforced by: the plugin.

**CH4. A new lint rule lands as a warning in a wave's T0 and is raised to error once its tracers make it clean. The raw-builder rule (CF1) stays a warning by decision, but `convex/` must have zero hits.**
Why: it avoids red builds mid-wave. · `docs/workflow.md` · Enforced by: CI lint.

**CH5. Shared constants (byte limits, error codes, upload types) live in one framework-free module that client and Convex both import.**
Why: `MAX_MAP_BYTES` is defined twice today. · https://docs.convex.dev/understanding/best-practices/#use-helper-functions-to-write-shared-code · Enforced by: review + knip.

**CH6. Pure logic lives in framework-free `src/lib/**` (domain, validation, frames, srd, characters) with relative imports, never in route folders.**
Why: Convex bundles it, and tests should not import from `src/app`. · `AGENTS.md` (Architectural boundaries) · Enforced by: `no-restricted-imports` (extend the file list when adding modules).

**CH7. Reuse before writing: one helper per concern (`acceptUpload` / `uploadToConvex`, `useRun`, `useBlurField`, `frameTrackerMutation`, character display helpers).**
Why: three upload pipelines and two `ancestryLabel`s have already drifted. · https://docs.convex.dev/understanding/best-practices/#use-helper-functions-to-write-shared-code · Enforced by: review.

**CH8. Keep `knip` clean: no unused files, exports or dependencies (every intentional entry listed in `knip.json` with a reason).**
Why: dead code misleads agents. · https://knip.dev/ · Enforced by: knip in CI.

**CH9. Keep logic files under 800 lines (data tables exempt), and split UI files as they approach that size.**
Why: reviewability. · `AGENTS.md` · Enforced by: review.

**CH10. `AGENTS.md` is the one authoritative agent file; `CLAUDE.md` points to it; `README.md` matches the real stack (Convex, Convex Auth).**
Why: README still describes Supabase. · https://agents.md/ · Enforced by: review.

**CH11. New dependencies respect pnpm `minimumReleaseAge`; no new backend, ORM, state, form or component library without approval.**
Why: supply-chain risk and stack sprawl. · `AGENTS.md` (Approved technology stack) · Enforced by: pnpm config + review.

## 6. Workflow

Build in tracer bullets in git worktrees, with plans in `.omc/plans/<plan>.yaml`, exclusive `owns` per wave, and orchestrator-only merges. See **`docs/workflow.md`**. The hardening work that applies this rulebook is `.omc/plans/hardening.yaml`.

## Resolved contradictions between the audits

| Topic | Conflict | Resolution |
|---|---|---|
| Zod vs Convex validators | data audit: convert to Convex validators; testing audit: keep validating blobs with zod (`parseOrCorrupt`); functions audit: `zodToConvex` / `zCustomMutation` | Convex validators are the target for storage and args (CD1, CF5, CD19), hand-written or derived with `zodToConvex`. `parseOrCorrupt` is the interim reader until a blob is converted (CD2). Zod stays for cross-field domain rules only. |
| Hard delete | `docs/data-model.md`: "nothing is hard-deleted"; data audit: purge soft-deleted campaigns | 30-day undo window, then purge (CD18). `docs/data-model.md` is updated by the cleanup tracer. |
| `operations` as history | `docs/data-model.md`: operations are "the trail of applied changes"; data and functions audits: expire after 7 days; client audit: question whether idempotency is worth it | `operations` is an idempotency cache with a 7-day TTL (CD17), still required by AGENTS.md. Any history AGENTS.md requires (Fear, time, corrections) must live in explicit event tables, never in `operations`. |
| `markOpened` | data audit: move to its own row; client audit: fine, just throttle | Both: a separate `campaignOpens` row **and** a 5-minute server throttle (CD10). |
| Raw-builder lint severity | functions audit: `no-restricted-imports` as error; data audit: `require-access-control` as error | Standing decision: **warning** on raw builders (CF1). `require-access-control` is not enabled, because the wrapper rule plus the authz matrix (TE2) cover it. |
| Upload rejection | CF13 says throw `ConvexError`; `files` code returns `{ok:false}` | Rejected uploads *return* `{ ok: false, code }`, because a throw would roll back the blob delete (CF16). Everything else throws. |
| `key=` resets | client rule "reset with `key`" vs finding "`key={value}` wipes typing" | Key on identity, never on live content (CL7). |
| Whole-map document | functions audit: fine for one GM; data audit: split | Split into rows. The app is now multi-user, and the document sits about 10% under the 1 MiB limit (CD8, CD9). |
| `getUrl` revocation | fix with an `httpAction` vs accept | Accepted and documented for now (CF18). An `httpAction` is required only where revocation matters. |
| Tracker cast fix | lint ban on casts vs removing `readTracker<T>` | Remove the generic signature (CD2); the cast ban in CD7 covers ids. |
| Effort scales | XS/S/M/L vs S/M/L | The plan uses S/M/L (XS folded into S). |
