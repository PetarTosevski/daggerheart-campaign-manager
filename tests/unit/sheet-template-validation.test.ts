import { describe, expect, it } from "vitest";

import {
  archiveTemplateVersionSchema,
  uploadTemplateVersionSchema,
} from "@/lib/validation/sheet-templates";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("uploadTemplateVersionSchema", () => {
  it("accepts a valid template id", () => {
    expect(uploadTemplateVersionSchema.safeParse({ templateId: uuid }).success).toBe(
      true,
    );
  });

  it("rejects a non-uuid template id", () => {
    expect(
      uploadTemplateVersionSchema.safeParse({ templateId: "nope" }).success,
    ).toBe(false);
  });
});

describe("archiveTemplateVersionSchema", () => {
  it("accepts a valid version id", () => {
    expect(archiveTemplateVersionSchema.safeParse({ versionId: uuid }).success).toBe(
      true,
    );
  });

  it("rejects a non-uuid version id", () => {
    expect(
      archiveTemplateVersionSchema.safeParse({ versionId: "nope" }).success,
    ).toBe(false);
  });
});
