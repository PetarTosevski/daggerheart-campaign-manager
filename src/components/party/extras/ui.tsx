import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Panel frame for a character extra, in the dashboard's tracker style. */
export function ExtraCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const id = `extra-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5">
      <div className="flex flex-col gap-1">
        <h3 id={id} className="m-0 font-display text-[20px] font-bold text-parchment">
          {title}
        </h3>
        {subtitle ? <p className="m-0 text-[13px] text-[#9fb2b6]">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export const BTN =
  "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
export const INPUT =
  "min-h-10 rounded-[9px] border border-[#33444a] bg-[#10181b] px-3 text-[14px] text-[#e6ecea] disabled:opacity-70";
export const LABEL = "text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase";
export const NOTE = "m-0 text-[13px] text-[#9fb2b6]";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

export function ErrorLine({ error }: { error: string | null | undefined }) {
  return (
    <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
      {error}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="m-0 rounded-lg border border-[#5b4a2a] bg-[#2a2010] px-3 py-2 text-[14px] text-[#f4e3bd]">
      {children}
    </p>
  );
}

/** A row of Stress-style pips; clicking pip k marks k (or clears back to k − 1). */
export function Pips({
  label,
  marked,
  total,
  disabled,
  onSet,
}: {
  label: string;
  marked: number;
  total: number;
  disabled: boolean;
  onSet: (value: number) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {Array.from({ length: total }, (_, k) => {
        const on = k < marked;
        return (
          <button
            key={k}
            type="button"
            aria-label={`${label} ${k + 1} of ${total}${on ? ", marked" : ""}`}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onSet(k + 1 === marked ? k : k + 1)}
            className={cn(
              "size-7 rotate-45 rounded-[4px] border disabled:cursor-default",
              on ? "border-[#d9a64a] bg-[#7a5218]" : "border-[#33444a] bg-[#10181b]",
              !disabled && "cursor-pointer",
            )}
          />
        );
      })}
    </div>
  );
}
