import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Buttons and button-styled links from the design boards. */
export const brandButton = cva(
  [
    "relative inline-flex cursor-pointer items-center justify-center gap-2.5 font-sans whitespace-nowrap select-none",
    "transition-[transform,box-shadow,border-color,background-color,color,filter] duration-150 ease-out",
    // A small lift on hover and a press on click (none under reduced motion); a gold focus ring for the keyboard.
    "motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]",
    "outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1417]",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:brightness-100",
    "[&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:flex-none",
  ].join(" "),
  {
    variants: {
      variant: {
        /** Gold, Cinzel caps: "Choose this Frame", "Start Session". */
        primary: [
          "rounded-full bg-linear-to-b from-[#f2cd80] to-[#d6a040] font-display font-bold tracking-[0.1em] text-brand-ink",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_2px_0_#8a6420,0_8px_20px_-8px_rgba(227,180,90,0.7)]",
          "hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_2px_0_#8a6420,0_0_0_3px_rgba(227,180,90,0.22),0_12px_28px_-8px_rgba(227,180,90,0.8)]",
        ].join(" "),
        /** Gold, sans: "Resume Campaign". */
        solid: [
          "rounded-[10px] bg-linear-to-b from-[#f2cd80] to-[#d6a040] font-semibold text-brand-ink",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_6px_16px_-8px_rgba(227,180,90,0.7)]",
          "hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_0_0_3px_rgba(227,180,90,0.2),0_10px_22px_-8px_rgba(227,180,90,0.75)]",
        ].join(" "),
        /** Dark with a lit edge; the gold edge and glow come up on hover. */
        outline: [
          "rounded-[10px] border border-[#3f5359] bg-linear-to-b from-[#1e2b31] to-[#141e22] text-parchment",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_2px_6px_-2px_rgba(0,0,0,0.5)]",
          "hover:border-brand/70 hover:from-[#26363d] hover:to-[#19252a] hover:text-[#fff4dc]",
          "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_0_0_1px_rgba(227,180,90,0.18),0_8px_20px_-8px_rgba(227,180,90,0.45)]",
        ].join(" "),
        pill: [
          "rounded-full border border-[#3f5359] bg-linear-to-b from-[#1e2b31] to-[#141e22] text-parchment",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_2px_6px_-2px_rgba(0,0,0,0.5)]",
          "hover:border-brand/70 hover:from-[#26363d] hover:to-[#19252a] hover:text-[#fff4dc]",
          "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_0_0_1px_rgba(227,180,90,0.18),0_8px_20px_-8px_rgba(227,180,90,0.45)]",
        ].join(" "),
        danger: [
          "rounded-[10px] border border-[#7a3030] bg-linear-to-b from-[#2a1416] to-[#1d0f11] text-danger",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_2px_6px_-2px_rgba(0,0,0,0.5)]",
          "hover:border-[#c0504a] hover:text-[#ffb8b1] hover:shadow-[0_0_0_1px_rgba(255,154,146,0.2),0_8px_20px_-8px_rgba(184,50,42,0.6)]",
        ].join(" "),
        dangerSolid: [
          "rounded-lg bg-linear-to-b from-[#cf3d33] to-[#a52b24] font-semibold text-white",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_6px_16px_-8px_rgba(184,50,42,0.7)]",
          "hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_0_3px_rgba(184,50,42,0.25),0_10px_22px_-8px_rgba(184,50,42,0.8)]",
        ].join(" "),
      },
      size: {
        sm: "min-h-10 px-3.5 text-[14px]",
        md: "min-h-11 px-[18px] text-[15px]",
        lg: "min-h-[50px] px-5 text-[15px]",
        xl: "min-h-[52px] px-7 text-[16px]",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type BrandButtonProps = VariantProps<typeof brandButton>;

export function BrandButton({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & BrandButtonProps) {
  return <button type={type} className={cn(brandButton({ variant, size }), className)} {...props} />;
}
