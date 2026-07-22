// @vitest-environment node
//
// Server-side PDF validation. The synthetic cases always run; the real
// page-count extraction runs only when the reference PDF is present (guarded so
// default CI without the binary stays green).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeSha256Hex,
  PdfValidationError,
  validatePdfUpload,
} from "@/lib/pdf/validate";

const PDF_MIME = "application/pdf";

function pdfBytes(body: string): Uint8Array {
  return new TextEncoder().encode(body);
}

describe("validatePdfUpload (synthetic)", () => {
  it("rejects an empty file", async () => {
    await expect(
      validatePdfUpload({ bytes: new Uint8Array(), mimeType: PDF_MIME }),
    ).rejects.toBeInstanceOf(PdfValidationError);
  });

  it("rejects a non-PDF mime type", async () => {
    await expect(
      validatePdfUpload({ bytes: pdfBytes("%PDF-1.4 stuff"), mimeType: "image/png" }),
    ).rejects.toThrow(/only pdf/i);
  });

  it("rejects a file without the PDF signature", async () => {
    await expect(
      validatePdfUpload({ bytes: pdfBytes("NOT A PDF"), mimeType: PDF_MIME }),
    ).rejects.toThrow(/not a valid pdf/i);
  });

  it("rejects a signature-only but corrupt PDF", async () => {
    // Starts with %PDF- to pass the shape check, but is not parseable.
    await expect(
      validatePdfUpload({ bytes: pdfBytes("%PDF-1.4\ngarbage"), mimeType: PDF_MIME }),
    ).rejects.toThrow(/could not be read|no readable pages/i);
  });
});

describe("computeSha256Hex", () => {
  it("is deterministic", () => {
    const bytes = pdfBytes("hello");
    expect(computeSha256Hex(bytes)).toBe(computeSha256Hex(bytes));
    expect(computeSha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });
});

const referenceDir = join(process.cwd(), "reference", "official");
const referencePdf =
  existsSync(referenceDir) &&
  readdirSync(referenceDir).find((name) => name.toLowerCase().endsWith(".pdf"));

const maybeIt = referencePdf ? it : it.skip;

describe("validatePdfUpload (reference PDF)", () => {
  maybeIt("extracts a real page count and checksum", async () => {
    const bytes = new Uint8Array(
      readFileSync(join(referenceDir, referencePdf as string)),
    );
    const result = await validatePdfUpload({ bytes, mimeType: PDF_MIME });
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.size).toBe(bytes.byteLength);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);
});
