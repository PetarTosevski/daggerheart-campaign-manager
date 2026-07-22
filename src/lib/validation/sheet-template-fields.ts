import { z } from "zod";

import { FIELD_TYPES } from "@/lib/domain/sheet-templates";

const normalized = z.number().min(0).max(1);

export const fieldDefinitionSchema = z.object({
  field_key: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9_]{0,63}$/,
      "Keys are lowercase, start with a letter, and use letters, numbers, or underscores.",
    ),
  label: z.string().trim().min(1, "Enter a label.").max(100),
  field_type: z.enum(FIELD_TYPES),
  page_number: z.number().int().min(1),
  x: normalized,
  y: normalized,
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  configuration: z.record(z.string(), z.unknown()).default({}),
  display_order: z.number().int().min(0).default(0),
  is_required: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export const saveTemplateFieldsSchema = z.object({
  templateVersionId: z.uuid("Select a valid template version."),
  fields: z.array(fieldDefinitionSchema),
});

export const publishTemplateVersionSchema = z.object({
  templateVersionId: z.uuid("Select a valid template version."),
});

export const reviseTemplateVersionSchema = z.object({
  sourceVersionId: z.uuid("Select a valid template version."),
});

export type FieldDefinitionInput = z.infer<typeof fieldDefinitionSchema>;
