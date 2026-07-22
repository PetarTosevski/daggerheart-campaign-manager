import { createHash } from "node:crypto";

import {
  checkPdfShape,
  MAX_PDF_PAGE_COUNT,
  pdfShapeErrorMessage,
  PDF_MIME_TYPE,
} from "@/lib/domain/sheet-templates";

/**
 * Server-only PDF validation for Task 011A uploads. Runs the cheap shape checks
 * (size, MIME, signature) first, then parses the document with unpdf to confirm
 * it is not corrupt and to extract the page count. Returns validated metadata or
 * throws a PdfValidationError whose message is safe to surface to the GM.
 *
 * This never modifies the PDF; it only inspects the bytes.
 */
export class PdfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfValidationError";
  }
}

export type ValidatedPdf = {
  size: number;
  pageCount: number;
  checksum: string;
};

export function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validatePdfUpload(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<ValidatedPdf> {
  const { bytes, mimeType } = input;

  const shapeError = checkPdfShape({
    size: bytes.byteLength,
    mimeType: mimeType || PDF_MIME_TYPE,
    head: bytes.subarray(0, 5),
  });
  if (shapeError) {
    throw new PdfValidationError(pdfShapeErrorMessage(shapeError));
  }

  let pageCount: number;
  try {
    // Import lazily so the heavy PDF runtime is only loaded on upload.
    const { getDocumentProxy } = await import("unpdf");
    // Copy into a fresh Uint8Array: pdf.js transfers/detaches the buffer.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    pageCount = pdf.numPages;
  } catch {
    throw new PdfValidationError(
      "The PDF could not be read. It may be corrupt or password-protected.",
    );
  }

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PdfValidationError("The PDF has no readable pages.");
  }
  if (pageCount > MAX_PDF_PAGE_COUNT) {
    throw new PdfValidationError(
      `The PDF has too many pages (limit ${MAX_PDF_PAGE_COUNT}).`,
    );
  }

  return {
    size: bytes.byteLength,
    pageCount,
    checksum: computeSha256Hex(bytes),
  };
}
