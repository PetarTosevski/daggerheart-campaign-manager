// Sheet-template PDF domain rules for Task 011A.
//
// Pure, framework-independent helpers shared by server validation, storage, and
// the viewer. No PDF parsing or rendering happens here; those require the runtime
// libraries and live in server/client modules. This module holds the constants
// and deterministic rules that must stay identical across layers.

export const TEMPLATE_STORAGE_BUCKET = "character-sheet-templates";
export const PDF_MIME_TYPE = "application/pdf";

/** 25 MiB. Mirrors the database and storage-bucket limits exactly. */
export const MAX_PDF_SIZE_BYTES = 26_214_400;
export const MAX_PDF_PAGE_COUNT = 100;

export const TEMPLATE_VERSION_STATUSES = ["active", "archived"] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

// Viewer zoom bounds shared by the zoom controls and page canvas.
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.25;
export const DEFAULT_ZOOM = 1;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isInteger(page)) return 1;
  if (pageCount < 1) return 1;
  return Math.min(pageCount, Math.max(1, page));
}

/**
 * Deterministic, immutable object path for a template version. The database
 * function independently recomputes and enforces this exact layout, so a client
 * cannot point version metadata at an arbitrary object.
 */
export function buildTemplateObjectPath(
  campaignId: string,
  templateId: string,
  versionId: string,
): string {
  return `${campaignId}/${templateId}/${versionId}/source.pdf`;
}

/** The next version number given the existing numbers for a template. */
export function nextVersionNumber(existing: readonly number[]): number {
  return existing.reduce((max, current) => Math.max(max, current), 0) + 1;
}

/** True when the bytes begin with the PDF file signature (`%PDF-`). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

export type PdfShapeError =
  | "empty"
  | "too-large"
  | "wrong-type"
  | "bad-signature";

/**
 * Validates the parts of an uploaded file that do not require parsing: it is
 * non-empty, within the size limit, declared as a PDF, and starts with the PDF
 * signature. Corruption and page-count checks require parsing and happen in the
 * server validator. Returns null when the shape is acceptable.
 */
export function checkPdfShape(input: {
  size: number;
  mimeType: string;
  head: Uint8Array;
}): PdfShapeError | null {
  if (input.size <= 0) return "empty";
  if (input.size > MAX_PDF_SIZE_BYTES) return "too-large";
  if (input.mimeType !== PDF_MIME_TYPE) return "wrong-type";
  if (!hasPdfSignature(input.head)) return "bad-signature";
  return null;
}

export function pdfShapeErrorMessage(error: PdfShapeError): string {
  switch (error) {
    case "empty":
      return "The file is empty.";
    case "too-large":
      return "The PDF exceeds the 25 MB limit.";
    case "wrong-type":
      return "Only PDF files are accepted.";
    case "bad-signature":
      return "The file is not a valid PDF.";
  }
}

// ---------------------------------------------------------------------------
// Task 011B — Sheet template field definitions
// ---------------------------------------------------------------------------

export const LAYOUT_STATUSES = ["draft", "published"] as const;
export type LayoutStatus = (typeof LAYOUT_STATUSES)[number];

export const FIELD_TYPES = [
  "text",
  "multiline_text",
  "number",
  "checkbox",
  "select",
  "radio",
  "image",
  "counter",
  "computed",
] as const;
export type SheetFieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<SheetFieldType, string> = {
  text: "Text",
  multiline_text: "Multiline text",
  number: "Number",
  checkbox: "Checkbox",
  select: "Select",
  radio: "Radio",
  image: "Image",
  counter: "Counter",
  computed: "Computed",
};

/** Field types whose configuration carries a list of options. */
export const OPTION_FIELD_TYPES: readonly SheetFieldType[] = ["select", "radio"];

/**
 * Reserved keys established by the architecture. They behave as ordinary
 * editable fields in Task 011B and are intentionally NOT connected to the food
 * or Wither systems yet.
 */
export const RESERVED_FIELD_KEYS = [
  "food_rations",
  "food_portions",
  "wither_tokens",
] as const;

/** Recommended common keys offered as quick-add presets. */
export const COMMON_FIELD_KEYS = [
  "character_name",
  "class_name",
  "portrait",
  "notes",
] as const;

/**
 * Predefined, safe computed formulas. Task 011B stores the choice but does not
 * evaluate it (runtime calculation is Task 011C). `none` is a placeholder.
 */
export const COMPUTED_FORMULAS = ["none", "sum", "difference"] as const;
export type ComputedFormula = (typeof COMPUTED_FORMULAS)[number];

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidFieldKey(key: string): boolean {
  return FIELD_KEY_PATTERN.test(key);
}

export function isReservedFieldKey(key: string): boolean {
  return (RESERVED_FIELD_KEYS as readonly string[]).includes(key);
}

/**
 * Derives a stable field key from a human label: lowercased, non-alphanumeric
 * runs collapsed to underscores, trimmed to the key rules. Returns `field` when
 * nothing usable remains.
 */
export function normalizeFieldKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]+/, "")
    .replace(/^_+/, "")
    .slice(0, 64);
  return base && FIELD_KEY_PATTERN.test(base) ? base : "field";
}

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_FIELD_SIZE = 0.01;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Clamps a normalized rect so it stays within the page (0..1 on both axes) with
 * a positive size. Used by the editor after drag/resize and by numeric entry so
 * placement never leaves the page or inverts.
 */
export function clampRect(rect: NormalizedRect): NormalizedRect {
  const width = Math.min(1, Math.max(MIN_FIELD_SIZE, rect.width));
  const height = Math.min(1, Math.max(MIN_FIELD_SIZE, rect.height));
  const x = Math.min(clamp01(rect.x), 1 - width);
  const y = Math.min(clamp01(rect.y), 1 - height);
  return { x, y, width, height };
}

export function isRectWithinPage(rect: NormalizedRect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 + 1e-9 &&
    rect.y + rect.height <= 1 + 1e-9
  );
}

export type SheetFieldDefinition = {
  field_key: string;
  label: string;
  field_type: SheetFieldType;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  configuration: Record<string, unknown>;
  display_order: number;
  is_required: boolean;
  is_active: boolean;
};

/**
 * Ensures a set of field definitions is internally consistent before saving:
 * valid keys/types, in-range pages, in-bounds rects, and no duplicate active
 * keys. Returns the first problem message, or null when the set is valid. The
 * database enforces the same rules; this gives immediate editor feedback.
 */
export function findFieldSetError(
  fields: readonly SheetFieldDefinition[],
  pageCount: number,
): string | null {
  const activeKeys = new Set<string>();
  for (const field of fields) {
    if (!isValidFieldKey(field.field_key)) {
      return `Invalid field key: ${field.field_key || "(empty)"}`;
    }
    if (!(FIELD_TYPES as readonly string[]).includes(field.field_type)) {
      return `Unsupported field type: ${field.field_type}`;
    }
    if (
      !Number.isInteger(field.page_number) ||
      field.page_number < 1 ||
      field.page_number > pageCount
    ) {
      return `Field "${field.field_key}" references an invalid page.`;
    }
    if (!isRectWithinPage(field)) {
      return `Field "${field.field_key}" is outside the page bounds.`;
    }
    if (field.is_active) {
      const lower = field.field_key.toLowerCase();
      if (activeKeys.has(lower)) {
        return `Duplicate field key: ${field.field_key}`;
      }
      activeKeys.add(lower);
    }
  }
  return null;
}
