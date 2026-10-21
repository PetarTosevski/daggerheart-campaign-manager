"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { CARRIED_LIGHTS, CARRIED_LIGHT_LABEL, DIM_PHASE_BADGE, type CarriedLight, type LightLevel } from "@/lib/domain/combat-map/light";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CELL_TILE_ROWS, CELL_UNPAINTED } from "../map-view/cells";
import type { RevealPanelProps, VisionPanelProps } from "../slots";
import { normalizeAngle, TURN_BUTTON_STEP } from "../tokens/geometry";
import { useRings } from "../tokens/rings";
import { SIDES } from "../tokens/sides";
import { useTokenActions, useTokens, type TokenView } from "../tokens/use-tokens";
import { useCampaignLight } from "./use-campaign-light";
import {
  doorLabels,
  okView,
  useDoors,
  useViewing,
  useVisionActions,
  type OtherToken,
  type ViewOk,
  type VisionActions,
} from "./use-vision";
import { useVisionState, type FogBrush, type FogTool } from "./vision-state";

/** The board's light rule line for the viewer's phase and carried light (R8, R9). */
export function lightRule(light: LightLevel, carried: CarriedLight): string {
  if (light === "day") return "Daylight: you see everything in your cone that isn’t blocked.";
  if (light === "dim") return "Dim light: you see your whole cone, but ranged attacks are at disadvantage.";
  const own = {
    none: "without a light you see clearly only in Melee and dimly to Very Close.",
    torch: "your torch lights clearly to Close and dimly to Far.",
    lantern: "your lantern lights clearly to Close and dimly to Far.",
    alistair: "Alistair’s Torch lights clearly to Far.",
  }[carried];
  return `Night: ${own} Creatures in dim light stay hidden until the GM reveals them.`;
}

/** "85° vision cone (Instinct +1)" (R6). */
export function coneText(coneDeg: number, instinct: number): string {
  return `${coneDeg}° vision cone (Instinct ${instinct >= 0 ? "+" : ""}${instinct})`;
}

