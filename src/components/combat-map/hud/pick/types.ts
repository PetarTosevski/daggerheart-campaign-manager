import type { ReactNode } from "react";

import type { Range } from "@/lib/domain/card-effects/types";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TargetAsk } from "../../actions/hand/model";
import type { WeaponSlot } from "../../actions/targets/state";
import type { CostResource } from "../ui";

/**
 * The pick-session API (plan combat-hud H3.0; HANDOFF "The picking pattern"; board CmpPicking). Everything that picks
 * targets in the HUD (cards H3.1, weapon attacks H3.2, features H3.3, the action ring H3.4, the GM's adversary attacks
 * H5.2) opens ONE session through `usePick().open(spec)`; the HUD then draws:
 *   - the picking panel beside the primary target (`.pk`: header with the source and the rule, one row per creature,
 *     the riders / options with cost pills, the footer cost line and one primary button that names the action);
 *   - the target rings on the map (`.tg-picked | -in | -out | -los`, band label above, secondary label below);
 * both reading the same selection, so a tap on a row or on a ring picks, and both stay in step.
 *
 * Out of range is never an error (HANDOFF hard rule 3): the row says "GM approves", the ring is amber with a GM badge,
 * the primary still sends, and when the server answers `pending` the session ends and "Waiting for the GM" (with
 * Withdraw, HD3) shows until the GM answers. See docs/tasks/TASK-HUD-H3.0.md for a worked example.
 */

/** What the session is for: the header's name (and card art for a card). */
export type PickSource = {
  kind: "card" | "attack" | "feature" | "reaction" | "adversary";
  /** "Vicious Entangle", "Shortstaff", "Rally". */
  name: string;
  /** A domain card: its art becomes the header's thumbnail (next/image, the card's own art). */
  cardId?: string;
};

/**
 * Who may be picked and how far: the classic Hand model's `TargetAsk` (actions/hand/model.ts `targetAsk(use)` gives it for
 * a card use), plus what the HUD needs. `range` is a Defined Range band, `"weapon"` (the weapon in `slot`, as
 * `combatActions.targets` measures it) or `"unlimited"`.
 */
export type PickRule = TargetAsk & {
  /** Fewest picks the primary needs (default 1; 0 lets the primary send with none). */
  min?: number;
  /** The weapon whose range `"weapon"` means (default primary); also the slot the line-of-sight hints use. */
  slot?: WeaponSlot;
  /** The header's rule line; default `ruleText(rule)`: "Pick 1 target within Far". */
  text?: string;
  /** The targets are fixed (a forced attack): rows and rings show, taps do nothing. */
  locked?: boolean;
};

/** The state of one creature in the session (HANDOFF "Target ring states"). */
export type PickState = "picked" | "in" | "out" | "los";

/** Whether a creature is in reach before it is picked: `in`, `out` (the GM approves) or `los` (can't see: never picked). */
export type PickReach = "in" | "out" | "los";

/**
 * A row of the panel and a ring on the map. Built by the HUD from the rule (`buildRows`), or handed in by a picker that
 * knows better (`spec.rows`: H3.2's minion offer, H5.2's GM adversary attack).
 */
export type PickRow = {
  tokenId: Id<"combatTokens">;
  name: string;
  /** `self` is the actor's own token. */
  side: "self" | "pc" | "enemy" | "ally" | "neutral";
  /** The Defined Range band from the actor ("Far"), null when unknown. */
  band: Range | null;
  reach: PickReach;
  /** Condition names (answer 10a: names only, never a number). */
  conditions: readonly string[];
};

/** A picker-supplied row: as `PickRow`, with conditions optional. */
export type PickRowInput = Omit<PickRow, "conditions"> & { conditions?: readonly string[] };

/** A rider or option row (`.pk-rider`): a switch with an optional cost pill. */
export type PickOption = {
  id: string;
  /** "If it hits, also Restrain the Bandit": say so when it applies only on a hit. */
  label: string;
  /** Muted line under it ("Very Close to the Lieutenant"). */
  note?: string;
  cost?: { amount: number; resource: CostResource };
  /** On when the session opens. */
  defaultOn?: boolean;
  disabled?: boolean;
  /** A secondary target this option names: while on, its ring carries `ringLabel` below it (`.tg-rl`). */
  tokenId?: Id<"combatTokens">;
  ringLabel?: string;
};

