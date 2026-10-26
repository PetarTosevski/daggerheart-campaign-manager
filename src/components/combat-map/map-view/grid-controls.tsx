"use client";

import { useState } from "react";

import { MIN_GRID_CELL, type ImageGrid } from "./grid";

/**
 * Lining the square grid up with an uploaded image (R1; the board's Edit → Grid tool): square size − / value / +,
 * offset nudges, and "Drag to shift" (the map area then shifts the grid instead of panning). Each change is one
 * `setGrid` intent with the whole (small) grid value; the caller applies it optimistically.
 */
export function GridControls({
  grid,
  onGrid,
  shifting,
  onShifting,
  disabled,
}: {
  grid: ImageGrid;
  onGrid: (grid: ImageGrid) => void;
  shifting: boolean;
  onShifting: (on: boolean) => void;
  disabled: boolean;
}) {
  // The typed square size, only while the field has focus (CL7: never copied from props in an effect).
  const [draft, setDraft] = useState<string | null>(null);

  function commitDraft() {
    if (draft === null) return;
    const cell = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(cell) && cell >= MIN_GRID_CELL && cell !== grid.cell) onGrid({ ...grid, cell });
  }

  const nudge = (dx: number, dy: number) => onGrid({ ...grid, offsetX: grid.offsetX + dx, offsetY: grid.offsetY + dy });

  return (
    <div className="cm-gridbar" role="group" aria-label="Grid over the image">
      <span className="cm-muted cm-gridbar-hint">
        Match the grid to the squares printed on your image. Drag the map to shift the grid, or nudge it here.
      </span>
      <div className="cm-row">
        <span className="cm-lbl cm-gridbar-lbl">Square</span>
        <button
          type="button"
          className="cm-btn cm-sm"
          aria-label="Smaller squares"
          disabled={disabled || grid.cell <= MIN_GRID_CELL}
          onClick={() => onGrid({ ...grid, cell: grid.cell - 1 })}
        >
          −
        </button>
        <input
          className="cm-in cm-gridbar-in"
          type="text"
          inputMode="numeric"
          aria-label="Square size in image pixels"
          value={draft ?? String(grid.cell)}
          disabled={disabled}
          onFocus={() => setDraft(String(grid.cell))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(String(grid.cell));
              e.currentTarget.blur();
            }
          }}
        />
        <button type="button" className="cm-btn cm-sm" aria-label="Bigger squares" disabled={disabled} onClick={() => onGrid({ ...grid, cell: grid.cell + 1 })}>
          +
        </button>
        <span className="cm-muted cm-gridbar-unit">px</span>
      </div>
      <div className="cm-row">
        <span className="cm-lbl cm-gridbar-lbl">Offset</span>
        <button type="button" className="cm-btn cm-sm" aria-label="Shift grid left" disabled={disabled} onClick={() => nudge(-1, 0)}>
          ←
        </button>
        <button type="button" className="cm-btn cm-sm" aria-label="Shift grid right" disabled={disabled} onClick={() => nudge(1, 0)}>
          →
        </button>
        <button type="button" className="cm-btn cm-sm" aria-label="Shift grid up" disabled={disabled} onClick={() => nudge(0, -1)}>
          ↑
        </button>
        <button type="button" className="cm-btn cm-sm" aria-label="Shift grid down" disabled={disabled} onClick={() => nudge(0, 1)}>
          ↓
        </button>
        <span className="cm-muted cm-gridbar-unit" data-testid="grid-offset">
          {grid.offsetX}, {grid.offsetY}
        </span>
        <button type="button" className="cm-btn cm-sm" aria-pressed={shifting} disabled={disabled} onClick={() => onShifting(!shifting)}>
          ✥ Drag to shift
        </button>
      </div>
    </div>
  );
}
