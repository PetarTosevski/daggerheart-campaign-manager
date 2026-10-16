# Deep Interview Spec: Daggerheart Campaign Manager Rebuild

## Metadata
- Interview ID: dcm-rebuild-20261015
- Rounds: 13 (plus Round 0 topology)
- Final Ambiguity Score: 20% (19.9%)
- Type: brownfield (rebuilt in place on branch `rebuild`)
- Generated: 2026-10-16
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED, except the Visual overhaul component, which is **pending references**
- Approval: **pending approval**

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.35 | 0.298 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria | 0.75 | 0.25 | 0.188 |
| Context Clarity | 0.78 | 0.15 | 0.117 |
| **Total Clarity** | | | **0.801** |
| **Ambiguity** | | | **0.199** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| Campaign picker | active | Pick a campaign frame, then pick or create a campaign in it | Frames built into code; acceptance criteria below |
| Core systems | active | Core mechanics in every campaign + frame-exclusive mechanics | First slice covered; later mechanics need their own interview rounds |
| Visual overhaul | active, **pending references** | New design language | User is building references in Claude Design; resume visual questions when shared. Not plannable yet |
| Platform & hosting | active | Convex + Convex Auth + Next.js on Vercel | Covered |
| Repo sweep | active | Archive old app, keep selected logic, docs and PDFs | Covered |

