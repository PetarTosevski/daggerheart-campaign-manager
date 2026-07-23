import { describe, expect, it } from "vitest";

import {
  checkboxChecked,
  clampSaveState,
  isLatestSave,
  isReadOnlyField,
  normalizeSheetValue,
  optionsFromConfig,
  stepCounter,
  toPixelRect,
} from "@/lib/domain/character-sheet";

describe("toPixelRect", () => {
  it("converts normalized coordinates to pixels for the page size", () => {
    const r = toPixelRect({ x: 0.5, y: 0.25, width: 0.2, height: 0.1 }, 600, 800);
    expect(r).toEqual({ left: 300, top: 200, width: 120, height: 80 });
  });

  it("enforces a minimum usable size", () => {
    const r = toPixelRect({ x: 0, y: 0, width: 0.001, height: 0.001 }, 600, 800, 12);
    expect(r.width).toBe(12);
    expect(r.height).toBe(12);
  });
});

describe("normalizeSheetValue", () => {
  it("clears on null or empty/whitespace", () => {
    expect(normalizeSheetValue("text", null, {})).toEqual({ ok: true, value: null });
    expect(normalizeSheetValue("text", "   ", {})).toEqual({ ok: true, value: null });
  });

  it("preserves a valid zero for numbers", () => {
    expect(normalizeSheetValue("number", "0", {})).toEqual({ ok: true, value: "0" });
    expect(normalizeSheetValue("counter", "-3", {})).toEqual({ ok: true, value: "-3" });
  });

  it("rejects non-numeric numbers and enforces bounds", () => {
    expect(normalizeSheetValue("number", "abc", {}).ok).toBe(false);
    expect(normalizeSheetValue("counter", "2", { min: 3 }).ok).toBe(false);
    expect(normalizeSheetValue("counter", "9", { max: 5 }).ok).toBe(false);
    expect(normalizeSheetValue("counter", "4", { min: 1, max: 5 })).toEqual({
      ok: true,
      value: "4",
    });
  });

  it("validates checkbox booleans", () => {
    expect(normalizeSheetValue("checkbox", "true", {})).toEqual({ ok: true, value: "true" });
    expect(normalizeSheetValue("checkbox", "false", {})).toEqual({ ok: true, value: "false" });
    expect(normalizeSheetValue("checkbox", "yes", {}).ok).toBe(false);
  });

  it("enforces select/radio options", () => {
    const cfg = { options: ["a", "b"] };
    expect(normalizeSheetValue("select", "a", cfg)).toEqual({ ok: true, value: "a" });
    expect(normalizeSheetValue("radio", "c", cfg).ok).toBe(false);
  });

  it("caps text length", () => {
    expect(normalizeSheetValue("text", "x".repeat(10001), {}).ok).toBe(false);
    expect(normalizeSheetValue("multiline_text", "line1\nline2", {})).toEqual({
      ok: true,
      value: "line1\nline2",
    });
  });
});

describe("isReadOnlyField", () => {
  it("treats computed and config.readOnly as read-only", () => {
    expect(isReadOnlyField({ field_type: "computed", configuration: {} })).toBe(true);
    expect(isReadOnlyField({ field_type: "text", configuration: { readOnly: true } })).toBe(true);
    expect(isReadOnlyField({ field_type: "text", configuration: {} })).toBe(false);
  });
});

describe("helpers", () => {
  it("aggregates save state by priority", () => {
    expect(clampSaveState(["saved", "saving", "unsaved"])).toBe("saving");
    expect(clampSaveState(["saved", "error"])).toBe("error");
    expect(clampSaveState(["saved", "unsaved"])).toBe("unsaved");
    expect(clampSaveState(["idle", "saved"])).toBe("saved");
    expect(clampSaveState(["idle"])).toBe("idle");
  });

  it("reads checkbox and options", () => {
    expect(checkboxChecked("true")).toBe(true);
    expect(checkboxChecked("false")).toBe(false);
    expect(optionsFromConfig({ options: ["a", 1, "b"] })).toEqual(["a", "b"]);
  });

  it("steps counters within bounds", () => {
    expect(stepCounter("4", 1, {})).toBe("5");
    expect(stepCounter(null, 1, {})).toBe("1");
    expect(stepCounter("5", 1, { max: 5 })).toBe("5");
    expect(stepCounter("0", -1, { min: 0 })).toBe("0");
  });

  it("ignores stale save responses", () => {
    expect(isLatestSave(3, 3)).toBe(true);
    expect(isLatestSave(2, 3)).toBe(false);
  });
});
