// Character-sheet runtime domain rules for Task 011C.
//
// Pure, framework-independent helpers shared by the runtime UI, client
// validation, and (mirrored by) the server. No PDF or React here. The database
// function `save_character_sheet_value` is the authoritative validator; this
// module gives immediate client feedback with the same rules.

import type { SheetFieldType } from "@/lib/domain/sheet-templates";

export const SHEET_SAVE_STATES = [
  "idle",
  "unsaved",
  "saving",
  "saved",
  "error",
] as const;
export type SheetSaveState = (typeof SHEET_SAVE_STATES)[number];

export const SHEET_SAVE_STATE_LABELS: Record<SheetSaveState, string> = {
  idle: "",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

/**
 * Aggregates per-field save states into one overall status for the header
 * indicator, by priority: saving > error > unsaved > saved > idle.
 */
export function clampSaveState(states: readonly SheetSaveState[]): SheetSaveState {
  if (states.includes("saving")) return "saving";
  if (states.includes("error")) return "error";
  if (states.includes("unsaved")) return "unsaved";
  if (states.includes("saved")) return "saved";
  return "idle";
}

/** Field types that are never editable at runtime. */
export function isReadOnlyField(field: {
  field_type: SheetFieldType | string;
  configuration: Record<string, unknown> | null | undefined;
}): boolean {
  if (field.field_type === "computed") return true;
  return Boolean(field.configuration?.["readOnly"]);
}

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Converts a field's normalized rect (each value in [0,1]) into pixel bounds for
 * a rendered page of the given size. Placement is therefore identical at any zoom
 * because the page size already reflects the zoom. A minimum pixel size keeps
 * controls usable when a field is tiny.
 */
export function toPixelRect(
  rect: NormalizedRect,
  pageWidth: number,
  pageHeight: number,
  minSizePx = 12,
): { left: number; top: number; width: number; height: number } {
  return {
    left: rect.x * pageWidth,
    top: rect.y * pageHeight,
    width: Math.max(minSizePx, rect.width * pageWidth),
    height: Math.max(minSizePx, rect.height * pageHeight),
  };
}

export function checkboxChecked(value: string | null | undefined): boolean {
  return value === "true";
}

export function optionsFromConfig(
  config: Record<string, unknown> | null | undefined,
): string[] {
  const options = config?.["options"];
  return Array.isArray(options)
    ? options.filter((o): o is string => typeof o === "string")
    : [];
}

export type NormalizeResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Normalizes and validates a raw runtime value for a field type, mirroring the
 * server. An empty/whitespace value clears the field (`value: null`). Zero is a
 * valid number and is preserved.
 */
export function normalizeSheetValue(
  fieldType: SheetFieldType | string,
  raw: string | null,
  config: Record<string, unknown> | null | undefined,
): NormalizeResult {
  if (raw === null) return { ok: true, value: null };

  if (fieldType === "checkbox") {
    if (raw !== "true" && raw !== "false") {
      return { ok: false, error: "Checkbox value must be true or false." };
    }
    return { ok: true, value: raw };
  }

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  if (fieldType === "number" || fieldType === "counter") {
    // Preserve valid zero and negatives; reject anything non-numeric.
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { ok: false, error: "Value must be a number." };
    }
    const num = Number(trimmed);
    const min = toNumber(config?.["min"]);
    const max = toNumber(config?.["max"]);
    if (min !== null && num < min) {
      return { ok: false, error: "Value is below the allowed minimum." };
    }
    if (max !== null && num > max) {
      return { ok: false, error: "Value is above the allowed maximum." };
    }
    return { ok: true, value: String(num) };
  }

  if (fieldType === "select" || fieldType === "radio") {
    const options = optionsFromConfig(config);
    if (!options.includes(trimmed)) {
      return { ok: false, error: "Value is not an allowed option." };
    }
    return { ok: true, value: trimmed };
  }

  // text, multiline_text, image
  if (trimmed.length > 10000) {
    return { ok: false, error: "Value is too long." };
  }
  return { ok: true, value: raw };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Applies a counter delta to the current stored value, clamped to configured
 * bounds. Returns the new value as a canonical string.
 */
export function stepCounter(
  current: string | null,
  delta: number,
  config: Record<string, unknown> | null | undefined,
): string {
  const base = toNumber(current) ?? 0;
  let next = base + delta;
  const min = toNumber(config?.["min"]);
  const max = toNumber(config?.["max"]);
  if (min !== null) next = Math.max(min, next);
  if (max !== null) next = Math.min(max, next);
  return String(next);
}

/**
 * Whether a save response should be applied: only if it corresponds to the most
 * recent edit for that field. Prevents a delayed/stale response from clobbering
 * a newer edit in the UI.
 */
export function isLatestSave(responseSeq: number, latestSeq: number): boolean {
  return responseSeq >= latestSeq;
}