## Goal
Rebuild the Witherwild-only campaign tool into a **live-play GM console** for Daggerheart. The user signs in, picks a **campaign frame**, then picks or creates a **campaign** in that frame. Opening a campaign lands on a table view for running play. Mechanics are either **core** (every campaign) or **frame-exclusive** (switched on by the campaign's frame). The first usable slice runs a Witherwild campaign with Fear, countdowns and Witherwild campaign time.

## Mechanics classification
| Mechanic | Scope | In first slice | Notes |
|----------|-------|----------------|-------|
| Fear | Core | Yes | Port as-is |
| Countdowns | Core | Yes | Port as-is |
| Rests & downtime moves | Core; frames can add frame-specific moves | No | Details to be specified by the user before design |
| Session log | Core | No | Details to be specified by the user |
| Adversaries & encounters | Core | No | Details to be specified by the user |
| Campaign time (weeks + DAY/NIGHT cycle, 7 named phases each) | Witherwild-exclusive | Yes | Port as-is |

Rule for all work: any mechanic not yet specified must be raised with the user (core or frame-exclusive, and how it works) before it is designed.

## Constraints
- Single GM user for now; small chance of becoming a public product later. Do not make choices that would block multi-user later (e.g. every record has an owner), but build no multi-user features.
- Database: **Convex**. Domain rules move from Postgres functions into Convex mutations; compound operations stay transactional and idempotent.
- Auth: **Convex Auth** with Google/GitHub OAuth, sign-ups locked to the GM's account.
- Front end: Next.js (App Router, TypeScript strict), hosted on Vercel free tier.
- Frames ship in code (Witherwild + a plain "Core only" frame). New frames are development tasks, not in-app content.
- Must work well on a tablet and laptop during live play; live updates across devices.
- Keep both PDFs: `reference/daggerheart-srd.pdf`, `reference/official/Daggerheart - Gillus - Character Sheets US.pdf`.
- The `witherwild-final` tag preserves the old app; nothing is lost.

## Non-Goals
- Character records, character sheets and sheet templates
- Food, inventory, weights and other Witherwild survival tracking
- In-app frame builder or custom frames
- Player accounts, sharing, multiplayer, public sign-up
- Virtual tabletop features or a rules compendium
- Rests/downtime, sessions and adversaries in the first slice (they come next, one at a time)
- Visual design decisions until references arrive

## Acceptance Criteria (first slice)
Campaign picker:
- [ ] Signed-out users see only the sign-in screen; only the GM's account can sign in.
- [ ] After sign-in, the GM sees the list of frames (Witherwild, Core only).
- [ ] Choosing a frame lists the GM's campaigns in that frame; the GM can create a campaign there.
- [ ] Opening a campaign lands on its live table view.
- [ ] A campaign shows only the mechanics its frame enables (Witherwild shows campaign time; Core only does not).

Fear (core, ported as-is):
- [ ] Fear stays within 0–12; it cannot go below 0 or above 12.
- [ ] Each Fear adjustment creates exactly one event and one total change, atomically.
- [ ] Fear changes can be corrected, and corrections keep the audit trail.

Countdowns (core, ported as-is):
- [ ] Countdowns support active, paused, completed and cancelled, with the same allowed transitions as today.
- [ ] Countdown boundaries are enforced, and completion effects cannot apply twice.

Campaign time (Witherwild only, ported as-is):
- [ ] Time is stored as week + cycle (DAY/NIGHT) + cycle day 1–7; phase names are derived, never stored.
- [ ] Advancing time is atomic and idempotent (a retried advance does not double-apply).

Cross-cutting:
- [ ] A change on one device appears on another open device without reloading.
- [ ] One campaign's data never appears in another campaign.
- [ ] The existing unit tests for fear, countdowns and campaign-time pass against the ported domain modules.
- [ ] Lint, typecheck, unit/integration tests and production build pass.

Repo sweep:
- [ ] Kept: `src/lib/domain/{campaign-time,fear,countdowns}`, `src/lib/validation/{campaign-time,fear,countdowns}.ts`, their unit tests, `docs/rules-index.md`, `docs/game-interpretation.md`, `docs/glossary.md`, both PDFs.
- [ ] Old Supabase migrations for fear, countdowns and campaign time are kept as read-only reference only until ported, then removed.
- [ ] Everything else from the Witherwild app is removed from the `rebuild` branch.
- [ ] `AGENTS.md` is rewritten for the new scope (frames, core vs frame-exclusive mechanics, Convex stack).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "Campaign" is the thing you pick | Two meanings: own campaigns vs frames | Frame first, then campaign |
| Only Fear and countdowns are core | User corrected | Core also includes rests/downtime, session log, adversaries & encounters |
| The day/night week cycle is core | Came from Witherwild | Witherwild-exclusive |
| "Session-specific" rest mechanics | Could mean per-session rules | Means frame-specific downtime moves |
| It must be online for many users | Contrarian: what if only you? | Single GM on any device; maybe public much later |
| Need everything before using it | Simplifier: smallest useful version | Picker + Fear + countdowns + Witherwild time |
| App is a campaign record | Ontologist: what is it at heart? | Live-play GM console |
| Supabase stays | Clean rewrite anyway | Convex |
| Frames are user-built | Size of first slice | Frames ship in code |

## Technical Context
- Current app: Next.js App Router + Supabase (15 migrations, RLS), Vitest + Playwright, pnpm.
- Domain logic to port (pure TypeScript, storage-independent):
  - `src/lib/domain/campaign-time/index.ts`: DAY/NIGHT, cycle days 1–7, phase names (Dawn ... Civil Twilight; Nautical Twilight ... Pre-Dawn).
  - `src/lib/domain/fear/index.ts`: MIN 0, MAX 12, adjustment/correction events.
  - `src/lib/domain/countdowns/index.ts`: categories, statuses, intents, transition guards.
- Transactional behaviour currently in SQL (reference for Convex mutations): `supabase/migrations/20260719090000_fear_tracker.sql`, `20260719110000_countdown_tracker.sql`, `20260719130000_campaign_time_tracker.sql`, plus `20260719120000_operations_foundation.sql` (idempotency/operations).
- Unit tests to carry over: `tests/unit/{fear-domain,fear-validation,countdown-domain,countdown-validation,campaign-time,campaign-time-validation}.test.ts`. Integration and e2e tests are Supabase/UI-specific and will be rewritten.
- Beads (`bd`, prefix `dcm`) and OMC are installed; `.beads/`, `.codex/`, `.cursor/`, `.agents/` were added by `bd init` and are outside this spec.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| GM (User) | core | identity, OAuth account | owns Campaigns |
| CampaignFrame | core (code-defined) | id, name, enabled mechanics, frame downtime moves | has many Campaigns |
| Campaign | core | name, frame, owner | belongs to Frame and GM; has Fear, Countdowns, optional CampaignTime |
| Fear | core mechanic | current value 0–12, event history | one per Campaign |
| Countdown | core mechanic | name, category, value, max, status, history | many per Campaign |
| CampaignTime | Witherwild mechanic | week, cycle, cycle day | one per Witherwild Campaign |
| DowntimeMove | core mechanic (later) | name, source (core or frame) | provided by core and Frames |
| Session | core mechanic (later) | to be specified | belongs to Campaign |
| Adversary / Encounter | core mechanic (later) | to be specified | belongs to Campaign |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 5 | 5 | - | - | - |
| 3 | 8 | 3 | 0 | 5 | 63% |
| 4 | 8 | 0 | 1 (DowntimeMove gains source) | 7 | 100% |
| 5 | 9 | 1 (GM) | 0 | 8 | 89% |
| 9–13 | 9 | 0 | 0 | 9 | 100% |

## Open Items
- Visual overhaul: waiting for the user's Claude Design references.
- How rests/downtime, session log and adversaries/encounters work: to be specified by the user before each is designed.
- Which Witherwild downtime moves exist: to be specified.

## Interview Transcript
<details>
<summary>Full Q&A (13 rounds)</summary>

**Round 0** Topology: 5 components (picker, core systems, visual, platform, repo sweep). **A:** Looks right.
**Round 1** What do you pick? **A:** Frame, then campaign. (76%)
**Round 2** What does a frame decide? **A:** Frame toggles systems; core vs campaign-exclusive mechanics; ask about any unspecified mechanic. (69%)
**Round 3** Which are core? **A:** Rests & downtime (may have frame-specific moves), session log, adversaries & encounters are core; campaign time is Witherwild-only. (65%)
**Round 4** Session-specific rest mechanics? **A:** Frame-specific moves. (63%)
**Round 5** Who uses it? (contrarian) **A:** Most likely just the GM; slight chance of public later. (58%)
**Round 6** Visual direction? **A:** References being built in Claude Design; continue meanwhile. (57%)
**Round 7** Simplest usable version? (simplifier) **A:** Picker + Fear + countdowns + time. (50%)
**Round 8** Database? **A:** Convex. (45%)
**Round 9** What is it at heart? (ontologist) **A:** Live-play GM console. (41%)
**Round 10** Which docs survive? **A:** Only SRD index + interpretations (+ glossary). (38%)
**Round 11** Port rules as-is? **A:** Yes. (30%)
**Round 12** Sign-in? **A:** Convex Auth + Google/GitHub. (26%)
**Round 13** Where do frames come from? **A:** Built into the code. (20%)
</details>
