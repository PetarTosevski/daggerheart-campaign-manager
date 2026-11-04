import type { Id } from "../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../convex/sessionRecords";

/**
 * Props of the feature slots the Journal page mounts (plan `.omc/plans/journal.yaml`, briefs
 * `.omc/plans/journal-briefs.md`, design `reference/designs/journal/journal_views.jpg`). The page (J1,
 * `src/app/(gm)/campaigns/[campaignId]/journal/page.tsx`) owns the layout, the header frame (campaign line, H1, sub
 * line), the Sessions / Notes sub-tabs, the Plan / Log & recap toggle, the 'Play on the Combat Map' link and the URL
 * state below; each feature tracer owns only its folder and fills the components its file exports, keeping their
 * names and props:
 *
 * | Folder / file             | Tracer | Exports (where the page mounts them)                                          |
 * |---------------------------|--------|-------------------------------------------------------------------------------|
 * | `header/`                 | JH     | `JournalHeaderActions` (header, right: live chip + End / Start, tome, threads) |
 * | `session-list/`           | JS     | `useSessionList` (the page reads it for the count and the default session),   |
 * |                           |        | `SessionList` (left column), `PlanSessionButton` (left, under the list, GM),  |
 * |                           |        | `CampaignSoFar` (left, last card)                                             |
 * | `session-head/`           | JS     | `SessionHeading` (centre, top: 'Session N · date · time', title, Live chip,   |
 * |                           |        | the GM's inline edit and menu, Q11)                                           |
 * | `plan/index.tsx`          | JP1    | `PlanView` (centre, Plan: scenes + GM prep), `PlanAside` (right, Plan: frames |
 * |                           |        | `BattlePointsPanel` for the playing Combat scene, else the first one)         |
 * | `plan/encounter.tsx`      | JP2    | `SceneEncounter` (inside a Combat scene card, mounted by `PlanView`)          |
 * | `plan/battle-points.tsx`  | JP2    | `BattlePointsPanel` (mounted by `PlanAside`)                                  |
 * | `log/`                    | JL     | `SessionLog` (centre, Log & recap, top)                                       |
 * | `recap/`                  | JR     | `Recap` (centre, Log & recap, under the log), `AfterSession` (right, last)    |
 * | `tally/`                  | JT     | `SessionTally`, `Spotlight` (right, Log & recap, GM only)                     |
 * | `threads/`                | JTh    | `ThreadsRaised` (right, Log & recap)                                          |
 * | `notes-tab/`              | JN     | `NotesTab` (the whole Notes sub-tab panel)                                    |
 * | `ui/`                     | J1     | shared pieces: `Card`, `Chip`, `Parchment`, `TypeChip`, `SlotBoundary`        |
 *
 * Page layout (design, 1440 px): header (campaign line = frame name, H1 'Journal', sub 'Every session and every
 * note, in one place.', `JournalHeaderActions` on the right), then the sub-tabs 'Sessions N' / 'Notes N pages'.
 * Sessions sub-tab: a 300 px left column ('All sessions', `SessionList`, `PlanSessionButton`, `CampaignSoFar`) and the
 * session area: a top row (`SessionHeading` on the left; the Plan / Log & recap toggle (GM only) and the gold 'Play on
 * the Combat Map →' link on the right) over two columns:
 * - GM, Plan: centre `PlanView`, right `PlanAside`.
 * - GM, Log & recap: centre `SessionLog` then `Recap`; right `SessionTally`, `Spotlight`, `ThreadsRaised`,
 *   `AfterSession`.
 * - Player (Q5, user answer 2026-11-03: list, heading, recap and the session log; never the plan, prep or Battle
 *   Points): always Log & recap, no toggle; centre `SessionLog` then `Recap`; right `ThreadsRaised`, `AfterSession`
 *   (no tally, no spotlight).
 * - No session to show: the page's empty state (`journal-empty`), no toggle.
 * Notes sub-tab: `NotesTab` fills the panel. At <= 720 px every column stacks (list first).
 *
 * URL state (the page keeps it, so a reload or a shared link opens the same view):
 * `?tab=sessions|notes` (default sessions), `&s=<session id>`, `&sv=plan|log` (default plan for the GM, always log for
 * players), plus the Notes params `view`, `page`, `journal`, which the page never touches (the Notes sub-tab reads and
 * writes them). A bad value falls back to the default. No `s`: `defaultSessionId` (the live session, else the newest
 * the caller may see). Switching the sub-tab keeps every other param.
 *
 * Rules for every slot:
 * - The page wraps each slot in its own `SlotBoundary` (CL1); a slot shows its own loading line
 *   (`<p role="status" className="jr-muted">Loading …</p>`) while its `useQuery` is `undefined`. Until its tracer
 *   lands, a stub renders nothing.
 * - A session id from the URL is untrusted: the server loads it with `loadSession` (convex/lib/sessions.ts) and throws
 *   SESSION_NOT_FOUND for a bad or foreign id; the slot's boundary shows it.
 * - Cross-slot state (tab, selected session, view) lives in the page and changes only through the callbacks here.
 * - Styles: shared tokens and classes from `src/components/journal/journal.css` (variables `--jr-*`; classes
 *   `jr-card`, `jr-card-h`, `jr-lbl`, `jr-muted`, `jr-chip`, `jr-type`, `jr-parchment`, `jr-ghost`, `jr-alert`,
 *   `jr-m0`); a feature adds CSS only in a colocated `.css` in its folder.
 * - Buttons: the brand buttons (`src/components/brand/buttons.tsx`) or `jr-ghost` for now; the Arcane Glass roll-out
 *   (`src/components/brand/glass-button.ts`) comes after the Journal.
 */

// ---------------------------------------------------------------- URL state