/** The carried-light buttons (Q3): none, torch, lantern, Alistair's Torch. */
function LightPicker({ token, actions, label }: { token: Pick<TokenView, "_id" | "light">; actions: VisionActions; label: string }) {
  return (
    <div className="cm-vis-field">
      <span className="cm-lbl">{label}</span>
      <div className="cm-row cm-vis-tight" role="group" aria-label={label}>
        {CARRIED_LIGHTS.map((l) => (
          <button
            key={l}
            type="button"
            className="cm-btn cm-sm"
            aria-pressed={token.light === l}
            onClick={() => {
              if (token.light !== l) void actions.setCarriedLight(token._id, l);
            }}
          >
            {CARRIED_LIGHT_LABEL[l]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ErrorLine({ actions }: { actions: { error: string | null } }) {
  return actions.error ? (
    <p role="alert" className="cm-alert cm-m0">
      {actions.error}
    </p>
  ) : null;
}

/**
 * The doors the viewer may switch (map-movement M2, D8), each with an Open / Close switch (optimistic): the GM every
 * door, a player only the doors their characters have seen. Nothing when there is none.
 */
function DoorsCard(props: VisionPanelProps) {
  const doors = useDoors(props);
  const actions = useVisionActions(props.campaignId);
  if (doors.length === 0) return null;
  const labels = doorLabels(doors);
  const sorted = [...doors].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <section className="cm-card" aria-labelledby="cm-doors-h">
      <span id="cm-doors-h" className="cm-lbl">
        Doors
      </span>
      <ul className="cm-vis-doors" role="list">
        {sorted.map((d) => {
          const label = labels.get(d._id) ?? "Door";
          return (
            <li key={d._id} className="cm-row cm-between cm-vis-tight">
              <span>
                {label} <span className="cm-muted cm-vis-small">· {d.open ? "open" : "closed"}</span>
              </span>
              <button
                type="button"
                className="cm-btn cm-sm"
                aria-pressed={d.open}
                aria-label={`${d.open ? "Close" : "Open"} ${label.toLowerCase()}`}
                onClick={() => void actions.setOpen(d._id, !d.open)}
              >
                {d.open ? "Close" : "Open"}
              </button>
            </li>
          );
        })}
      </ul>
      <span className="cm-muted cm-vis-small">A closed door stops movement; a closed solid door blocks sight too. Gates and bars stay see-through.</span>
      <ErrorLine actions={actions} />
    </section>
  );
}

// ---------------------------------------------------------------- player

/** The player's "Your view" card (the board's "You are" card): who, cone, facing, carried light, the light rule. */
function YourView({ view, props }: { view: ViewOk; props: VisionPanelProps }) {
  const { campaignId, map, onSelectToken } = props;
  const actions = useVisionActions(campaignId);
  const turns = useTokenActions(campaignId, map);
  const own = view.pcs.find((t) => t._id === view.tokenId);
  if (!own) return null;
  return (
    <section className="cm-card cm-card-me" aria-labelledby="cm-me-h">
      <span id="cm-me-h" className="cm-lbl">
        Your view
      </span>
      <div className="cm-row cm-between cm-vis-me">
        <strong className="cm-vis-name">{own.name}</strong>
        <button
          type="button"
          className="cm-btn cm-sm"
          onClick={() => {
            onSelectToken(own._id);
            document.querySelector(`[data-token="${own._id}"]`)?.scrollIntoView({ block: "center", inline: "center" });
          }}
        >
          Find me
        </button>
      </div>
      <span className="cm-muted" data-testid="combat-cone-text">
        {[own.sub, coneText(view.coneDeg, view.instinct)].filter(Boolean).join(" · ")}
      </span>
      <div className="cm-row cm-vis-tight">
        <span className="cm-lbl cm-vis-inline">Facing</span>
        <button type="button" className="cm-btn cm-sm" onClick={() => void turns.turn(own._id, normalizeAngle(own.face - TURN_BUTTON_STEP))}>
          ⟲ Turn
        </button>
        <button type="button" className="cm-btn cm-sm" onClick={() => void turns.turn(own._id, normalizeAngle(own.face + TURN_BUTTON_STEP))}>
          Turn ⟳
        </button>
      </div>
      <LightPicker token={own} actions={actions} label="Light you carry" />
      {view.light === "dim" ? <span className="cm-vis-dim">◐ {DIM_PHASE_BADGE}</span> : null}
      <p className="cm-muted cm-m0 cm-vis-small" data-testid="combat-light-rule">
        {lightRule(view.light, own.light)}
      </p>
      <ErrorLine actions={actions} />
      <ErrorLine actions={turns} />
    </section>
  );
}

/** A player's card for a selected non-PC token (C6's panel shows PC tokens only): name, side, range circles. */
function OtherCard({ token, onDone }: { token: OtherToken; onDone: () => void }) {
  const rings = useRings();
  const side = SIDES[token.side];
  return (
    <section className="cm-card" aria-label="Selected token" style={{ borderColor: side.colour }}>
      <div className="cm-row">
        <span className="cm-vis-dot" aria-hidden="true" style={{ background: side.colour }} />
        <strong className="cm-vis-name cm-vis-name-sm">{token.name}</strong>
      </div>
      <span className="cm-muted">
        {side.label}
        {token.revealed ? " · revealed to you: it stands in dim light" : ""}
      </span>
      <div className="cm-row cm-vis-tight">
        <button type="button" className="cm-btn cm-sm" aria-pressed={rings.on(token._id)} onClick={() => rings.toggle(token._id)} title="Range circles (R)">
          ◎ Range circles
        </button>
        <button type="button" className="cm-btn cm-sm" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  );
}

function PlayerPanel(props: VisionPanelProps) {
  const viewing = useViewing(props);
  if (viewing.kind !== "player") return null;
  const view = viewing.view;
  if (view === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading your view…
      </p>
    );
  }
  if (view.state === "noMap") return null;
  if (view.state === "noCharacter") {
    return (
      <section className="cm-card cm-card-me" aria-labelledby="cm-me-h">
        <span id="cm-me-h" className="cm-lbl">
          Your view
        </span>
        <strong className="cm-vis-name cm-vis-name-sm">You aren’t on this map yet</strong>
        <span className="cm-muted">The GM will place you.</span>
      </section>
    );
  }
  const other = view.others.find((t) => t._id === props.selectedTokenId);
  return (
    <>
      <YourView view={view} props={props} />
      {other ? <OtherCard token={other} onDone={() => props.onSelectToken(null)} /> : null}
      <DoorsCard {...props} />
    </>
  );
}

// ---------------------------------------------------------------- GM

const FOG_TOOLS: { tool: FogTool; label: string }[] = [
  { tool: "off", label: "Off" },
  { tool: "reveal", label: "Reveal" },
  { tool: "hide", label: "Hide" },
  { tool: "erase", label: "Erase" },
];
const BRUSHES: FogBrush[] = [1, 2, 3];

/** The PC tokens on the map, for the preview picker and "Reveal to…". */
export function pcTokens(tokens: TokenView[] | undefined): { tokenId: Id<"combatTokens">; characterId: Id<"characters">; name: string }[] {
  return (tokens ?? [])
    .filter((t) => t.kind === "pc" && t.characterId !== undefined)
    .map((t) => ({ tokenId: t._id, characterId: t.characterId as Id<"characters">, name: t.name }));
}

/** The GM's "Vision & fog" card (Play): see the map as any PC (R12) and the fog brush with its size (R12). */
function GmPanel(props: VisionPanelProps) {
  const { campaignId, map, previewCharacterId, onPreview } = props;
  const tokens = useTokens(campaignId, "gm", map._id);
  const { fogTool, setFogTool, brush, setBrush } = useVisionState();
  const viewing = useViewing(props);
  const actions = useVisionActions(campaignId);
  const [confirmClear, setConfirmClear] = useState(false);
  const pcs = pcTokens(tokens);
  const previewed = pcs.find((p) => p.characterId === previewCharacterId);
  const view = okView(viewing);
  const marks = useMarks(props);
  return (
    <section className="cm-card" aria-label="Vision and fog">
      <h2 className="cm-h">Vision &amp; fog</h2>
      {pcs.length > 0 ? (
        <div className="cm-vis-field">
          <span className="cm-lbl">See the map as</span>
          <div className="cm-row cm-vis-tight" role="group" aria-label="See the map as">
            <button type="button" className="cm-btn cm-sm" aria-pressed={previewCharacterId === null} onClick={() => onPreview(null)}>
              GM (everything)
            </button>
            {pcs.map((p) => (
              <button key={p.characterId} type="button" className="cm-btn cm-sm" aria-pressed={previewCharacterId === p.characterId} onClick={() => onPreview(p.characterId)}>
                {p.name}
              </button>
            ))}
          </div>
          {previewed ? (
            <span className="cm-vis-preview" role="status">
              Showing what {previewed.name} sees{view ? ` · ${coneText(view.coneDeg, view.instinct)}` : ""}.
            </span>
          ) : null}
          {previewCharacterId !== null && viewing.kind === "preview" && viewing.view?.state === "noCharacter" ? (
            <span className="cm-muted cm-vis-small">That character isn’t on this map.</span>
          ) : null}
        </div>
      ) : null}
      <div className="cm-vis-field">
        <span className="cm-lbl">Fog brush (by hand, for every player)</span>
        <div className="cm-row cm-vis-tight" role="group" aria-label="Fog brush">
          {FOG_TOOLS.map(({ tool, label }) => (
            <button key={tool} type="button" className="cm-btn cm-sm" aria-pressed={fogTool === tool} onClick={() => setFogTool(tool)}>
              {label}
            </button>
          ))}
        </div>
        <div className="cm-row cm-vis-tight">
          <span className="cm-lbl cm-vis-inline">Brush</span>
          <div className="cm-row cm-vis-tight" role="group" aria-label="Brush size">
            {BRUSHES.map((b) => (
              <button key={b} type="button" className="cm-btn cm-sm" aria-pressed={brush === b} aria-label={`Brush ${b}`} onClick={() => setBrush(b)}>
                {b}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="cm-btn cm-sm"
            disabled={marks.length === 0}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              setConfirmClear(false);
              void actions.paintFog(map._id, marks, "erase");
            }}
            onBlur={() => setConfirmClear(false)}
          >
            {confirmClear ? "Click again to clear" : "Clear marks"}
          </button>
        </div>
        <span className="cm-muted cm-vis-small">Reveal shows those squares and the tokens on them to every player; Hide hides them; Erase returns them to normal sight.</span>
      </div>
      <ErrorLine actions={actions} />
    </section>
  );
}

/** Squares (`y * w + x`) holding a fog mark on the GM's map. */
function useMarks({ campaignId, map }: VisionPanelProps): number[] {
  // The marks are the map's fog tiles; `combatMaps.get` is the subscription the map board already holds.
  const layout = useQuery(api.combatMaps.get, { campaignId, mapId: map._id });
  if (!layout) return [];
  const out: number[] = [];
  for (const t of layout.cells) {
    if (t.layer !== "fog") continue;
    for (let i = 0; i < t.cells.length; i++) if (t.cells[i] !== CELL_UNPAINTED) out.push(t.tile * CELL_TILE_ROWS * layout.w + i);
  }
  return out.filter((s) => s < layout.w * layout.h);
}

/**
 * Left column (slot `VisionPanel`). Player: the "Your view" card (cone, facing, carried light, the light rule and
 * the dim-phase badge; R6, R8, R9, Q3) and the card of a selected non-PC token. GM in Play: "Vision & fog". Both: the
 * doors they may open and close (map-movement M2).
 */
export function VisionPanel(props: VisionPanelProps) {
  if (props.role === "player") return <PlayerPanel {...props} />;
  if (props.mode !== "play") return null;
  return (
    <>
      <GmPanel {...props} />
      <DoorsCard {...props} />
    </>
  );
}

// ---------------------------------------------------------------- RevealPanel

/**
 * Left column, GM, under C6's token card (slot `RevealPanel`): for the selected token, its carried light (any
 * token, Q3) and, at night for a non-PC token, "Reveal to…" per PC (R10): after a successful roll the GM reveals a
 * token standing in dim light to that character; it then appears for that player with the dashed outline.
 */
export function RevealPanel(props: RevealPanelProps) {
  const { campaignId, role, map, selectedTokenId } = props;
  const tokens = useTokens(campaignId, role, map._id);
  const light = useCampaignLight(campaignId);
  const actions = useVisionActions(campaignId);
  if (role !== "gm" || !tokens) return null;
  const token = tokens.find((t) => t._id === selectedTokenId);
  if (!token) return null;
  const revealedTo = token.revealedTo ?? [];
  const night = light?.light === "night";
  const showReveal = token.kind !== "pc" && (night || revealedTo.length > 0);
  const pcs = pcTokens(tokens);
  return (
    <section className="cm-card" aria-label="Light and reveal">
      <LightPicker token={token} actions={actions} label={`Carried light · ${token.name}`} />
      {showReveal ? (
        <div className="cm-vis-reveal" role="group" aria-label="Reveal to">
          <span className="cm-lbl cm-vis-reveal-lbl">Reveal to…</span>
          <span className="cm-muted cm-vis-small">Hidden in dim light. After a successful roll, reveal it to that player.</span>
          <div className="cm-row cm-vis-tight">
            {pcs.length === 0 ? <span className="cm-muted cm-vis-small">No PC is on this map.</span> : null}
            {pcs.map((p) => {
              const on = revealedTo.includes(p.characterId);
              return (
                <button key={p.characterId} type="button" className="cm-btn cm-sm" aria-pressed={on} onClick={() => void actions.reveal(token._id, p.characterId, !on)}>
                  {on ? `👁 ${p.name}` : p.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <ErrorLine actions={actions} />
    </section>
  );
}
