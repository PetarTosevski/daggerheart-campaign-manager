import { describe, expect, it } from "vitest";

import {
  clampRect,
  COMPUTED_FORMULAS,
  FIELD_TYPES,
  findFieldSetError,
  isRectWithinPage,
  isReservedFieldKey,
  isValidFieldKey,
  normalizeFieldKey,
  RESERVED_FIELD_KEYS,
  type SheetFieldDefinition,
} from "@/lib/domain/sheet-templates";

function field(overrides: Partial<SheetFieldDefinition> = {}): SheetFieldDefinition {
  return {
    field_key: "character_name",
    label: "Name",
    field_type: "text",
    page_number: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    configuration: {},
    display_order: 0,
    is_required: false,
    is_active: true,
    ...overrides,
  };
}

describe("field keys", () => {
  it("validates key format", () => {
    expect(isValidFieldKey("character_name")).toBe(true);
    expect(isValidFieldKey("food_rations")).toBe(true);
    expect(isValidFieldKey("Name")).toBe(false);
    expect(isValidFieldKey("1name")).toBe(false);
    expect(isValidFieldKey("has space")).toBe(false);
    expect(isValidFieldKey("")).toBe(false);
  });

  it("recognizes reserved keys", () => {
    expect(RESERVED_FIELD_KEYS).toContain("wither_tokens");
    expect(isReservedFieldKey("food_rations")).toBe(true);
    expect(isReservedFieldKey("strength")).toBe(false);
  });

  it("normalizes labels into valid keys", () => {
    expect(isValidFieldKey(normalizeFieldKey("Character Name"))).toBe(true);
    expect(normalizeFieldKey("Character Name!")).toBe("character_name");
    expect(normalizeFieldKey("123")).toBe("field");
    expect(normalizeFieldKey("")).toBe("field");
  });
});

describe("clampRect / isRectWithinPage", () => {
  it("keeps rects inside the page", () => {
    const r = clampRect({ x: 0.95, y: 0.95, width: 0.3, height: 0.3 });
    expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
    expect(isRectWithinPage(r)).toBe(true);
  });

  it("enforces a positive minimum size", () => {
    const r = clampRect({ x: 0.5, y: 0.5, width: 0, height: -1 });
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it("rejects out-of-bounds rects", () => {
    expect(isRectWithinPage(field({ x: 0.9, width: 0.5 }))).toBe(false);
    expect(isRectWithinPage(field({ width: 0 }))).toBe(false);
  });
});

describe("findFieldSetError", () => {
  it("accepts a valid set", () => {
    expect(
      findFieldSetError([field(), field({ field_key: "class_name" })], 2),
    ).toBeNull();
  });

  it("rejects invalid keys and types", () => {
    expect(findFieldSetError([field({ field_key: "Bad Key" })], 1)).toMatch(/key/i);
    expect(
      findFieldSetError(
        [field({ field_type: "bogus" as never })],
        1,
      ),
    ).toMatch(/type/i);
  });

  it("rejects invalid pages and out-of-bounds rects", () => {
    expect(findFieldSetError([field({ page_number: 3 })], 2)).toMatch(/page/i);
    expect(findFieldSetError([field({ x: 0.9, width: 0.5 })], 1)).toMatch(/bounds/i);
  });

  it("rejects duplicate active keys but allows a deactivated duplicate", () => {
    expect(
      findFieldSetError([field(), field({ label: "dup" })], 1),
    ).toMatch(/duplicate/i);
    expect(
      findFieldSetError(
        [field(), field({ label: "dup", is_active: false })],
        1,
      ),
    ).toBeNull();
  });
});

describe("constants", () => {
  it("exposes the nine field types and computed formulas", () => {
    expect(FIELD_TYPES).toHaveLength(9);
    expect(FIELD_TYPES).toContain("computed");
    expect(COMPUTED_FORMULAS).toContain("none");
  });
});
