/**
 * Review output in sprite-sheets/_out/ (git-ignored): per folder a contact
 * sheet PNG (every cut on a checkerboard with index, name, size, sight, light
 * and the app's shadow preview; every terrain swatch tiled 3 x 3), candidate
 * PNGs, an overall contact sheet, report.html and a printed summary.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import sharp, { type OverlayOptions } from "sharp";

import type { RgbaImage } from "../../../src/lib/sprite-packs/cut";
import type { CatalogEntry } from "../../../src/lib/sprite-packs/catalog";
import { png, type Encoded } from "./encode";
import type { FolderResult, Item, SheetResult } from "./pipeline";

/** Tileability below this is flagged (after the seam fix). */
export const LOW_TILEABILITY = 0.5;

// Shadow preview (D5): light from the top left, shadow to the bottom right. P6 owns the real constants.
const SHADOW_ALPHA = 0.4;
const SHADOW_OFFSET = { flat: 0, low: 0.05, tall: 0.1 } as const;
const SHADOW_BLUR = 0.025;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sharpRaw(img: RgbaImage) {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  });
}

/** The sprite with the app's drop shadow under it (padded so the shadow fits). */
async function withShadow(img: RgbaImage, height: "flat" | "low" | "tall"): Promise<Buffer> {
  const size = Math.max(img.width, img.height);
  const off = Math.round(size * SHADOW_OFFSET[height]);
  if (off === 0) return png(img);
  const sigma = Math.max(0.5, size * SHADOW_BLUR);
  const pad = Math.ceil(sigma * 3);
  const shadow = new Uint8ClampedArray(img.data.length);
  for (let i = 3; i < img.data.length; i += 4) shadow[i] = Math.round((img.data[i] ?? 0) * SHADOW_ALPHA);
  const shadowPng = await sharpRaw({ width: img.width, height: img.height, data: shadow })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(sigma)
    .png()
    .toBuffer();
  const W = img.width + off + pad * 2;
  const H = img.height + off + pad * 2;
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: shadowPng, left: off, top: off },
      { input: await png(img), left: pad, top: pad },
    ])
    .png()
    .toBuffer();
}

