"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { LIGHT_LEVELS, LIGHT_LEVEL_LABEL, dimLightBadge, isLightLevel } from "@/lib/domain/combat-map/light";

import { api } from "../../../../convex/_generated/api";
import type { LightPillProps, PreviewPickerProps } from "../slots";
import { pcTokens } from "./panels";
import { useCampaignLight, useSetTimeOfDay } from "./use-campaign-light";

const ICON = { day: "☀", dim: "◐", night: "☾" } as const;

/**
 * Header (slot `LightPill`): the campaign's light (R8, dcm-bxp.54), with the board's badge: "Dim light: ranged attacks
 * at disadvantage" in dim light, "Night: light sources matter" at night. In the Witherwild the campaign time phase
 * decides it: read-only, with a link to the dashboard's time arc. Elsewhere it is the campaign's time of day: a
 * Day / Dim / Night dropdown for the GM (edit access; the same value as the dashboard's control), read-only for players.
 * M3 Darkness (plan rule-switches RM): the dim-light badge shows in Book (and until the campaign's rules load), never in
 * Manual (`dimLightBadge`).
 */
export function LightPill({ campaignId }: LightPillProps) {
  const light = useCampaignLight(campaignId);
  const setter = useSetTimeOfDay(campaignId);
  const darkness = useQuery(api.ruleSettings.get, { campaignId })?.modes.darkness;
  if (!light) return null;
  const badge = (light.light === "night" ? "Night: light sources matter" : dimLightBadge(light.light, darkness)) ?? "";
  const icon = <span aria-hidden="true">{ICON[light.light]}</span>;
  const badgeEl = badge ? <span className="cm-light-badge">· {badge}</span> : null;
  if (light.phase !== null) {
    return (
      <span className={`cm-light cm-light-${light.light}`} title="Light comes from the campaign clock" data-testid="combat-light-pill">
        {icon}
        <Link href={`/campaigns/${campaignId}#time-arc`} className="cm-light-link" title="Campaign time sets the light: open the time arc">
          {light.phase}
        </Link>
        {badgeEl}
      </span>
    );
  }
  if (!light.canSet) {
    return (
      <span className={`cm-light cm-light-${light.light}`} title="The GM sets the time of day" data-testid="combat-light-pill">
        {icon}
        {LIGHT_LEVEL_LABEL[light.light]}
        {badgeEl}
      </span>
    );
  }
  return (
    <span className={`cm-light cm-light-${light.light}`} data-testid="combat-light-pill">
      {icon}
      <select
        className="cm-light-select"
        aria-label="Time of day"
        value={light.light}
        onChange={(e) => {
          const next = e.target.value;
          if (isLightLevel(next)) void setter.set(next);
        }}
      >
        {LIGHT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {LIGHT_LEVEL_LABEL[level]}
          </option>
        ))}
      </select>
      {badgeEl}
      {setter.error ? (
        <span role="alert" className="cm-light-badge">
          {setter.error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Header, GM (slot `PreviewPicker`): the board's "👁 Player view ▾" menu: see the map as any PC on it (R12), or the
 * GM's own view. The same page state as the "See the map as" buttons in the Vision & fog card.
 *
 * `glass` (plan glass-buttons G10): the trigger and the menu items are glass buttons. The page's scene tools (the Edit
 * header and the HUD's tools drawer) pass it; the HUD's dock does not, so its "Player view" keeps the dock's own look
 * (`.hud-dock .cm-pv-btn` in hud/dock/dock.css).
 */
export function PreviewPicker({ campaignId, role, mode, map, previewCharacterId, onPreview, glass = false }: PreviewPickerProps & { glass?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tokens = useQuery(api.combatTokensReads.list, role === "gm" && map ? { campaignId, mapId: map._id } : "skip");
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
  const itemClass = glass ? `${glassButtonClass({ role: "neutral", size: "sm", wrap: true })} cm-pv-item` : "cm-pv-item";
  return (
    <div className="cm-pv" ref={root}>
      <button
        type="button"
        className={glass ? `${glassButtonClass({ role: "neutral", size: "sm", wrap: true })} cm-pv-btn` : "cm-pv-btn"}
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
              className={itemClass}
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
            className={itemClass}
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
