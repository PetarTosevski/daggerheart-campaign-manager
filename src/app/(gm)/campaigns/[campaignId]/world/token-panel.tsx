"use client";

import { useState, type ReactNode } from "react";

import type { MapToken } from "@/lib/world/map-state";
import { tokenType, type TokenType } from "@/lib/world/token-types";

import type { MapActions } from "./map-actions";
import { TokenIcon } from "./palette";

/** A text field saved when it loses focus (or on Enter for single-line fields). */
function DraftField({
  label,
  value,
  onSave,
  multiline = false,
  maxLength,
  nameField = false,
  placeholder,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  maxLength: number;
  nameField?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onSave(draft);
    setDraft(null);
  };
  return (
    <label className="flex flex-col gap-1 text-[12px] text-[#9fb2b6]">
      {label}
      {multiline ? (
        <textarea
          className="fld resize-y font-serif text-[16px] leading-[1.4]"
          rows={5}
          value={shown}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          className="fld"
          type="text"
          data-name-field={nameField ? "1" : undefined}
          value={shown}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      )}
    </label>
  );
}

/** Right column: the selected token's editor, the token list and the party trail. */
export function TokenPanel({
  tokens,
  types,
  selected,
  onSelect,
  fromParty,
  distances,
  trailText,
  actions,
  onSendParty,
  children,
  footer,
}: {
  tokens: MapToken[];
  types: TokenType[];
  selected: MapToken | null;
  onSelect: (id: number | null) => void;
  fromParty: (t: MapToken) => string;
  distances: (t: MapToken) => { name: string; text: string }[];
  trailText: string | null;
  actions: MapActions;
  onSendParty: ((t: MapToken) => void) | null;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const selType = selected ? tokenType(types, selected.type) : null;
  const dists = selected ? distances(selected) : [];
  return (
    <aside aria-label="Selected token" className="w-side flex flex-col gap-3.5">
      {children}
      {selected && selType ? (
        <section aria-label={`Edit ${selected.name || selType.label}`} className="flex flex-col gap-2.5 rounded-[14px] border border-[#3a3020] bg-[#141e22] p-4">
          <div className="flex items-center gap-2.5">
            <TokenIcon type={selType} size={34} icon={20} />
            <span className="font-display text-[13px] tracking-[0.14em] text-[#c8b48a] uppercase">{selType.label}</span>
          </div>
          <DraftField key={`n${selected.id}`} label="Name" value={selected.name} maxLength={80} nameField onSave={(name) => actions.updateToken(selected.id, { name })} />
          <DraftField
            key={`d${selected.id}`}
            label="Notes"
            value={selected.notes}
            maxLength={2000}
            multiline
            placeholder="Who lives here, what happened, secrets…"
            onSave={(notes) => actions.updateToken(selected.id, { notes })}
          />
          <label className="flex flex-col gap-1 text-[12px] text-[#9fb2b6]">
            Type
            <select className="fld" value={selected.type} onChange={(e) => actions.updateToken(selected.id, { type: e.target.value })}>
              {types.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="chk">
            <input type="checkbox" checked={selected.hidden} onChange={() => actions.updateToken(selected.id, { hidden: !selected.hidden })} /> Hidden from players
          </label>
          <label className="chk">
            <input type="checkbox" checked={selected.location} onChange={() => actions.updateToken(selected.id, { location: !selected.location })} /> Location · show on dashboard
          </label>
          <div className="rounded-[10px] border border-[#5a4a2a] bg-[#2a2416] px-3 py-2.5 text-[13px] text-[#f3dfb0]">
            <strong className="font-display">From the party:</strong> {fromParty(selected)}
          </div>
          {dists.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] tracking-[0.1em] text-[#9fb2b6] uppercase">Distances</span>
              {dists.map((d, i) => (
                <div key={i} className="flex justify-between gap-2 border-b border-[#1f2b30] py-1 text-[13px]">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{d.name}</span>
                  <span className="flex-none text-[#c8b48a]">{d.text}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            {onSendParty ? (
              <button
                type="button"
                onClick={() => onSendParty(selected)}
                className="min-h-10 flex-1 cursor-pointer rounded-[9px] border border-[#e3b45a] bg-transparent text-[13px] text-[#f3cf86]"
              >
                Send party here
              </button>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                await actions.removeToken(selected.id);
                onSelect(null);
              }}
              className="min-h-10 cursor-pointer rounded-[9px] border border-[#8e2b2b] bg-transparent px-3 text-[13px] text-[#ff9a92]"
            >
              Delete
            </button>
          </div>
        </section>
      ) : (
        <div className="rounded-[14px] border border-dashed border-[#33444a] p-4 text-[14px] leading-normal text-[#9fb2b6]">
          Click a token on the map to name it, add notes or delete it. Drag the gold banner to move the party; their path is traced in red. Use Measure to check the distance between any two points.
        </div>
      )}
      <section aria-labelledby="onmap-h" className="flex flex-col gap-2 rounded-[14px] border border-[#253338] bg-[#141e22] p-4">
        <div className="flex items-baseline justify-between">
          <h2 id="onmap-h" className="m-0 font-display text-[18px] font-bold">
            On the map
          </h2>
          <span className="text-[13px] text-[#9fb2b6]">
            {tokens.length} {tokens.length === 1 ? "marker" : "markers"}
          </span>
        </div>
        {tokens.map((t) => {
          const ty = tokenType(types, t.type);
          const on = t.id === selected?.id;
          const flags = [t.hidden ? "hidden" : "", t.location ? "location" : ""].filter(Boolean).join(", ");
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={on ? "true" : undefined}
              className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-left text-[13px] text-[#e6ecea]"
              style={{ borderColor: on ? "#e3b45a" : "transparent", background: on ? "#2a2416" : "transparent" }}
            >
              <TokenIcon type={ty} size={24} icon={13} />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t.name || ty.label}</span>
              {flags ? (
                <span aria-label={flags} className="flex-none text-[12px] text-[#c8b48a]">
                  {t.hidden ? "🚫👁 " : ""}
                  {t.location ? "📍" : ""}
                </span>
              ) : null}
            </button>
          );
        })}
        {trailText !== null ? (
          <>
            <div className="text-[13px] text-[#c8b48a]">Party has travelled {trailText}</div>
            <button
              type="button"
              onClick={() => actions.clearTrail()}
              className="mt-1 min-h-9 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent text-[13px] text-[#c8d3d0]"
            >
              Clear party trail
            </button>
          </>
        ) : null}
      </section>
      {footer}
    </aside>
  );
}
