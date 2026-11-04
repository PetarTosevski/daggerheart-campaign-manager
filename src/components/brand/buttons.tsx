import { glassButtonClass, type GlassRole, type GlassSize } from "@/components/brand/glass-button";
import { cn } from "@/lib/utils";

/**
 * Every action button and button-styled link outside the Combat HUD and the card face: an arcane glass button
 * (reference/designs/buttons/arcane-glass.html; the look lives in glass-button.css). Pick the variant by what the
 * button does (role map: .omc/plans/glass-buttons-briefs.md):
 *
 * - confirm: the main action of a dialog, card or page (Hope for a player, Fear for the GM);
 * - cancel: backs out (Cancel, Back, Not now, Keep it, Close, Undo; Fear for a player, Hope for the GM);
 * - danger: removes or ends something (ember for everyone);
 * - allow / deny: the GM's yes / no to a player's request;
 * - neutral: everything without a side (also switches and chips, with `aria-pressed`);
 * - tool: toolbar icons, clear until hovered or switched on;
 * - normal / advantage / disadvantage: the roll toggle.
 *
 * The viewer comes from the nearest `data-viewer` ancestor (the campaign shell sets it; outside a campaign the
 * player's colours apply). Layout classes (w-full, flex-1, self-start, ml-auto) still apply; colour, border, radius,
 * height and padding utilities do not (glass-button.css is unlayered, see its header).
 */
export type BrandVariant =
  | GlassRole
  /** Legacy names (kept until plan glass-buttons GZ): primary and solid are confirm, outline and pill neutral. */
  | "primary"
  | "solid"
  | "outline"
  | "pill"
  | "dangerSolid";

/** sm 34 px (44 px on touch), md 44 px, lg 54 px; xl is the legacy name of lg. */
export type BrandSize = "sm" | "md" | "lg" | "xl";

export type BrandButtonProps = {
  variant?: BrandVariant | null;
  size?: BrandSize | null;
  /** Icon only, 44 × 44: give the button an aria-label. */
  icon?: boolean;
  /** Round (with `icon`: the design's Close ✕). */
  round?: boolean;
};

const LEGACY_ROLE: Partial<Record<BrandVariant, GlassRole>> = {
  primary: "confirm",
  solid: "confirm",
  outline: "neutral",
  pill: "neutral",
  dangerSolid: "danger",
};

/** The glass role a variant draws (legacy names mapped); no variant is neutral. */
export function brandRole(variant: BrandVariant | null | undefined): GlassRole {
  if (!variant) return "neutral";
  return LEGACY_ROLE[variant] ?? (variant as GlassRole);
}

function glassSize(variant: BrandVariant | null | undefined, size: BrandSize | null | undefined): GlassSize {
  if (size === "sm") return "sm";
  if (size === "lg" || size === "xl") return "lg";
  // The legacy headline button ("Choose this Frame") is large unless the call site asks for small.
  return variant === "primary" ? "lg" : "md";
}

/** The class string of a glass button (for links and components that only take a className). */
export function brandButton({
  variant,
  size,
  icon = false,
  round = false,
  className,
  class: klass,
}: BrandButtonProps & { className?: string; class?: string } = {}): string {
  return cn(
    glassButtonClass({ role: brandRole(variant), size: glassSize(variant, size), icon, round, wrap: !icon }),
    klass,
    className,
  );
}

export function BrandButton({
  className,
  variant,
  size,
  icon,
  round,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & BrandButtonProps) {
  return <button type={type} className={brandButton({ variant, size, icon, round, className })} {...props} />;
}
