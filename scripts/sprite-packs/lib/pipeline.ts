/**
 * The import pipeline shared by sprites:cut and sprites:build: decode a
 * folder's sheets (sharp), cut them with the pure cut core (P2), label the
 * cuts from the catalog (P1) in reading order, apply overrides.json (D8) and
 * resize every sprite to its final size (objects SPRITE_PX_PER_SQUARE per
 * square side, textures TEXTURE_PX per swatch, seam-fixed, D6).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import {
  CATALOG,
  entriesOnSheet,
  type CatalogEntry,
  type FolderCatalog,
  type Sheet,
} from "../../../src/lib/sprite-packs/catalog";
import { SHEET_GRIDS, cutSheet, cutTerrain, seamFix, tileability, trimToAlpha } from "../../../src/lib/sprite-packs/cut";
import type { Box, CutFlag, RgbaImage, TerrainFlag } from "../../../src/lib/sprite-packs/cut";
import { activeOverride, type Overrides } from "./overrides";

/** Pixels per square side of an object sprite (a 2 x 2 item is 320 px square at most). */
export const SPRITE_PX_PER_SQUARE = 160;
/** Pixels per side of a terrain swatch (it tiles TEXTURE_SQUARES squares). */
export const TEXTURE_PX = 512;

const SHEET_FILE = /^(props|large|terrain)(?:-([a-z0-9-]+))?\.(jpe?g|png|webp)$/;
const EXT_RANK = ["jpg", "jpeg", "png", "webp"];

export type Item = {
  key: string;
  entry: CatalogEntry;
  /** 1 = the catalog item's own cut; 2, 3, ... = extra cuts (D8). */
  variant: number;
  sheetId: string;
  cutIndex: number;
  /** Final-size RGBA. */
  image: RgbaImage;
  /** Size of the trimmed cut on the sheet. */
  sourcePx: { w: number; h: number };
  /** Textures: tileability before / after the seam fix. */
  tile?: { before: number; after: number };
};

export type Unassigned = { sheetId: string; cutIndex: number; image: RgbaImage; reason: string };

export type SheetResult = {
  id: string;
  folder: string;
  sheet: Sheet;
  extra: boolean;
  file: string | null;
  sheetPx: { w: number; h: number } | null;
  found: number;
  expected: number;
  method: string;
  /** Human-readable flags (count mismatch, border touch, ...). */
  flags: string[];
  /** What overrides did (or why one was inactive). */
  overrideNotes: string[];
  fringe: { before: number; after: number } | null;
  unassigned: Unassigned[];
  ms: number;
};

export type FolderResult = {
  folder: string;
  sheets: SheetResult[];
  /** Every built item, primary cuts first, in catalog order, then variants. */
  items: Item[];
  /** Catalog entries with no cut. */
  missing: CatalogEntry[];
};

type SheetFile = { sheet: Sheet; suffix: string | null; file: string };

/** The folder's sheet files: the three primary sheets and any extras (`large-2.jpg`). */
export function listSheets(src: string, folder: string): SheetFile[] {
  const dir = join(src, folder);
  if (!existsSync(dir)) return [];
  const found = new Map<string, SheetFile & { rank: number }>();
  for (const name of readdirSync(dir).sort()) {
    const m = SHEET_FILE.exec(name.toLowerCase());
    if (!m) continue;
    const sheet = m[1] as Sheet;
    const suffix = m[2] ?? null;
    const id = suffix ? `${sheet}-${suffix}` : sheet;
    const rank = EXT_RANK.indexOf(m[3] ?? "");
    const prev = found.get(id);
    if (!prev || rank < prev.rank) found.set(id, { sheet, suffix, file: join(dir, name), rank });
  }
  const order = (s: SheetFile) => ["props", "large", "terrain"].indexOf(s.sheet);
  return [...found.values()]
    .map(({ sheet, suffix, file }) => ({ sheet, suffix, file }))
    .sort((a, b) => Number(a.suffix !== null) - Number(b.suffix !== null) || order(a) - order(b) || (a.suffix ?? "").localeCompare(b.suffix ?? ""));
}