/** Fit a PNG into a box, returning the buffer and its placement offset inside the box. */
async function fit(input: Buffer, box: number): Promise<{ buf: Buffer; dx: number; dy: number }> {
  const buf = await sharp(input).resize(box, box, { fit: "inside", kernel: "lanczos3", withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { buf, dx: Math.floor((box - (meta.width ?? box)) / 2), dy: Math.floor((box - (meta.height ?? box)) / 2) };
}

async function tile3x3(img: RgbaImage, tilePx: number): Promise<Buffer> {
  const one = await sharpRaw(img).resize(tilePx, tilePx).png().toBuffer();
  const composites = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) composites.push({ input: one, left: x * tilePx, top: y * tilePx });
  return sharp({ create: { width: tilePx * 3, height: tilePx * 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(composites)
    .png()
    .toBuffer();
}

const CHECKER = `<pattern id="ck" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#d8d8d8"/><rect width="8" height="8" fill="#f4f4f4"/><rect x="8" y="8" width="8" height="8" fill="#f4f4f4"/></pattern>`;

function traitLine(e: CatalogEntry): string {
  if (e.category === "texture") return `${e.terrain}${e.rotatable ? " · rotatable" : ""}`;
  return `${e.w}x${e.h} · ${e.sight}${e.light !== "none" ? ` · ${e.light}` : ""} · ${e.height}`;
}

type Cell = { image: RgbaImage; height: "flat" | "low" | "tall"; lines: string[]; warn: boolean };

const W = 1560;
const COLS = 8;
const CELL_W = W / COLS;
const BOX = 150;
const CELL_H = BOX + 62;
const TERRAIN_TILE = 120;

/** One folder's contact sheet PNG. */
export async function folderContactSheet(folder: FolderResult): Promise<Buffer> {
  const svg: string[] = [];
  const composites: OverlayOptions[] = [];
  let y = 0;
  const text = (x: number, ty: number, s: string, opts = "") =>
    svg.push(`<text x="${x}" y="${ty}" font-family="DejaVu Sans, sans-serif" ${opts}>${esc(s)}</text>`);

  text(16, 34, `${folder.folder}`, `font-size="26" font-weight="bold"`);
  const missing = folder.missing.length;
  text(Math.max(320, 30 + folder.folder.length * 17), 34, `${folder.items.filter((i) => i.variant === 1).length} sprites · ${folder.items.filter((i) => i.variant > 1).length} variants · ${missing} missing`, `font-size="16" fill="${missing ? "#b00" : "#333"}"`);
  y = 52;

  for (const sheet of folder.sheets) {
    text(16, y + 22, `${sheet.id}${sheet.extra ? " (extra)" : ""}  ·  found ${sheet.found}${sheet.expected ? ` / ${sheet.expected}` : ""}  ·  ${sheet.method}`, `font-size="17" font-weight="bold"`);
    y += 30;
    for (const line of [...sheet.flags.map((f) => `⚑ ${f}`), ...sheet.overrideNotes.map((n) => `✎ ${n}`)]) {
      text(24, y + 16, line, `font-size="13" fill="${line.startsWith("⚑") ? "#b00" : "#05a"}"`);
      y += 18;
    }
    y += 6;
    const items = folder.items.filter((i) => i.sheetId === sheet.id).sort((a, b) => a.cutIndex - b.cutIndex);
    if (!sheet.file) continue;
    if (sheet.sheet === "terrain") {
      let x = 16;
      for (const item of items) {
        const size = TERRAIN_TILE * 3;
        composites.push({ input: await tile3x3(item.image, TERRAIN_TILE), left: x, top: y });
        const low = (item.tile?.after ?? 1) < LOW_TILEABILITY;
        text(x, y + size + 18, `#${item.cutIndex + 1} ${item.entry.name}${item.variant > 1 ? ` (v${item.variant})` : ""}`, `font-size="13" font-weight="bold"`);
        text(x, y + size + 34, `${traitLine(item.entry)} · tile ${item.tile?.before.toFixed(2)} → ${item.tile?.after.toFixed(2)}`, `font-size="12" fill="${low ? "#b00" : "#333"}"`);
        x += size + 22;
      }
      for (const u of sheet.unassigned) {
        const size = TERRAIN_TILE * 3;
        composites.push({ input: await tile3x3(u.image, TERRAIN_TILE), left: x, top: y });
        text(x, y + size + 18, `#${u.cutIndex + 1} unassigned`, `font-size="13" font-weight="bold" fill="#b00"`);
        x += size + 22;
      }
      y += TERRAIN_TILE * 3 + 46;
      continue;
    }
    const cells: Cell[] = items.map((item) => ({
      image: item.image,
      height: item.entry.height,
      lines: [
        `#${item.cutIndex + 1} ${item.entry.name}${item.variant > 1 ? ` (v${item.variant})` : ""}`,
        traitLine(item.entry),
        `${item.image.width}x${item.image.height} px`,
      ],
      warn: false,
    }));
    for (const u of sheet.unassigned)
      cells.push({ image: u.image, height: "low", lines: [`#${u.cutIndex + 1} UNASSIGNED`, u.reason, `${u.image.width}x${u.image.height} px`], warn: true });
    for (let n = 0; n < cells.length; n++) {
      const c = cells[n];
      if (!c) continue;
      const cx = (n % COLS) * CELL_W;
      const cy = y + Math.floor(n / COLS) * CELL_H;
      const bx = cx + (CELL_W - BOX) / 2;
      svg.push(`<rect x="${bx}" y="${cy}" width="${BOX}" height="${BOX}" fill="url(#ck)" stroke="${c.warn ? "#b00" : "#999"}"/>`);
      const f = await fit(await withShadow(c.image, c.height), BOX);
      composites.push({ input: f.buf, left: Math.round(bx + f.dx), top: Math.round(cy + f.dy) });
      c.lines.forEach((l, k) => {
        const s = l.length > 25 ? `${l.slice(0, 24)}…` : l;
        text(cx + 8, cy + BOX + 16 + k * 15, s, `font-size="12" ${k === 0 ? `font-weight="bold"` : ""} fill="${c.warn ? "#b00" : "#222"}"`);
      });
    }
    y += Math.ceil(cells.length / COLS) * CELL_H + 12;
  }
  if (folder.missing.length > 0) {
    const words = `Missing (no cut): ${folder.missing.map((e) => e.key).join(", ")}`.split(" ");
    let line = "";
    for (const word of [...words, ""]) {
      if (word && (line + word).length < 170) line += `${word} `;
      else {
        text(16, y + 18, line.trim(), `font-size="14" fill="#b00"`);
        y += 20;
        line = `${word} `;
      }
    }
    y += 10;
  }
  const H = y + 12;
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${CHECKER}</defs><rect width="${W}" height="${H}" fill="#fff"/>${svg.join("")}</svg>`;
  return sharp(Buffer.from(bg)).composite(composites).png({ compressionLevel: 9 }).toBuffer();
}

/** Every folder in one image: a row of thumbnails per folder. */
export async function overallContactSheet(folders: readonly FolderResult[]): Promise<Buffer> {
  const THUMB = 56;
  const LABEL = 210;
  const ROW = THUMB + 8;
  const maxItems = Math.max(...folders.map((f) => f.items.length + f.missing.length), 1);
  const width = LABEL + maxItems * (THUMB + 2) + 8;
  const height = folders.length * ROW + 8;
  const svg: string[] = [];
  const composites: OverlayOptions[] = [];
  for (const [r, folder] of folders.entries()) {
    const y = 4 + r * ROW;
    svg.push(`<text x="8" y="${y + THUMB / 2 + 5}" font-family="DejaVu Sans, sans-serif" font-size="14" font-weight="bold">${esc(folder.folder)}</text>`);
    let x = LABEL;
    for (const item of folder.items) {
      svg.push(`<rect x="${x}" y="${y}" width="${THUMB}" height="${THUMB}" fill="url(#ck)"/>`);
      const f = await fit(await png(item.image), THUMB);
      composites.push({ input: f.buf, left: x + f.dx, top: y + f.dy });
      x += THUMB + 2;
    }
    for (let k = 0; k < folder.missing.length; k++) {
      svg.push(`<rect x="${x}" y="${y}" width="${THUMB}" height="${THUMB}" fill="#fdd" stroke="#b00"/>`);
      x += THUMB + 2;
    }
  }
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${CHECKER}</defs><rect width="${width}" height="${height}" fill="#fff"/>${svg.join("")}</svg>`;
  return sharp(Buffer.from(bg)).composite(composites).png({ compressionLevel: 9 }).toBuffer();
}

function sheetSummary(s: SheetResult): string {
  const fr = s.fringe ? ` fringe ${s.fringe.before.toFixed(3)}→${s.fringe.after.toFixed(3)}` : "";
  return `${s.id}: ${s.found}${s.expected ? `/${s.expected}` : ""} ${s.method}${fr} ${s.ms} ms${s.flags.length ? ` | ${s.flags.join("; ")}` : ""}${s.overrideNotes.length ? ` | overrides: ${s.overrideNotes.join("; ")}` : ""}`;
}

export type ReportInput = {
  out: string;
  folders: readonly FolderResult[];
  encoded: ReadonlyMap<Item, Encoded> | null;
  /** Folders whose files were written to public/sprite-packs (build only). */
  built: boolean;
};

/** Writes candidates, contact sheets, report.html; returns the summary lines (also printed). */
export async function writeReport({ out, folders, encoded, built }: ReportInput): Promise<{ summary: string[]; contactSheets: string[] }> {
  mkdirSync(out, { recursive: true });
  const summary: string[] = [];
  const contactSheets: string[] = [];
  const sections: string[] = [];
  for (const folder of folders) {
    const dir = join(out, folder.folder);
    mkdirSync(dir, { recursive: true });
    for (const item of folder.items) {
      const slug = item.key.split("/")[1] ?? item.key;
      const name = item.variant > 1 ? `${slug}-v${item.variant}` : slug;
      writeFileSync(join(dir, `${name}.png`), await png(item.image));
      if (item.tile) writeFileSync(join(dir, `${name}-3x3.png`), await tile3x3(item.image, 256));
    }
    for (const s of folder.sheets)
      for (const u of s.unassigned) writeFileSync(join(dir, `unassigned-${s.id.split("/")[1]}-${u.cutIndex + 1}.png`), await png(u.image));
    const sheetPng = join(out, `contact-${folder.folder}.png`);
    writeFileSync(sheetPng, await folderContactSheet(folder));
    contactSheets.push(sheetPng);
    const lowTile = folder.items.filter((i) => i.tile && i.tile.after < LOW_TILEABILITY);
    summary.push(`${folder.folder}: ${folder.items.filter((i) => i.variant === 1).length} sprites, ${folder.items.filter((i) => i.variant > 1).length} variants, ${folder.missing.length} missing`);
    for (const s of folder.sheets) summary.push(`  ${sheetSummary(s)}`);
    if (lowTile.length) summary.push(`  low tileability: ${lowTile.map((i) => `${i.key} ${i.tile?.after.toFixed(2)}`).join(", ")}`);
    if (folder.missing.length) summary.push(`  missing: ${folder.missing.map((e) => e.key).join(", ")}`);
    const bytes = encoded ? folder.items.reduce((n, i) => n + (encoded.get(i)?.bytes.length ?? 0), 0) : 0;
    sections.push(
      `<section><h2>${esc(folder.folder)}</h2><ul>${folder.sheets
        .map((s) => `<li${s.flags.length ? ' class="flag"' : ""}>${esc(sheetSummary(s))}</li>`)
        .join("")}${lowTile.length ? `<li class="flag">low tileability: ${esc(lowTile.map((i) => i.key).join(", "))}</li>` : ""}${folder.missing.length ? `<li class="flag">missing: ${esc(folder.missing.map((e) => e.key).join(", "))}</li>` : ""}${encoded ? `<li>${(bytes / 1024).toFixed(0)} KB of WebP</li>` : ""}</ul><img src="${esc(relative(out, sheetPng))}" alt="${esc(folder.folder)} contact sheet" loading="lazy"></section>`,
    );
  }
  const overall = join(out, "contact-overall.png");
  writeFileSync(overall, await overallContactSheet(folders));
  contactSheets.unshift(overall);
  const total = encoded ? [...encoded.values()].reduce((n, e) => n + e.bytes.length, 0) : 0;
  const head = `${folders.length} folders, ${folders.reduce((n, f) => n + f.sheets.filter((s) => s.file).length, 0)} sheets, ${folders.reduce((n, f) => n + f.items.length, 0)} files${encoded ? `, ${(total / 1024 / 1024).toFixed(2)} MB WebP${built ? " written to public/sprite-packs" : " (draft, not written)"}` : ""}`;
  summary.unshift(head);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sprite pack import report</title><style>body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#fafafa}img{max-width:100%;border:1px solid #ccc;background:#fff}.flag{color:#b00}section{margin:24px 0}code{background:#eee;padding:0 4px}</style></head><body><h1>Sprite pack import report</h1><p>${esc(head)}</p><p>Light from the top left; the shadow preview is the app's (D5). Red = flag. Terrain swatches are shown tiled 3 x 3 after the seam fix (tileability before → after; below ${LOW_TILEABILITY} is flagged).</p><h2>Overall</h2><img src="contact-overall.png" alt="all folders">${sections.join("")}</body></html>`;
  writeFileSync(join(out, "report.html"), html);
  writeFileSync(join(out, "summary.txt"), `${summary.join("\n")}\n`);
  return { summary, contactSheets };
}
