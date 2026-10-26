"use client";

import { groupBadgeColors } from "@/lib/codex/view";
import { cn } from "@/lib/utils";

export type ListEntry = {
  _id: string;
  name: string;
  subtitle: string;
  coverUrl: string | null;
  initial: string;
  group: string;
  groupText: string;
  known: boolean;
  /** "2/3 shown" (GM only; empty for players). */
  imageText: string;
};

/** The entry buttons in the left column of the board. */
export function EntryList({
  entries,
  selectedId,
  gm,
  onPick,
}: {
  entries: ListEntry[];
  selectedId: string | null;
  gm: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <>
      {entries.map((e) => {
        const on = e._id === selectedId;
        return (
          <button
            key={e._id}
            type="button"
            onClick={() => onPick(e._id)}
            aria-current={on ? "true" : undefined}
            className={cn(
              "box-border flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[#e6ecea]",
              on ? "border-[1.5px] border-brand bg-[#1b282d]" : "border-[1.5px] border-[#253338] bg-[#141e22]",
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-14 flex-none items-center justify-center rounded-[10px] border border-[#3a4d54] bg-[#1f2d32] bg-cover bg-no-repeat font-display text-[22px] font-bold text-[#c8d3d0]"
              style={e.coverUrl ? { backgroundImage: `url(${e.coverUrl})`, backgroundPosition: "center 25%" } : undefined}
            >
              {e.coverUrl ? "" : e.initial}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="font-display text-[16px] leading-[1.2] font-bold">{e.name}</span>
              <span className="truncate text-[13px] text-[#9fb2b6]">{e.subtitle}</span>
              <span className="flex flex-wrap gap-1.5">
                {e.groupText ? (
                  <span className="cx-badge" style={groupBadgeColors(e.group)}>
                    {e.groupText}
                  </span>
                ) : null}
                {gm ? (
                  <>
                    <span className={cn("cx-badge", e.known ? "bg-[#20352b] text-[#9fdcb6]" : "bg-[#2a1f24] text-[#e0a3b0]")}>
                      {e.known ? "Known" : "Secret"}
                    </span>
                    <span className="cx-badge bg-[#1b282d] text-[#c8d3d0]">{e.imageText}</span>
                  </>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}
