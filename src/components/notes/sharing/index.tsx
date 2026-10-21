"use client";

import type { NotesSlotProps } from "../slots";

/**
 * The sharing chip in the page toolbar (Q14) that opens the sharing dialog (A3-A5, Q4). N0 stub: the default
 * visibility's label, disabled; N6 wires it.
 */
export function SharingChip({ access }: NotesSlotProps) {
  return (
    <button type="button" className="bj-chip" disabled>
      {access.isGm ? "Private" : "Private · GM can read"}
    </button>
  );
}
