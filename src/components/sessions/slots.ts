import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Props of the feature slots the Sessions page mounts (D10, plan `.omc/plans/d10-sessions.yaml`). The page (S0,
 * `src/app/(gm)/campaigns/[campaignId]/sessions/page.tsx`) owns the layout, the header (campaign name, title), the
 * stage tabs and the URL state below; each feature tracer owns only its folder and fills the components its
 * `index.tsx` exports, keeping their names and props:
 *
 * | Folder    | Tracer | Exports (mounted by the page)                                                          |
 * |-----------|--------|----------------------------------------------------------------------------------------|
 * | `list/`   | S2     | `useDefaultSessionId`, `SessionHeaderLine`, `NewSessionButton`, `SessionList`         |
 * | `detail/` | S2     | `SessionHeaderCard`, `PlayerSessionView`, `NoSessionSelected`                          |
 * | `live/`   | S3     | `LiveCard`                                                                             |
 * | `prep/`   | S4     | `PrepStage`                                                                            |
 * | `play/`   | S5     | `PlayStage`                                                                            |
 * | `wrap/`   | S6     | `WrapStage`                                                                            |
 *
 * Page layout (board Sessions.dc.html l.30-215):
 * - Header: campaign name, H1 "Sessions", `SessionHeaderLine` under it, `NewSessionButton` on the right (GM).
 * - Left column ("All sessions"): `SessionList`.
 * - Right column, GM, with a session selected: `SessionHeaderCard`, `LiveCard`, the Prep / Play / Wrap-up tabs (page),
 *   then `PrepStage` | `PlayStage` | `WrapStage` for the selected stage.
 * - Right column, player, with a session selected: `PlayerSessionView` only (Q4: no stage tabs, no prep, no log).
 * - Right column, nobody selected: `NoSessionSelected`.
 *
 * URL state (the page keeps it, so a reload or a shared link opens the same view):
 * `?s=<session id>&stage=prep|play|wrap`. No `s`: the page uses `useDefaultSessionId` (the board selects the newest
 * session). A missing or bad `stage` means Prep. Players ignore `stage`.
 *
 * Rules for every slot:
 * - The page wraps each slot in its own error boundary (CL1); a slot shows its own loading line
 *   (`<p role="status" className="ss-muted">Loading …</p>`) while its `useQuery` is `undefined`.
 * - A session id from the URL is untrusted: the server loads it with `loadSession` (convex/lib/sessions.ts) and
 *   throws SESSION_NOT_FOUND for a bad or foreign id; the slot's boundary shows it.
 * - Cross-slot state (selected session, stage) lives in the page and changes only through the callbacks here
 *   (`onSelect`, `onStage`, `onCreated`, `onDeleted`). Start switches the stage to Play, End to Wrap-up (B2): S3's
 *   `LiveCard` calls `onStage`.
 * - Styles: shared tokens and classes (`ss-card`, `ss-h`, `ss-lbl`, `ss-in`, `ss-ta`, `ss-ghost`, `ss-x`, `ss-step`,
 *   `ss-num`, `ss-muted`, `ss-primary`, `ss-chip`, `ss-alert`; variables `--ss-*`, the accent `--ss-acc` from the GM's
 *   settings) come from the page's `sessions.css`; a feature adds CSS only in a colocated `.css` in its folder.
 */

/** The three stages of a session (B2), in tab order. */
export type SessionStage = "prep" | "play" | "wrap";

/** The stage tabs: id (the `?stage=` value) and the board's label. */
export const SESSION_STAGES: readonly { id: SessionStage; label: string }[] = [
  { id: "prep", label: "Prep" },
  { id: "play", label: "Play" },
  { id: "wrap", label: "Wrap-up" },
];

/** The stage a `?stage=` value names; anything else is Prep (the board's default). */
export function parseStage(value: string | null | undefined): SessionStage {
  return SESSION_STAGES.some((stage) => stage.id === value) ? (value as SessionStage) : "prep";
}

/** Who is looking and in which campaign; every slot gets these. `isGm` = `useCampaign().role === "gm"`. */
export type SessionsPageProps = {
  campaignId: Id<"campaigns">;
  isGm: boolean;
};

/** The props of every slot that shows one session (the plan's slot contract). */
export type SessionSlotProps = SessionsPageProps & {
  sessionId: Id<"sessions">;
  stage: SessionStage;
  /** Switches the stage tab (and `?stage=`). */
  onStage: (stage: SessionStage) => void;
};

// ---------------------------------------------------------------- list (S2)

/**
 * Arguments of `useDefaultSessionId(args)`: the session the page shows when the URL names none. The board picks the
 * newest session (GM) - for a player, the newest live or played one. `undefined` while loading, null for none.
 */
export type DefaultSessionArgs = SessionsPageProps;

/** Header, under the title: 'N sessions · M played · Next: <date>' (B1). */
export type SessionHeaderLineProps = SessionsPageProps;

/** Header, right: '+ New session' (GM only, B1). After creating, the page opens the new session on Prep. */
export type NewSessionButtonProps = SessionsPageProps & {
  onCreated: (sessionId: Id<"sessions">) => void;
};

/** Left column: the sessions newest first (B1); a player sees only live and played ones (Q4). */
export type SessionListProps = SessionsPageProps & {
  selectedId: Id<"sessions"> | null;
  onSelect: (sessionId: Id<"sessions">) => void;
};

// ---------------------------------------------------------------- detail (S2)

/** GM, top of the detail column: title, date, 'Mark as played' / 'Mark as not played', Delete (asks twice). */
export type SessionHeaderCardProps = SessionSlotProps & {
  /** After a delete: the page drops `?s` and shows the default session. */
  onDeleted: () => void;
};

/** Player detail column: the selected live or played session read-only (number, title, date, status, recap; Q4). */
export type PlayerSessionViewProps = SessionsPageProps & {
  sessionId: Id<"sessions">;
};

/** Detail column with nothing selected (board copy). */
export type NoSessionSelectedProps = SessionsPageProps;

// ---------------------------------------------------------------- live (S3), prep (S4), play (S5), wrap-up (S6)

/** GM: the live card under the header card (Start / End, B6, B7, B10). Calls `onStage("play")` / `onStage("wrap")`. */
export type LiveCardProps = SessionSlotProps;

/** GM, Prep stage (B3): planned scenes, hooks, the session's encounter (Q1). */
export type PrepStageProps = SessionSlotProps;

/** GM, Play stage (B4): spotlight, tally (Q3), session log. */
export type PlayStageProps = SessionSlotProps;

/** GM, Wrap-up stage (B5): recap, loot, threads, milestone (Q5). */
export type WrapStageProps = SessionSlotProps;
