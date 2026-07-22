import { describe, expect, it } from "vitest";

import {
  fieldDefinitionSchema,
  publishTemplateVersionSchema,
  reviseTemplateVersionSchema,
  saveTemplateFieldsSchema,
} from "@/lib/validation/sheet-template-fields";

const uuid = "11111111-1111-4111-8111-111111111111";

const validField = {
  field_key: "character_name",
  label: "Name",
  field_type: "text",
  page_number: 1,
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.05,
};

describe("fieldDefinitionSchema", () => {
  it("accepts a valid field and applies defaults", () => {
    const result = fieldDefinitionSchema.safeParse(validField);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_active).toBe(true);
      expect(result.data.is_required).toBe(false);
      expect(result.data.configuration).toEqual({});
    }
  });

  it("rejects bad keys, types, and coordinates", () => {
    expect(
      fieldDefinitionSchema.safeParse({ ...validField, field_key: "Bad" }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({ ...validField, field_type: "nope" }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({ ...validField, x: 1.5 }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({ ...validField, width: 0 }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({ ...validField, page_number: 0 }).success,
    ).toBe(false);
  });
});

describe("save/publish/revise schemas", () => {
  it("validates identifiers and field arrays", () => {
    expect(
      saveTemplateFieldsSchema.safeParse({
        templateVersionId: uuid,
        fields: [validField],
      }).success,
    ).toBe(true);
    expect(
      saveTemplateFieldsSchema.safeParse({ templateVersionId: "x", fields: [] })
        .success,
    ).toBe(false);
    expect(
      publishTemplateVersionSchema.safeParse({ templateVersionId: uuid }).success,
    ).toBe(true);
    expect(
      reviseTemplateVersionSchema.safeParse({ sourceVersionId: uuid }).success,
    ).toBe(true);
  });
});
