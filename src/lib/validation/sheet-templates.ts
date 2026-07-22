import { z } from "zod";

// Field validation for sheet-template PDF operations. The uploaded file's bytes
// are validated separately by the server PDF validator (signature, size, page
// count); these schemas cover the identifier inputs.

export const uploadTemplateVersionSchema = z.object({
  templateId: z.uuid("Select a valid template."),
});

export const archiveTemplateVersionSchema = z.object({
  versionId: z.uuid("Select a valid version."),
});

export type UploadTemplateVersionInput = z.infer<
  typeof uploadTemplateVersionSchema
>;
export type ArchiveTemplateVersionInput = z.infer<
  typeof archiveTemplateVersionSchema
>;
