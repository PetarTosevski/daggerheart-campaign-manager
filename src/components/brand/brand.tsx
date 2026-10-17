import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The hexagon mark above the title (TitleMenu). */
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="var(--brand)"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <path d="M16 2 L28 9.5 L28 22.5 L16 30 L4 22.5 L4 9.5 Z" />
      <path d="M16 2 L16 30 M4 9.5 L28 22.5 M28 9.5 L4 22.5" stroke="#8f78d8" strokeWidth="0.9" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("font-display text-[40px] leading-none font-black tracking-[0.1em]", className)}>
      DAGGERHEART
    </div>
  );
}

export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "flex size-11 flex-none items-center justify-center rounded-[10px] border border-line-2 text-parchment hover:bg-raised",
        className,
      )}
    >
      <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}

/** The bar at the top of the menu boards: back, wordmark, page label, actions. */
export function PageHeader({
  backHref,
  backLabel,
  title,
  actions,
  translucent = false,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  actions?: ReactNode;
  translucent?: boolean;
}) {
  return (
    <header
      className={cn(
        "relative flex flex-wrap items-center justify-between gap-4 border-b px-4 py-6 sm:px-12",
        translucent ? "border-white/10 bg-[rgb(8_12_16/0.72)]" : "border-[#2a2838]",
      )}
    >
      <div className="flex flex-wrap items-center gap-[18px]">
        <BackLink
          href={backHref}
          label={backLabel}
          className={translucent ? "border-[#3a3f49] bg-black/30" : undefined}
        />
        <Wordmark className="text-[32px] sm:text-[40px]" />
        <h1 className="text-[13px] font-medium tracking-[0.24em] text-muted-text uppercase">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2.5">{actions}</div> : null}
    </header>
  );
}

/** "1 · Frame  2 · Party  3 · Session Zero" step pills on the create flow. */
export function CreateSteps({ translucent = false }: { translucent?: boolean }) {
  const steps = ["1 · Frame", "2 · Party", "3 · Session Zero"];
  return (
    <ol aria-label="Steps" className="flex flex-wrap gap-2 text-[13px]">
      {steps.map((step, i) => (
        <li
          key={step}
          aria-current={i === 0 ? "step" : undefined}
          className={cn(
            "rounded-full px-3.5 py-2",
            i === 0
              ? "bg-brand font-semibold text-brand-ink"
              : translucent
                ? "border border-[#4a505a] bg-black/30 text-[#c2c9d0]"
                : "border border-line-2 text-muted-text",
          )}
        >
          {step}
        </li>
      ))}
    </ol>
  );
}

export function ComplexityDiamonds({ value }: { value: number }) {
  return (
    <span aria-label={`Complexity ${value} of 4`} className="tracking-[0.15em] text-brand">
      {"◆".repeat(value)}
      {"◇".repeat(4 - value)}
    </span>
  );
}

/**
 * Full-bleed art layer with a scrim. `contain` shows the whole picture over a
 * blurred fill, as the frame intro boards do; otherwise the art covers.
 */
export function ArtBackdrop({
  image,
  position,
  dim,
  contain = false,
}: {
  image: string;
  position: string;
  dim: number;
  contain?: boolean;
}) {
  return (
    <>
      {contain ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 scale-[1.2] bg-cover bg-no-repeat blur-[32px] brightness-[0.65]"
            style={{ backgroundImage: image, backgroundPosition: position }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: image }}
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-no-repeat"
          style={{ backgroundImage: image, backgroundPosition: position }}
        />
      )}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: `rgb(4 8 12 / ${dim})` }} />
    </>
  );
}