/** The two sub-tabs, in tab order. */
export type JournalTab = "sessions" | "notes";
export const JOURNAL_TABS: readonly JournalTab[] = ["sessions", "notes"];

/** The tab a `?tab=` value names; anything else is Sessions. */
export function parseTab(value: string | null | undefined): JournalTab {
  return JOURNAL_TABS.includes(value as JournalTab) ? (value as JournalTab) : "sessions";
}

/** The Sessions sub-tab's two views (the design's Plan / Log & recap toggle). */
export type SessionView = "plan" | "log";
export const SESSION_VIEWS: readonly { id: SessionView; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "log", label: "Log & recap" },
];

/** The view a `?sv=` value names: the GM's default is Plan; players always get Log & recap (Q5). */
export function parseSessionView(value: string | null | undefined, isGm: boolean): SessionView {
  if (!isGm) return "log";
  return value === "log" ? "log" : "plan";
}

/**
 * The session the page shows when the URL names none: the live one, else the newest the caller may see (the list is
 * newest first, `sessionRecords.list`). `undefined` while loading, null for none.
 */
export function defaultSessionId(sessions: readonly SessionListItem[] | undefined): Id<"sessions"> | null | undefined {
  if (sessions === undefined) return undefined;
  return (sessions.find((s) => s.status === "live") ?? sessions[0])?._id ?? null;
}

/** A link into the Journal (for other pages and slots): `/campaigns/<id>/journal?tab=…&s=…&sv=…&view=…&page=…`. */
export function journalHref(
  campaignId: Id<"campaigns"> | string,
  params: { tab?: JournalTab; s?: string; sv?: SessionView; view?: string; page?: string } = {},
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined) query.set(name, value);
  const text = query.toString();
  return `/campaigns/${campaignId}/journal${text ? `?${text}` : ""}`;
}

// ---------------------------------------------------------------- slot props

/** Who is looking and in which campaign; every slot gets these. `isGm` = `useCampaign().role === "gm"`. */
export type JournalPageProps = {
  campaignId: Id<"campaigns">;
  isGm: boolean;
};

/** Every slot that shows one session. */
export type JournalSessionProps = JournalPageProps & {
  sessionId: Id<"sessions">;
};

/** Header, right (JH): the live chip with End / Start, the tome button and 'Open threads N'. */
export type JournalHeaderActionsProps = JournalPageProps & {
  /** The session the page shows (Start starts it when it is planned), or null. */
  selectedId: Id<"sessions"> | null;
  /** Opens a session on the Sessions sub-tab in a view (Start opens the started session's Log & recap). */
  onOpenSession: (sessionId: Id<"sessions">, view?: SessionView) => void;
  /** Switches to the Notes sub-tab with a notes view (`?view=`, e.g. 'threads' for Open threads). */
  onNotesView: (view: string) => void;
};

/** Left column (JS): the sessions newest first, the selected one ringed; a player sees live and played only (Q5). */
export type SessionListProps = JournalPageProps & {
  selectedId: Id<"sessions"> | null;
  onSelect: (sessionId: Id<"sessions">) => void;
};

/** Left column, under the list (JS, GM only): '+ Plan session N'. After creating, the page opens it on Plan. */
export type PlanSessionButtonProps = JournalPageProps & {
  onCreated: (sessionId: Id<"sessions">) => void;
};

/** Left column, last (JS): 'Campaign so far' (sessions played, hours at the table, party level, open threads). */
export type CampaignSoFarProps = JournalPageProps;

/** Session area, top left (JS): 'Session N · date · time', the title, the Live chip; the GM's edit and menu (Q11). */
export type SessionHeadingProps = JournalSessionProps & {
  /** After a delete: the page drops `?s` and shows the default session. */
  onDeleted: () => void;
};

/** Plan, centre (JP1): planned scenes and the GM prep note. */
export type PlanViewProps = JournalSessionProps;

/** Plan, right (JP1): the Battle Points panel of the playing Combat scene, else the first one; nothing without one. */
export type PlanAsideProps = JournalSessionProps;

/** Inside a Combat scene card (JP2): the scene's encounter, or create / link one. */
export type SceneEncounterProps = JournalSessionProps & {
  /** The scene's id (`sessionPrep` scene ids are server-made UUIDs). */
  sceneId: string;
  /** The scene's 1-based number in the plan. */
  sceneNumber: number;
};

/** Plan, right (JP2, mounted by `PlanAside`): 'Battle points · Scene N' of that scene's encounter. */
export type BattlePointsPanelProps = SceneEncounterProps;

/** Log & recap, centre (JL): the session log. GM: hide / re-word / add; player: read only (Q5). */
export type SessionLogProps = JournalSessionProps;

/** Log & recap, centre under the log (JR): the recap parchment (Q4: everyone writes, always visible). */
export type RecapProps = JournalSessionProps;

/** Log & recap, right, last (JR): 'After the session' (level-ups, loot). */
export type AfterSessionProps = JournalSessionProps;

/** Log & recap, right (JT, GM only): the six tally tiles. */
export type SessionTallyProps = JournalSessionProps;

/** Log & recap, right (JT, GM only): a spotlight bar per PC, Reset, the least-spotlight line. */
export type SpotlightProps = JournalSessionProps;

/** Log & recap, right (JTh): the open threads on the caller's Notes pages linked to the session (Q2). */
export type ThreadsRaisedProps = JournalSessionProps & {
  /** 'In Notes': opens the page in the Notes sub-tab (`?tab=notes&page=<pageId>`). */
  onOpenPage: (pageId: string) => void;
};

/** The Notes sub-tab panel (JN): the existing Notes UI without its hero; it keeps `view` / `page` / `journal`. */
export type NotesTabProps = JournalPageProps;
