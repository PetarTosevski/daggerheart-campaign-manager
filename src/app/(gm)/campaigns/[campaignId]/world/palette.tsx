"use client";

import { useState } from "react";

import { BUILTIN_TOKEN_TYPES } from "@/lib/world/map-state";
import { MARKER_SWATCHES, TOKEN_TYPE_ART, type TokenType } from "@/lib/world/token-types";

import type { MapActions } from "./map-actions";

export function TokenIcon({ type, size = 26, icon = 15 }: { type: Pick<TokenType, "colour" | "path">; size?: number; icon?: number }) {
  return (
    <span className="tok-ic" style={{ width: size, height: size, background: type.colour, border: "2px solid rgba(255, 243, 214, 0.85)" }}>
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={type.path} />
      </svg>
    </span>
  );
}

/** "Place on map": the token palette (drag or pick, then click the map), renaming and custom markers. */
export function Palette({
  types,
  placing,
  onPick,
  actions,
}: {
  types: TokenType[];
  placing: string | null;
  onPick: (id: string | null) => void;
  actions: MapActions;
}) {
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("landmark");
  const [colour, setColour] = useState<string>(MARKER_SWATCHES[0]);

  async function saveRename(t: TokenType) {
    const v = renaming?.draft.trim();
    setRenaming(null);
    if (v && v !== t.label) await actions.renameType(t.id, v);
  }

  async function addCustom() {
    const label = name.trim();
    if (!label) return;
    const added = await actions.addCustomType(label, icon, colour);
    if (added) {
      setName("");
      onPick(added.id);
    }
  }

  return (
    <aside aria-label="Map tokens" className="w-pal flex flex-col gap-2">
      <h2 className="m-0 font-display text-[20px] font-bold">Place on map</h2>
      <p className="m-0 text-[13px] leading-[1.45] text-[#9fb2b6]">Drag a token onto the map, or click one and then click the map.</p>
      <div className="w-pal-list">
        {types.map((t) =>
          renaming?.id === t.id ? (
            <div key={t.id} className="pal-row">
              <input
                className="fld fsm"
                type="text"
                value={renaming.draft}
                maxLength={40}
                autoFocus
                onChange={(e) => setRenaming({ id: t.id, draft: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename(t);
                  if (e.key === "Escape") setRenaming(null);
                }}
                aria-label={`New name for ${t.label}`}
              />
              <button
                type="button"
                className="pal-edit"
                aria-label="Save name"
                onClick={() => void saveRename(t)}
              >
                ✓
              </button>
            </div>
          ) : (
            <div key={t.id} className="pal-row">
              <button
                type="button"
                className="pal"
                draggable
                aria-pressed={placing === t.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", t.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPick(placing === t.id ? null : t.id)}
              >
                <TokenIcon type={t} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{t.label}</span>
              </button>
              <button type="button" className="pal-edit tip" aria-label={`Rename ${t.label}`} data-tip="Rename" onClick={() => setRenaming({ id: t.id, draft: t.label })}>
                ✎
              </button>
            </div>
          ),
        )}
      </div>
      <details className="mt-1 rounded-[10px] border border-dashed border-[#33444a] p-2.5">
        <summary className="cursor-pointer text-[13px] text-[#f3cf86]">+ Custom marker</summary>
        <div className="mt-2 flex flex-col gap-2">
          <input className="fld fsm" type="text" placeholder="Name, e.g. Witch hut" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} aria-label="Custom marker name" />
          <select className="fld fsm" value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Icon">
            {BUILTIN_TOKEN_TYPES.map((id) => (
              <option key={id} value={id}>
                Icon: {TOKEN_TYPE_ART[id].label}
              </option>
            ))}
          </select>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
            {MARKER_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={colour === c}
                aria-label={c}
                onClick={() => setColour(c)}
                className="size-[26px] cursor-pointer rounded-full"
                style={{ background: c, border: `2px solid ${colour === c ? "#f3cf86" : "rgba(255, 255, 255, 0.25)"}` }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addCustom}
            disabled={!name.trim()}
            className="min-h-9 cursor-pointer rounded-[9px] border-none bg-[#e3b45a] text-[13px] font-bold text-[#1a1408] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add to menu
          </button>
        </div>
      </details>
    </aside>
  );
}