/** What the primary and the footer see: the picks in order (the first is the primary target) and the options. */
export type PickSelection = {
  /** The picked rows, first picked first. */
  targets: readonly PickRow[];
  targetIds: readonly Id<"combatTokens">[];
  /** Some pick is out of range: the send goes to the GM first. */
  outOfRange: boolean;
  /** Option id → on. */
  options: Readonly<Record<string, boolean>>;
};

/**
 * What a send came back with:
 * - `done`: the action ran (the session closes);
 * - `pending`: the server asked the GM (out of range; the session closes, "Waiting for the GM" shows from the server's
 *   open requests, so a reload keeps it);
 * - `stay`: keep the panel open (a picker's follow-up), with an optional message under the primary.
 * A thrown error (a `ConvexError` refusal) keeps the panel open and shows the refusal table's message under the primary
 * (`refusalFor`, CmpBlocked layer 2; H6.2), or a toast where the table places it there.
 */
export type PickOutcome = { kind: "done" } | { kind: "pending"; requestId: Id<"combatRequests"> } | { kind: "stay"; message?: string };

export type PickPrimary = {
  /** The one primary button names the action: "Cast on Lieutenant", "Attack the Bandit". */
  label: (selection: PickSelection) => string;
  /** The footer's cost line ("Spends your last Hope"); null for none. Out of range adds the GM line by itself. */
  pay?: (selection: PickSelection) => string | null;
  /** Why the primary can't send yet (beyond too few picks), shown beside it; null when it can. */
  blocked?: (selection: PickSelection) => string | null;
  /** Sends the action with the selection. Called from the primary's click handler (never an effect). */
  send: (selection: PickSelection) => Promise<PickOutcome>;
};

/** The acting creature: the player's own character by default; the GM always names it. */
export type PickActor = {
  tokenId: Id<"combatTokens">;
  /** A PC's character (its line-of-sight hints come from `combatActions.targets`). */
  characterId?: Id<"characters">;
};

/** What a picker's extra rows get: the live selection and the session's handles. */
export type PickContext<D = unknown> = {
  selection: PickSelection;
  data: D;
  /** Changes the open session: a new rule (another weapon), options, primary, rows or data. */
  update: (patch: PickPatch<D>) => void;
  close: () => void;
};

export type PickSessionSpec<D = unknown> = {
  /** Stable per picker and thing picked for ("card:vicious-entangle:cast"); opening the same id again replaces it. */
  id: string;
  source: PickSource;
  rule: PickRule;
  primary: PickPrimary;
  /** Default: the player's own character. Required for the GM (Play for, adversaries). */
  actor?: PickActor;
  /** Already picked when the session opens (e.g. the enemy tapped before). Unknown or unpickable ids are dropped. */
  picked?: readonly Id<"combatTokens">[];
  options?: readonly PickOption[];
  /** Rows the picker builds itself; default: every creature on the map that fits `rule.side`. */
  rows?: readonly PickRowInput[];
  /** Picker rows between the targets and the options (H3.1 grimoire spell, H3.2 weapon tiles). */
  extra?: (context: PickContext<D>) => ReactNode;
  /** Picker-owned state that `extra` and `update` keep (typed per picker). */
  data?: D;
  /** Called once when the session ends without a send (✕, Esc, another session opening). */
  onCancel?: () => void;
  /**
   * A step of a use already under way (a chain link, an after-the-roll ask, a post-roll offer) or an answer to the GM
   * (a forced attack): the GM's spotlight never blocks it (H6.2). Every other player session is a new action and waits
   * while the GM holds the spotlight (answer 1c).
   */
  followUp?: boolean;
};

export type PickPatch<D = unknown> = Partial<Omit<PickSessionSpec<D>, "id">>;
