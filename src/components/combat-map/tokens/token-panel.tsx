"use client";

import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { isDifficult } from "@/lib/domain/combat-map/movement";

import { api } from "../../../../convex/_generated/api";
import { decodeCells } from "../map-view/cells";
import { useLayoutMovementGrid } from "../map-view/movement-overlay";
import type { TokenPanelProps } from "../slots";
import { normalizeAngle, TURN_BUTTON_STEP } from "./geometry";
import { DIFFICULT_TEXT, useMoveNotes } from "./move-notes";
import { useRings } from "./rings";
import { PC_CONDITIONS, SIDES, TRACKER_CONDITIONS } from "./sides";
import { useTokenActions, useTokens, type TokenActions, type TokenView } from "./use-tokens";

const SIZES = [
  { size: 1, label: "1×1" },
  { size: 2, label: "2×2" },
  { size: 3, label: "3×3" },
] as const;

/** The board's pips: clicking pip k marks up to k, clicking the last marked one clears it. */
function Pips({ label, value, max, colour, disabled, onDelta }: { label: string; value: number; max: number; colour: string; disabled: boolean; onDelta: (delta: number) => void }) {
  return (
    <div className="cm-pips" role="group" aria-label={label}>
      {Array.from({ length: max }, (_, k) => {
        const marked = k < value;
        const target = k + 1 === value ? k : k + 1;
        return (
          <button
            key={k}
            type="button"
            className="cm-pip"
            aria-label={`${label} ${k + 1}${marked ? " marked" : ""}`}
            aria-pressed={marked}
            disabled={disabled}
            style={{ borderColor: colour, background: marked ? colour : "transparent" }}
            onClick={() => onDelta(target - value)}
          />
        );
      })}
    </div>
  );
}

/** "Hide all circles" (R3): switches every token's range circles off for this viewer. */
function HideAllCircles({ tokens }: { tokens: TokenView[] }) {
  const rings = useRings();
  const ids = tokens.map((t) => t._id);
  if (!ids.some((id) => rings.on(id))) return null;
  return (
    <button type="button" className="cm-btn cm-sm" onClick={() => rings.hideAll(ids)}>
      ◎ Hide all circles
    </button>
  );
}

function subLine(token: TokenView, gm: boolean): string {
  const side = SIDES[token.side].label;
  if (token.kind === "pc") return ["Party", token.sub, gm ? "changes sync to the character sheet" : ""].filter(Boolean).join(" · ");
  if (token.kind === "adversary") {
    const difficulty = token.stats?.difficulty !== undefined ? `Difficulty ${token.stats.difficulty}` : "";
    return [side, difficulty, token.sub].filter(Boolean).join(" · ");
  }
  return side;
}

