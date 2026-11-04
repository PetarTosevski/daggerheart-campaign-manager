import "./glass-button.css";

/**
 * Arcane glass buttons (reference/designs/buttons/arcane-glass.html). The design's `data-role` is a class here, so any
 * `<button>` (or a component that only takes a className) can carry it. The colours of confirm, cancel, advantage and
 * disadvantage follow the viewer: put `data-viewer="player" | "gm"` on an ancestor (no viewer = the player's colours).
 */
export type GlassRole =
  /** The action the prompt is for: Hope for a player, Fear for the GM. */
  | "confirm"
  /** Back out (Cancel, Back, Not now, Pass, Skip, Undo, Close): Fear for a player, Hope for the GM. */
  | "cancel"
  /** Grey glass: tools, toggles, settings, anything without a side. */
  | "neutral"
  /** A toolbar button: clear until hovered or switched on (`aria-pressed`). */
  | "tool"
  /** Ember for everyone: End scene, a destructive two-tap. */
  | "danger"
  /** The GM's yes to a player's request: Hope for every viewer. */
  | "allow"
  /** The GM's no to a player's request: Fear for every viewer. */
  | "deny"
  /** The roll toggle (with `aria-pressed`): Normal is grey; Advantage / Disadvantage follow the viewer. */
  | "normal"
  | "advantage"
  | "disadvantage";

/** A colour set that overrides the role's colour (the design's is-hope / is-fear). */
export type GlassTone = "hope" | "fear";

/** 44 px (md, the default), 34 px (sm) or 54 px (lg) tall. */
export type GlassSize = "sm" | "md" | "lg";

export type GlassButtonOptions = {
  role: GlassRole;
  tone?: GlassTone;
  size?: GlassSize;
  /** Icon only: 44 × 44 (give the button an aria-label). */
  icon?: boolean;
  /** A round icon button (the design's Close ✕). */
  round?: boolean;
};

export function glassButtonClass({ role, tone, size = "md", icon = false, round = false }: GlassButtonOptions): string {
  const classes = ["gb", `gb-${role}`];
  if (tone) classes.push(`gb-${tone}`);
  if (size !== "md") classes.push(`gb-${size}`);
  if (icon) classes.push("gb-icon");
  if (round) classes.push("gb-round");
  return classes.join(" ");
}
