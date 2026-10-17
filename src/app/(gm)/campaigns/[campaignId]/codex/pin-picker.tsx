"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { assetBackground } from "@/lib/design-assets";
import type { GmEntry } from "@/lib/codex/view";
import { WORLD_MAPS } from "@/lib/world/map-state";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

type Pin = { id: number; name: string; x: number; y: number; hidden: boolean };

/** Links a location to one of the World map's pins (pins are placed on the World board). */
export function PinPicker({
  frameId,
  entry,
  entries,
  pins,
  onClose,
}: {
  frameId: string;
  entry: GmEntry;
  entries: GmEntry[];
  pins: Pin[];
  onClose: () => void;
}) {
  const setPin = useMutation(api.codex.setPin);
  const [error, setError] = useState<string | null>(null);
  const map = (WORLD_MAPS as Record<string, { asset: string; width: number; height: number } | undefined>)[frameId];
  const title = `Place “${entry.name || "this location"}” on the map`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function link(tokenId: number) {
    if (tokenId === entry.tokenId) {
      onClose();
      return;
    }
    setError(null);
    try {
      await setPin({ entryId: entry._id as Id<"codexEntries">, tokenId });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[100] box-border flex items-center justify-center bg-[rgb(3_6_7/0.9)] p-4 sm:p-6">
      <div className="box-border flex max-h-full w-full max-w-[1100px] flex-col gap-3 overflow-auto rounded-[14px] border border-brand bg-[#141e22] p-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="cx-h flex-1">{title}</h2>
          <button type="button" className="cx-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="cx-muted m-0">Click a pin to link this location to it. Pins are placed and moved on the World map.</p>
        <div
          className="relative mx-auto w-full overflow-hidden rounded-[10px] bg-[#e6d8b8] bg-no-repeat"
          style={{
            aspectRatio: map ? `${map.width} / ${map.height}` : "4 / 3",
            maxHeight: "calc(100vh - 260px)",
            backgroundSize: "100% 100%",
            ...(map ? { backgroundImage: assetBackground(map.asset) } : {}),
          }}
        >
          {pins.map((p) => {
            const mine = p.id === entry.tokenId;
            const used = !mine && entries.some((e) => e.kind === "location" && e.tokenId === p.id && e._id !== entry._id);
            const label = `${p.name || "Pin"}${mine ? " (this location)" : used ? " (linked to another location)" : " — click to link"}${p.hidden ? " · hidden from players" : ""}`;
            const size = mine ? 22 : 16;
            return (
              <span key={p.id}>
                <button
                  type="button"
                  onClick={() => void link(p.id)}
                  title={label}
                  aria-label={label}
                  className="absolute cursor-pointer rounded-full border-2 border-[#fff3d6] p-0 shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                  style={{
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    width: size,
                    height: size,
                    transform: "translate(-50%, -50%)",
                    background: mine ? "var(--brand)" : used ? "#6a5a8a" : "#2a6a6a",
                    opacity: p.hidden ? 0.6 : 1,
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute rounded px-1 text-[11px] font-semibold whitespace-nowrap text-[#2a1f14]"
                  style={{ left: `${p.x}%`, top: `calc(${p.y}% + 12px)`, transform: "translateX(-50%)", background: "rgba(239, 227, 200, 0.85)" }}
                >
                  {p.name}
                </span>
              </span>
            );
          })}
        </div>
        {error ? (
          <div role="alert" className="text-[14px] text-[#ffb4a8]">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