async function decode(file: string): Promise<RgbaImage> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

function cutFlagText(f: CutFlag): string {
  switch (f.code) {
    case "count-mismatch":
      return `count mismatch: found ${f.found}, expected ${f.expected}`;
    case "touches-border":
      return `#${f.index + 1} touches the border (kept)`;
    case "lines-removed":
      return `grid lines removed (${f.rows.length} rows, ${f.cols.length} columns)`;
    case "already-transparent":
      return "already transparent (keying skipped)";
    case "components-fallback":
      return "bands did not match the grid: connected components with nearest-merge";
    case "empty":
      return "empty sheet";
  }
}

function terrainFlagText(f: TerrainFlag): string {
  switch (f.code) {
    case "no-cross":
      return `no magenta cross along ${f.axis} (split at the middle)`;
    case "uneven-swatches":
      return "uneven swatches (off-centre cross)";
    case "magenta-left":
      return `magenta left in swatch #${f.index + 1}`;
  }
}

/**
 * Remove the pink aura of a soft glow drawn over magenta (P2's known limit):
 * every pixel whose colour leans magenta (min(R, B) above G) loses alpha in
 * proportion to that lean (fully gone at a lean of UNPINK_FULL), and the lean
 * is taken out of its colour. Fire, lantern glass and embers lean the other
 * way and stay. Applied only to cuts an override names, because purple
 * objects (the purple mushroom) lean magenta too.
 */
const UNPINK_START = 6;
const UNPINK_FULL = 70;
export function unpink(img: RgbaImage): RgbaImage {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a === 0) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const lean = Math.min(r, b) - g;
    if (lean <= UNPINK_START) continue;
    const k = Math.min(1, (lean - UNPINK_START) / (UNPINK_FULL - UNPINK_START));
    data[i + 3] = Math.round(a * (1 - k));
    data[i] = r - lean;
    data[i + 2] = b - lean;
  }
  return { width: img.width, height: img.height, data };
}

/**
 * Re-key a cut from the original sheet by unmixing it from the magenta
 * background, for thin light strands (spider webs, nets) that the normal key
 * and erosion remove: each pixel is read as object colour over #FF00FF, so
 * alpha = 1 - (min(R, B) - G) / 255 and the magenta share is subtracted from
 * the colour. No erosion. The region is the cut's box grown by UNMIX_GROW of
 * the sheet, clipped to its grid cell so neighbours stay out.
 */
const UNMIX_GROW = 0.04;
const UNMIX_FLOOR = 0.14;
export function unmix(sheet: RgbaImage, box: Box, grid: { rows: number; cols: number }): RgbaImage {
  const grow = Math.round(Math.max(sheet.width, sheet.height) * UNMIX_GROW);
  const cw = sheet.width / grid.cols;
  const ch = sheet.height / grid.rows;
  const cx = Math.floor((box.x + box.w / 2) / cw);
  const cy = Math.floor((box.y + box.h / 2) / ch);
  const x0 = Math.max(Math.floor(cx * cw), box.x - grow, 0);
  const y0 = Math.max(Math.floor(cy * ch), box.y - grow, 0);
  const x1 = Math.min(Math.ceil((cx + 1) * cw), box.x + box.w + grow, sheet.width);
  const y1 = Math.min(Math.ceil((cy + 1) * ch), box.y + box.h + grow, sheet.height);
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * sheet.width + x0 + x) * 4;
      const d = (y * w + x) * 4;
      const r = sheet.data[s] ?? 0;
      const g = sheet.data[s + 1] ?? 0;
      const b = sheet.data[s + 2] ?? 0;
      const lean = Math.max(0, Math.min(255, Math.min(r, b) - g));
      const raw = 1 - lean / 255;
      const alpha = Math.max(0, (raw - UNMIX_FLOOR) / (1 - UNMIX_FLOOR));
      if (alpha <= 0) continue;
      out[d] = (r - lean) / raw;
      out[d + 1] = g / raw;
      out[d + 2] = (b - lean) / raw;
      out[d + 3] = Math.round(alpha * 255);
    }
  const trimmed = trimToAlpha({ width: w, height: h, data: out });
  return trimmed ? trimmed.image : { width: w, height: h, data: out };
}

