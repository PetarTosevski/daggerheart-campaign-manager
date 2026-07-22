import { describe, expect, it } from "vitest";

import {
  createCharacterSchema,
  updateCharacterSchema,
} from "@/lib/validation/characters";

const campaignId = "11111111-1111-4111-8111-111111111111";
const classId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const characterId = "44444444-4444-4444-8444-444444444444";

describe("createCharacterSchema", () => {
  it("accepts a valid payload and trims the name", () => {
    const result = createCharacterSchema.safeParse({
      campaignId,
      name: "  Kodak  ",
      classId,
      sheetTemplateId: templateId,
      notes: "  loyal to the refuge ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Kodak");
      expect(result.data.sheetTemplateId).toBe(templateId);
      expect(result.data.notes).toBe("loyal to the refuge");
    }
  });

  it("treats an empty template selection as null", () => {
    const result = createCharacterSchema.safeParse({
      campaignId,
      name: "Kodak",
      classId,
      sheetTemplateId: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sheetTemplateId).toBeNull();
    }
  });

  it("rejects a blank name", () => {
    const result = createCharacterSchema.safeParse({
      campaignId,
      name: "   ",
      classId,
      sheetTemplateId: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing class", () => {
    const result = createCharacterSchema.safeParse({
      campaignId,
      name: "Kodak",
      classId: "not-a-uuid",
      sheetTemplateId: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 100 characters", () => {
    const result = createCharacterSchema.safeParse({
      campaignId,
      name: "a".repeat(101),
      classId,
      sheetTemplateId: "",
      notes: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateCharacterSchema", () => {
  it("accepts a valid update", () => {
    const result = updateCharacterSchema.safeParse({
      characterId,
      name: "Kodak",
      status: "active",
      notes: "updated notes",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported status", () => {
    const result = updateCharacterSchema.safeParse({
      characterId,
      name: "Kodak",
      status: "deleted",
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank name", () => {
    const result = updateCharacterSchema.safeParse({
      characterId,
      name: "",
      status: "active",
      notes: "",
    });
    expect(result.success).toBe(false);
  });
});
