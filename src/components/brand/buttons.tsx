import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Buttons and button-styled links from the design boards. */
export const brandButton = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2.5 font-sans whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:flex-none",
  {
    variants: {
      variant: {
        /** Gold, Cinzel caps: "Choose this Frame", "Start Session". */
        primary:
          "rounded-full bg-brand font-display font-bold tracking-[0.1em] text-brand-ink hover:brightness-110",
        /** Gold, sans: "Resume Campaign". */
        solid: "rounded-[10px] bg-brand font-semibold text-brand-ink hover:brightness-110",
        outline: "rounded-[10px] border border-line-2 bg-transparent text-parchment hover:bg-raised",
        pill: "rounded-full border border-line-2 bg-transparent text-parchment hover:bg-raised",
        danger: "rounded-[10px] border border-[#6a2a2a] bg-transparent text-danger hover:bg-danger-bg",
        dangerSolid: "rounded-lg bg-danger-solid font-semibold text-white hover:brightness-110",
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