/** Rotate by a multiple of 90 degrees clockwise. */
function rotate90(img: RgbaImage, deg: number): RgbaImage {
  let cur = img;
  for (let t = 0; t < ((deg / 90) % 4 + 4) % 4; t++) {
    const { width: w, height: h, data } = cur;
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const d = (x * h + (h - 1 - y)) * 4;
        for (let c = 0; c < 4; c++) out[d + c] = data[s + c] ?? 0;
      }
    cur = { width: h, height: w, data: out };
  }
  return cur;
}

/** Resize an RGBA image to fit inside w x h (aspect kept), or exactly to w x h. */
async function resize(img: RgbaImage, w: number, h: number, fit: "inside" | "fill"): Promise<RgbaImage> {
  const { data, info } = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .resize(w, h, { fit, kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

async function finishObject(img: RgbaImage, entry: CatalogEntry): Promise<RgbaImage> {
  return resize(img, entry.w * SPRITE_PX_PER_SQUARE, entry.h * SPRITE_PX_PER_SQUARE, "inside");
}

async function finishTexture(img: RgbaImage): Promise<{ image: RgbaImage; tile: { before: number; after: number } }> {
  const sized = await resize(img, TEXTURE_PX, TEXTURE_PX, "fill");
  const fixed = seamFix(sized);
  const before = tileability(sized);
  const after = tileability(fixed);
  // A swatch that already tiles better than the fixed one is kept as drawn.
  return after >= before ? { image: fixed, tile: { before, after } } : { image: sized, tile: { before, after: before } };
}

/** The catalog entries drawn on one sheet (`props`, ... or an extra sheet id like `large-2`), in sheet order. */
function entriesOf(folder: FolderCatalog, sheet: Sheet, sheetId: string = sheet): readonly CatalogEntry[] {
  return entriesOnSheet<CatalogEntry>(folder[sheet], sheetId);
}

/** Extra sheets the catalog lists items for (sheet id -> layout). */
function catalogExtras(folder: FolderCatalog): Map<string, Sheet> {
  const out = new Map<string, Sheet>();
  for (const sheet of ["props", "large", "terrain"] as const)
    for (const e of folder[sheet]) if (e.extraSheet) out.set(e.extraSheet, sheet);
  return out;
}

function slugOf(entry: CatalogEntry): string {
  return entry.key.slice(entry.key.indexOf("/") + 1);
}

/** Cut, label and size every sheet of one folder. */
export async function processFolder(src: string, folderId: string, overrides: Overrides): Promise<FolderResult> {
  const folder = CATALOG[folderId as keyof typeof CATALOG];
  if (!folder) throw new Error(`unknown folder ${folderId}`);
  const files = listSheets(src, folderId);
  const sheets: SheetResult[] = [];
  const primary = new Map<string, Item>();
  const variants: Item[] = [];
  const variantCount = new Map<string, number>();
  const bySlug = new Map<string, CatalogEntry>();
  for (const sheet of ["props", "large", "terrain"] as const) for (const e of folder[sheet]) bySlug.set(slugOf(e), e);

  const present = new Set(files.map((f) => (f.suffix ? `${f.sheet}-${f.suffix}` : f.sheet)));
  const expectedSheets: Array<[string, Sheet]> = [
    ...(["props", "large", "terrain"] as const).map((s): [string, Sheet] => [s, s]),
    ...catalogExtras(folder),
  ];
  for (const [sheetId, sheet] of expectedSheets) {
    if (!present.has(sheetId))
      sheets.push({
        id: `${folderId}/${sheetId}`,
        folder: folderId,
        sheet,
        extra: sheetId !== sheet,
        file: null,
        sheetPx: null,
        found: 0,
        expected: entriesOf(folder, sheet, sheetId).length,
        method: "absent",
        flags: ["sheet file absent"],
        overrideNotes: [],
        fringe: null,
        unassigned: [],
        ms: 0,
      });
  }

  for (const f of files) {
    const started = Date.now();
    const sheetId = f.suffix ? `${f.sheet}-${f.suffix}` : f.sheet;
    const id = `${folderId}/${sheetId}`;
    const img = await decode(f.file);
    // An extra sheet's cuts are labelled from the catalog items listed for it (new items), if any.
    const expectedEntries = entriesOf(folder, f.sheet, sheetId);
    const result: SheetResult = {
      id,
      folder: folderId,
      sheet: f.sheet,
      extra: f.suffix !== null,
      file: f.file,
      sheetPx: { w: img.width, h: img.height },
      found: 0,
      expected: expectedEntries.length,
      method: "",
      flags: [],
      overrideNotes: [],
      fringe: null,
      unassigned: [],
      ms: 0,
    };

    // Cut into an ordered list of raw images.
    let cuts: RgbaImage[];
    let boxes: Box[] = [];
    if (f.sheet === "terrain") {
      const t = cutTerrain(img);
      cuts = t.swatches.map((s) => s.image);
      result.method = "terrain";
      result.flags.push(...t.flags.map(terrainFlagText));
    } else {
      const c = cutSheet(img, { layout: f.sheet });
      cuts = c.sprites.map((s) => s.image);
      boxes = c.sprites.map((s) => s.box);
      result.method = c.method;
      result.fringe = c.fringe;
      result.flags.push(...c.flags.map(cutFlagText));
    }
    result.found = cuts.length;

    // Overrides.
    const { active, notes } = activeOverride(overrides, id, cuts.length);
    result.overrideNotes.push(...notes);
    for (const i of active.unmix ?? []) {
      const box = boxes[i];
      if (!box || f.sheet === "terrain") throw new Error(`overrides ${id}: unmix #${i + 1} has no cut`);
      cuts[i] = unmix(img, box, SHEET_GRIDS[f.sheet]);
      result.overrideNotes.push(`#${i + 1}: re-keyed by unmixing (thin strands kept)`);
    }
    for (const i of active.unpink ?? []) {
      const cut = cuts[i];
      if (!cut) throw new Error(`overrides ${id}: unpink #${i + 1} has no cut`);
      cuts[i] = unpink(cut);
      result.overrideNotes.push(`#${i + 1}: pink aura removed (unpink)`);
    }
    for (const [k, deg] of Object.entries(active.rotate ?? {})) {
      const i = Number(k);
      const cut = cuts[i];
      if (!cut) throw new Error(`overrides ${id}: rotate #${i + 1} has no cut`);
      cuts[i] = rotate90(cut, deg);
      result.overrideNotes.push(`#${i + 1}: rotated ${deg} degrees`);
    }
    const taken = new Set<number>();
    for (const i of active.skip ?? []) {
      taken.add(i);
      result.overrideNotes.push(`#${i + 1}: skipped`);
    }
    const variantCuts: Array<[number, CatalogEntry]> = [];
    for (const [k, slug] of Object.entries(active.variants ?? {})) {
      const i = Number(k);
      const entry = bySlug.get(slug);
      if (!entry) throw new Error(`overrides ${id}: no catalog item ${folderId}/${slug}`);
      if (!cuts[i]) throw new Error(`overrides ${id}: no cut #${i + 1} (found ${cuts.length})`);
      taken.add(i);
      variantCuts.push([i, entry]);
    }

    // Label the sheet's sequence (an extra sheet only when the catalog lists items for it).
    const sequence: number[] = [];
    if (expectedEntries.length > 0) {
      if (active.order) {
        sequence.push(...active.order);
        result.overrideNotes.push(`order: ${active.order.map((i) => `#${i + 1}`).join(" ")}`);
      } else for (let i = 0; i < cuts.length; i++) if (!taken.has(i)) sequence.push(i);
    }
    const labelled = new Set<number>();
    for (let pos = 0; pos < expectedEntries.length && pos < sequence.length; pos++) {
      const entry = expectedEntries[pos];
      const i = sequence[pos];
      const cut = i === undefined ? undefined : cuts[i];
      if (!entry || i === undefined || !cut) continue;
      labelled.add(i);
      primary.set(entry.key, await buildItem(entry, 1, id, i, cut));
    }
    for (const [i, entry] of variantCuts) {
      const cut = cuts[i];
      if (!cut) continue;
      if (entry.sheet === "terrain" ? f.sheet !== "terrain" : f.sheet === "terrain")
        throw new Error(`overrides ${id}: cut #${i + 1} and ${entry.key} are not the same category`);
      const n = (variantCount.get(entry.key) ?? 1) + 1;
      variantCount.set(entry.key, n);
      labelled.add(i);
      variants.push(await buildItem(entry, n, id, i, cut));
      result.overrideNotes.push(`#${i + 1}: variant ${n} of ${slugOf(entry)}`);
    }
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i];
      if (!cut || labelled.has(i) || taken.has(i)) continue;
      const preview =
        f.sheet === "terrain"
          ? (await finishTexture(cut)).image
          : await resize(cut, 2 * SPRITE_PX_PER_SQUARE, 2 * SPRITE_PX_PER_SQUARE, "inside");
      result.unassigned.push({
        sheetId: id,
        cutIndex: i,
        image: preview,
        reason:
          result.extra && expectedEntries.length === 0
            ? "extra sheet: no catalog items listed for it and not named in overrides.json"
            : "more cuts than catalog names",
      });
    }
    if (result.unassigned.length > 0)
      result.flags.push(`${result.unassigned.length} unassigned cut(s): ${result.unassigned.map((u) => `#${u.cutIndex + 1}`).join(" ")}`);

    // Orientation check for long items (2 x 1 drawn upright).
    for (const item of [...primary.values(), ...variants]) {
      if (item.sheetId !== id || item.entry.w === item.entry.h) continue;
      const wide = item.entry.w > item.entry.h;
      const ratio = item.sourcePx.w / item.sourcePx.h;
      if (wide ? ratio < 0.87 : ratio > 1.15)
        result.flags.push(`#${item.cutIndex + 1} ${item.entry.name}: drawn ${wide ? "upright" : "sideways"} but sized ${item.entry.w} x ${item.entry.h}`);
    }
    result.ms = Date.now() - started;
    sheets.push(result);
  }

  const items: Item[] = [];
  const missing: CatalogEntry[] = [];
  for (const sheet of ["props", "large", "terrain"] as const)
    for (const e of folder[sheet]) {
      const it = primary.get(e.key);
      if (it) items.push(it);
      else missing.push(e);
    }
  // A variant of an item with no primary cut has nothing to vary: it becomes the primary.
  for (const v of variants) {
    if (primary.has(v.key) || items.some((i) => i.key === v.key && i.variant === 1)) items.push(v);
    else {
      items.push({ ...v, variant: 1 });
      missing.splice(missing.indexOf(v.entry), 1);
    }
  }
  const sheetOrder = (s: SheetResult) => Number(s.extra) * 10 + ["props", "large", "terrain"].indexOf(s.sheet);
  sheets.sort((a, b) => sheetOrder(a) - sheetOrder(b) || a.id.localeCompare(b.id));
  return { folder: folderId, sheets, items, missing };
}

async function buildItem(entry: CatalogEntry, variant: number, sheetId: string, cutIndex: number, cut: RgbaImage): Promise<Item> {
  const sourcePx = { w: cut.width, h: cut.height };
  if (entry.category === "texture") {
    const { image, tile } = await finishTexture(cut);
    return { key: entry.key, entry, variant, sheetId, cutIndex, image, sourcePx, tile };
  }
  return { key: entry.key, entry, variant, sheetId, cutIndex, image: await finishObject(cut, entry), sourcePx };
}
