"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { DIM_PHASE_BADGE } from "@/lib/domain/combat-map/light";

import { api } from "../../../../convex/_generated/api";
import type { LightPillProps, PreviewPickerProps } from "../slots";
import { pcTokens } from "./panels";
import { useCampaignLight } from "./use-campaign-light";

const ICON = { day: "☀", dim: "◐", night: "☾" } as const;

/**
 * Header (slot `LightPill`): the campaign time phase and its light (R8), with the board's badge: "Dim light: ranged
 * attacks at disadvantage" in the dim phases, "Night: light sources matter" at night. Nothing for a frame without
 * campaign time (lit as by day, C7).
 */
export function LightPill({ campaignId }: LightPillProps) {
  const light = useCampaignLight(campaignId);
  if (!light) return null;
  const badge = light.light === "dim" ? DIM_PHASE_BADGE : light.light === "night" ? "Night: light sources matter" : "";
  return (
    <span className={`cm-light cm-light-${light.light}`} title="Light comes from the campaign clock" data-testid="combat-light-pill">
      <span aria-hidden="true">{ICON[light.light]}</span>
      {light.phase}
      {badge ? <span className="cm-light-badge">· {badge}</span> : null}
    </span>
  );
}

/**
 * Header, GM (slot `PreviewPicker`): the board's "👁 Player view ▾" menu: see the map as any PC on it (R12), or the
 * GM's own view. The same page state as the "See the map as" buttons in the Vision & fog card.
 */
export function PreviewPicker({ campaignId, role, mode, map, previewCharacterId, onPreview }: PreviewPickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tokens = useQuery(api.combatTokens.list, role === "gm" && map ? { campaignId, mapId: map._id } : "skip");
  const pcs = role === "gm" && map ? pcTokens(tokens) : [];
  const previewed = pcs.find((p) => p.characterId === previewCharacterId);

  // Close on a click outside or Escape while the menu is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (role !== "gm" || !map) return null;
  const disabled = pcs.length === 0 || mode !== "play";
  return (
    <div className="cm-pv" ref={root}>
      <button
        type="button"
        className="cm-btn cm-pv-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={mode !== "play" ? "Switch to Play to preview a player's view" : pcs.length === 0 ? "Add the party first" : undefined}
        onClick={() => setOpen(!open)}
      >
        👁 {previewed ? `Viewing as ${previewed.name}` : "Player view"} ▾
      </button>
      {open ? (
        <div className="cm-pv-menu" role="menu" aria-label="Open the player view as">
          <span className="cm-lbl cm-pv-lbl">Open the player view as</span>
          {pcs.map((p) => (
            <button
              key={p.characterId}
              type="button"
              role="menuitemradio"
              aria-checked={p.characterId === previewCharacterId}
              className="cm-btn cm-pv-item"
              onClick={() => {
                onPreview(p.characterId);
                setOpen(false);
              }}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={previewCharacterId === null}
            className="cm-btn cm-pv-item"
            onClick={() => {
              onPreview(null);
              setOpen(false);
            }}
          >
            GM (everything)
          </button>
        </div>
      ) : null}
    </div>
  );
}
