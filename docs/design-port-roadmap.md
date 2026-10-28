# Design port roadmap

- **Status:** active since 2026-10-17. It replaces Phases 2–7 of `.omc/plans/campaign-manager-rebuild.md`; Phases 0–1 (sweep, Convex + auth) stay done.
- **Source:** the Claude Design boards in `reference/designs/` (read `reference/designs/CLAUDE.md` first). Images come from the design artifact and live in `public/design-assets/<blob-id>.<ext>`.
- **bd epic:** "Design port" (see `bd show` for the child IDs).

## User decisions (2026-10-17)

- **Scope:** a full port of every board, one phase at a time. Characters, sheets, dice, maps, adversaries, sessions and notes are back in scope (the earlier spec listed them as non-goals).
- **Data:** Convex, not localStorage. Every record is owned by the GM (`requireGm`) and syncs live across devices.
- **Frames:** all 10 published frames plus Custom are selectable, with their lore and visuals. Only Witherwild switches on exclusive mechanics until the user specifies the others (see the memory "ask mechanic scope").

### D2+ decisions (2026-10-17)

- **Countdowns:** the old rules (categories, statuses active/paused/completed/cancelled, advance/reverse, completion once per lifecycle, idempotent changes), shown in the board's look, **without the audit history** (no event log or history UI).
- **Campaign time:** follow the design: months as well as weeks and the 7-phase day/night arc ("Month I · Week 1 · Day 1"). Witherwild-only.
- **Wither tokens:** Witherwild-only, ported later with the party (D5), not in D2.
- **Lore text and art:** port the tomes and frame text and art in full (private app for one table). This overrides the `AGENTS.md` rule on rulebook text for this project.

### D3–D11 decisions (2026-10-17)

The full list is in `docs/decisions-d3-d11.md`. The headline change: **the app is multi-user.** Players have their own accounts; roles are per campaign (the creator is the GM; anyone can be a player elsewhere); players join by email invite or join code; anything hidden from players is enforced on the server. This adds phase **D2.5 Accounts and roles** before D3 and supersedes the single-GM principle in the original rebuild plan.

## Porting rules

- The boards are the visual spec: copy the colours, type, spacing and copy text, but write idiomatic React/Next.js (components, Tailwind tokens), not the `.dc.html` template engine.
- Replace localStorage keys with Convex tables (see `reference/designs/CLAUDE.md` "Data"). Browser storage is only for per-device conveniences (for example the 3D dice sound toggle).
- Placeholder text in the boards (`[Campaign name]`, `[#]`) becomes real data or an empty state.
- Before porting any mechanic, ask the user whether it is core or campaign-exclusive and confirm its rules if the board and the SRD disagree. Where a board conflicts with an earlier ported rule (for example countdowns "from 20 down to 1" versus the legacy SQL countdowns, or "Month I · Week 1 · Day 1" versus week/cycle/day), stop and ask.
- Every phase: the checks (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus e2e for the flows it touches), a task doc in `docs/tasks/`, a commit, and a stop to report before the next phase.

## Phases

Renumbered 2026-10-19: Combat Map became D9, so Sessions, Notes and Hardening moved to D10–D12. Older task docs and `docs/decisions-d3-d11.md` use the old numbers (D9 Sessions, D10 Notes, D11 Hardening).

| # | Phase | Boards | Notes |
|---|---|---|---|
| D1 | Design foundation and entry flow | `TitleMenu` (+ Settings), `FrameSelect`, the 10 frame intros, `Chronicle`, campaign shell + nav | Theme tokens and fonts, frame registry, `campaigns` and `settings` tables, create/list/resume/delete campaign. Dashboard and other tabs are placeholders. |
| D2 | Dashboard core mechanics | `CampaignHub` | GM Fear (tokens), countdowns, Witherwild time arc, last session card. Includes old plan Phases 3–5; resolve the board-vs-SQL conflicts first. |
| D2.5 | Accounts and roles | — | Email+password sign-up beside Google (sign-up is open; user decision 2026-10-23), env-defined test accounts, `campaignMembers` (gm/player), email invites and join codes, membership-based authorization for every existing function, player-visible filtering, joined campaigns in Load Campaign. |
| D3 | Frame dashboards and tomes | `Hub*`, `HubCustom`, `Tome*`, `TomeOpenBook` | Per-frame dashboard looks, the lore books, the Custom frame (tome, background picker). |
| D4 | Party: roster and character creation | `Party` (roster, wizard, sheet) | Portraits in Convex file storage. |
| D5 | Party: level-up, Hope and class features, dice | `Party` | Includes `dcm-mf7` (+1 to two unmarked traits). 3D dice (three + cannon-es). Photo import last. |
| D6 | World maps | `World` | Pan/zoom, tokens, route measuring, terrain painting per frame. |
| D7 | Characters & Locations | `Codex` | Images in Convex storage, allegiance/region, player view. |
| D8 | Adversaries | `Adversaries` | SRD stat blocks as data files, paginated; live encounter tracker (design issue dh-ned). |
| D9 | Combat Map | `Combat` | Several battle maps per campaign (uploaded or laid out by Claude), hand editing, tokens on the encounter tracker, range circles, facing, vision cones, light and fog of war, player view. Rules: `docs/combat-map-brief.md`, bd `dcm-bxp.32`. |
| D10 | Sessions | `Sessions` | Prep / Play / Wrap-up, live session start/end synced to the party. |
| D11 | Notes | `Notes` | Per-person bullet journals with optional PIN. |
| D12 | Hardening and docs | all | **Done 2026-10-22** (plan `d12-hardening`, H0–H24; `docs/tasks/TASK-D12-H*.md`). Live-update e2e, unauthenticated sweep test, accessibility and tablet pass, settings backup/restore, README and AGENTS, plus the authz matrix over every public function with no pending list. The final suite runs found four bugs, filed as dcm-bxp.120-123. |

Exploratory boards that are not on the design canvas (`FearOptions`, `TomeGrimoire`, `TomeCodex`) and `CycleIcons` (icon ideas) are references only.
