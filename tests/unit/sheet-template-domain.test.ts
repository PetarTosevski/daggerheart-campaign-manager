import { describe, expect, it } from "vitest";

import {
  buildTemplateObjectPath,
  checkPdfShape,
  clampPage,
  clampZoom,
  DEFAULT_ZOOM,
  hasPdfSignature,
  MAX_PDF_SIZE_BYTES,
  MAX_ZOOM,
  MIN_ZOOM,
  nextVersionNumber,
  PDF_MIME_TYPE,
  pdfShapeErrorMessage,
} from "@/lib/domain/sheet-templates";

const pdfHead = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

describe("hasPdfSignature", () => {
  it("accepts bytes starting with %PDF-", () => {
    expect(hasPdfSignature(pdfHead)).toBe(true);
  });

  it("rejects other bytes and short buffers", () => {
    expect(hasPdfSignature(new Uint8Array([0x00, 0x01]))).toBe(false);
    expect(hasPdfSignature(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe("checkPdfShape", () => {
  it("passes a well-formed small PDF", () => {
    expect(
      checkPdfShape({ size: 1000, mimeType: PDF_MIME_TYPE, head: pdfHead }),
    ).toBeNull();
  });

  it("rejects empty, oversized, wrong-type, and bad-signature inputs", () => {
    expect(
      checkPdfShape({ size: 0, mimeType: PDF_MIME_TYPE, head: pdfHead }),
    ).toBe("empty");
    expect(
      checkPdfShape({
        size: MAX_PDF_SIZE_BYTES + 1,
        mimeType: PDF_MIME_TYPE,
        head: pdfHead,
      }),
    ).toBe("too-large");
    expect(
      checkPdfShape({ size: 1000, mimeType: "image/png", head: pdfHead }),
    ).toBe("wrong-type");
    expect(
      checkPdfShape({
        size: 1000,
        mimeType: PDF_MIME_TYPE,
        head: new Uint8Array([0x00]),
      }),
    ).toBe("bad-signature");
  });

  it("maps every shape error to a message", () => {
    for (const err of ["empty", "too-large", "wrong-type", "bad-signature"] as const) {
      expect(pdfShapeErrorMessage(err)).toMatch(/\S/);
    }
  });
});

describe("buildTemplateObjectPath", () => {
  it("builds the deterministic immutable path", () => {
    expect(buildTemplateObjectPath("camp", "tmpl", "ver")).toBe(
      "camp/tmpl/ver/source.pdf",
    );
  });
});

describe("nextVersionNumber", () => {
  it("starts at 1 and increments past the max existing", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([1, 2, 3])).toBe(4);
    expect(nextVersionNumber([2, 5, 3])).toBe(6);
  });
});

describe("clampZoom / clampPage", () => {
  it("clamps zoom within bounds", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
  });

  it("clamps page within 1..pageCount", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(2, 0)).toBe(1);
  });
});