/** A custom token's name, saved on blur or Enter (CL7: re-synced only while not focused). */
function CustomName({ token, actions }: { token: TokenView; actions: TokenActions }) {
  const [draft, setDraft] = useState<string | null>(null);
  function save() {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== token.name) void actions.rename(token._id, draft);
    setDraft(null);
  }
  return (
    <input
      className="cm-in cm-tokname"
      type="text"
      aria-label="Token name"
      value={draft ?? token.name}
      maxLength={60}
      onFocus={() => setDraft(token.name)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/**
 * D5: whether the token's card shows "a movement roll is needed": its last move on this screen crossed or ended on
 * difficult terrain (combatTokens.move's `difficult`) and it is still there, or it stands on a difficult square now
 * (from the layout the map board already reads, so the GM sees it after a player's move too).
 */
function useDifficultNote({ campaignId, role, map }: TokenPanelProps, token: TokenView): boolean {
  const gm = role === "gm";
  const gmLayout = useQuery(api.combatMaps.get, gm ? { campaignId, mapId: map._id } : "skip");
  const liveLayout = useQuery(api.combatMaps.live, gm ? "skip" : { campaignId });
  const layout = gm ? gmLayout : liveLayout?._id === map._id ? liveLayout : null;
  const cells = useMemo(() => (layout ? decodeCells(layout.cells, layout.w, layout.h) : null), [layout]);
  const grid = useLayoutMovementGrid(layout, cells);
  const crossed = useMoveNotes().difficult.get(token._id);
  if (crossed && crossed.x === token.x && crossed.y === token.y) return true;
  if (!grid) return false;
  for (let y = token.y; y < token.y + token.size; y++) for (let x = token.x; x < token.x + token.size; x++) if (isDifficult(grid, x, y)) return true;
  return false;
}

function SelectedToken({ token, tokens, props }: { token: TokenView; tokens: TokenView[]; props: TokenPanelProps }) {
  const { campaignId, role, map, onSelectToken } = props;
  const gm = role === "gm";
  const actions = useTokenActions(campaignId, map);
  const rings = useRings();
  const side = SIDES[token.side];
  const s = token.stats;
  // R4: the GM edits any token's numbers; a player only their own PC's (a player never gets adversary stats).
  const editStats = gm || token.mine;
  const trackerClosed = token.kind === "adversary" && token.tracked !== true;
  const canEdit = editStats && !trackerClosed;
  // D5: the note is for the token's owner and the GM.
  const difficult = useDifficultNote(props, token) && (gm || token.mine);

  return (
    <section className="cm-card cm-tokcard" aria-label="Selected token" style={{ borderColor: side.colour }}>
      <div className="cm-row cm-tokhead">
        <span className="cm-tokdot" aria-hidden="true" style={{ background: side.colour }} />
        {gm && token.kind === "custom" ? <CustomName key={token._id} token={token} actions={actions} /> : <strong className="cm-tokname">{token.name}</strong>}
      </div>
      <span className="cm-muted">{subLine(token, gm)}</span>
      {difficult ? (
        <p className="cm-move-note" data-testid="combat-difficult-note">
          {DIFFICULT_TEXT}
        </p>
      ) : null}

      {s && s.hpMax > 0 ? (
        <div className="cm-tokfield">
          <span className="cm-lbl">
            Hit Points · {s.hp} / {s.hpMax} marked
          </span>
          <Pips label="Hit Point" value={s.hp} max={s.hpMax} colour="#c0392b" disabled={!canEdit} onDelta={(d) => void actions.mark(token, "hp", d)} />
        </div>
      ) : null}
      {s && s.stressMax > 0 ? (
        <div className="cm-tokfield">
          <span className="cm-lbl">
            Stress · {s.stress} / {s.stressMax} marked
          </span>
          <Pips label="Stress" value={s.stress} max={s.stressMax} colour="#4f6a86" disabled={!canEdit} onDelta={(d) => void actions.mark(token, "stress", d)} />
        </div>
      ) : null}
      {s && token.kind === "pc" ? (
        // A PC's conditions live on the character sheet; the owner and the GM switch them here (user 2026-10-20).
        <div className="cm-tokfield">
          <span className="cm-lbl">Conditions</span>
          <div className="cm-row cm-tight" role="group" aria-label="Conditions">
            {PC_CONDITIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="cm-btn cm-sm"
                aria-pressed={s.conditions.includes(c.id)}
                disabled={!canEdit}
                onClick={() => void actions.togglePcCondition(token, c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {trackerClosed && gm ? <span className="cm-muted cm-small">The encounter isn’t running. Start it on the Adversaries tab to mark HP, Stress and conditions.</span> : null}

      <div className="cm-row cm-tight">
        <button type="button" className="cm-btn cm-sm" aria-pressed={rings.on(token._id)} onClick={() => rings.toggle(token._id)} title="Range circles (R)">
          ◎ Range circles
        </button>
        {token.canMove ? (
          <>
            <button type="button" className="cm-btn cm-sm" aria-label="Turn left" onClick={() => void actions.turn(token._id, normalizeAngle(token.face - TURN_BUTTON_STEP))}>
              ⟲
            </button>
            <button type="button" className="cm-btn cm-sm" aria-label="Turn right" onClick={() => void actions.turn(token._id, normalizeAngle(token.face + TURN_BUTTON_STEP))}>
              ⟳
            </button>
          </>
        ) : null}
        <HideAllCircles tokens={tokens} />
      </div>

      {gm ? (
        <div className="cm-tokgm">
          {s && token.kind !== "pc" ? (
            <div className="cm-tokfield">
              <span className="cm-lbl">Conditions</span>
              <div className="cm-row cm-tight" role="group" aria-label="Conditions">
                {TRACKER_CONDITIONS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="cm-btn cm-sm"
                    aria-pressed={s.conditions.includes(c.id)}
                    disabled={!canEdit}
                    onClick={() => void actions.toggleCondition(token, c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="cm-row cm-tight" role="group" aria-label="Side">
            <span className="cm-lbl cm-inline-lbl">Side</span>
            {(Object.keys(SIDES) as TokenView["side"][])
              .filter((k) => k !== "pc" || token.kind === "pc")
              .map((k) => (
                <button key={k} type="button" className="cm-btn cm-sm" aria-pressed={token.side === k} onClick={() => void actions.setSide(token._id, k)}>
                  {SIDES[k].label}
                </button>
              ))}
          </div>
          <div className="cm-row cm-tight" role="group" aria-label="Size">
            <span className="cm-lbl cm-inline-lbl">Size</span>
            {SIZES.map(({ size, label }) => (
              <button key={size} type="button" className="cm-btn cm-sm" aria-pressed={token.size === size} onClick={() => void actions.setSize(token._id, size)}>
                {label}
              </button>
            ))}
          </div>
          <div className="cm-row cm-tight">
            <button type="button" className="cm-btn cm-sm" onClick={() => onSelectToken(null)}>
              Done
            </button>
            <button
              type="button"
              className="cm-btn cm-sm cm-danger"
              onClick={() => {
                onSelectToken(null);
                void actions.remove(token._id);
              }}
            >
              Remove from map
            </button>
          </div>
        </div>
      ) : null}
      {actions.error ? (
        <p role="alert" className="cm-alert cm-m0">
          {actions.error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Left column (slot `TokenPanel`, D9 C6): the selected token's card (the board's). The GM sees every token's numbers
 * and edits them: HP and Stress pips write the character sheet (PC), the encounter tracker (adversary) or the token
 * (custom); conditions, side, size, remove. A player edits only their own PC's pips (R4). Everyone toggles range
 * circles (R3) and turns a token they may move (R5). With nothing selected it shows only "Hide all circles" while
 * any circles are on (C6 renders that button, not the map toolbar).
 */
export function TokenPanel(props: TokenPanelProps) {
  const tokens = useTokens(props.campaignId, props.role, props.map._id);
  const rings = useRings();
  if (!tokens) return null;
  const token = tokens.find((t) => t._id === props.selectedTokenId);
  if (token) return <SelectedToken token={token} tokens={tokens} props={props} />;
  const circled = tokens.filter((t) => rings.on(t._id)).length;
  if (circled === 0) return null;
  return (
    <section className="cm-card cm-tokcard-rings" aria-label="Range circles">
      <div className="cm-row cm-between">
        <span className="cm-muted">
          Range circles on {circled} {circled === 1 ? "token" : "tokens"}
        </span>
        <HideAllCircles tokens={tokens} />
      </div>
    </section>
  );
}
