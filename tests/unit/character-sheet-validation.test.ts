import { describe, expect, it } from "vitest";

import {
  pinCharacterSheetVersionSchema,
  saveCharacterSheetValueSchema,
} from "@/lib/validation/character-sheet";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("saveCharacterSheetValueSchema", () => {
  it("accepts a valid payload (empty value clears)", () => {
    expect(
      saveCharacterSheetValueSchema.safeParse({
        characterId: uuid,
        templateFieldId: uuid,
        value: "",
        expectedUpdatedAt: "",
      }).success,
    ).toBe(true);
  });

  it("rejects bad ids and overlong values", () => {
    expect(
      saveCharacterSheetValueSchema.safeParse({
        characterId: "x",
        templateFieldId: uuid,
        value: "v",
        expectedUpdatedAt: "",
      }).success,
    ).toBe(false);
    expect(
      saveCharacterSheetValueSchema.safeParse({
        characterId: uuid,
        templateFieldId: uuid,
        value: "x".repeat(10001),
        expectedUpdatedAt: "",
      }).success,
    ).toBe(false);
  });
});

describe("pinCharacterSheetVersionSchema", () => {
  it("requires a valid character id", () => {
    expect(pinCharacterSheetVersionSchema.safeParse({ characterId: uuid }).success).toBe(true);
    expect(pinCharacterSheetVersionSchema.safeParse({ characterId: "x" }).success).toBe(false);
  });
});
