#!/usr/bin/env node
// Extracts the environment illustrations from the two rulebooks' environment chapters (plan
// .omc/plans/env-actions.yaml, tracer EA1) into public/environment-art/<environment-id>.webp and generates
// src/lib/srd/environment-art.ts. The approach is the adversary art extractor's (scripts/srd/extract-adversary-art.mjs).
//
//   node scripts/srd/extract-environment-art.mjs --core <core.pdf> --hf <hopefear.pdf> \
//     [--pdfjs <dir with pdfjs-dist>] [--sharp <sharp package dir>] [--review <dir>] [--dry]
//
// The PDFs live in .reference-private/ and are never committed; nothing in CI runs this script, the generated
// images and mapping are committed instead. pdfjs-dist is not a project dependency: pass the node_modules directory
// that holds it with --pdfjs (or PDFJS_DIR). sharp comes from --sharp / SHARP_DIR, else from the import "sharp".
// --review <dir> also writes every assigned and unassigned image with a report, for checking by eye; --dry writes
// nothing into the repository.
//
// Matching. Environment art carries a hand-lettered caption naming it (7 pt all-caps lines in a caption font, e.g.
// "CLIFFSIDE ASCENT" on CB p.244). Each caption is matched to an environment by name and to the nearest
// non-furniture image. Most pages paint ONE image that shows two environments side by side, each part with its own
// caption (e.g. HF p.100: the Corrupted Swamp on the left, the Cursed Graveyard on the right); those captions are
// listed in CROPS with the part of the image that is theirs, each checked on the rendered page. A caption on a page
// with a shared image but no CROPS entry fails the run rather than getting the whole picture.

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = join(ROOT, "public/environment-art");
const OUT_TS = join(ROOT, "src/lib/srd/environment-art.ts");
const MAX_WIDTH = 900;
const QUALITY = 80;

/**
 * PDF page ranges (1-based PDF indices); the printed page is the PDF index minus PRINTED_OFFSET in both books.
 * CB pp.242-251 and HF pp.98-112: the stat blocks plus each book's list page (HF p.98 carries the Abandoned Mine art).
 */
const BOOKS = [
  { key: "core", label: "Core Rulebook", short: "CB", arg: "core", ranges: [[243, 252]] },
  { key: "hope-and-fear", label: "Hope & Fear", short: "HF", arg: "hf", ranges: [[99, 113]] },
];
const PRINTED_OFFSET = 1;

/**
 * Caption on a page whose one image shows two environments -> the caption's part of that image, as fractions of the
 * image [x0, y0, x1, y1]. Each checked by eye on the rendered page and on the cut result. Also the Burning Heart of the
 * Woods (CB p.248): its full-page art is empty (transparent) behind the stat block, so only the tree's part is kept.
 */
const CROPS = {
  "core:248:BURNING HEART OF THE WOODS": [0.47, 0, 1, 1],
  "core:244:CLIFFSIDE ASCENT": [0, 0, 0.36, 1],
  "core:244:LOCAL TAVERN": [0.36, 0.1, 1, 1],
  "core:245:OUTPOST TOWN": [0, 0, 0.56, 0.56],
  "core:245:RAGING RIVER": [0.5, 0, 1, 1],
  "core:246:CULT RITUAL": [0, 0, 0.49, 1],
  "core:246:HALLOWED TEMPLE": [0.515, 0, 1, 1],
  "core:247:HAUNTED CITY": [0, 0, 0.56, 1],
  "core:247:MOUNTAIN PASS": [0.6, 0, 1, 1],
  "core:249:CASTLE SIEGE": [0, 0, 0.6, 1],
  "core:249:PITCHED BATTLE": [0.6, 0.3, 1, 1],
  "hope-and-fear:100:CORRUPTED SWAMP": [0, 0, 0.45, 1],
  "hope-and-fear:100:CURSED GRAVEYARD": [0.5, 0, 1, 1],
  "hope-and-fear:107:ARCHMAGE'S TOWER": [0, 0, 0.5, 1],
  "hope-and-fear:107:ASTRAL REALM": [0.53, 0, 1, 1],
};

function args() {
  const out = { pdfjs: process.env.PDFJS_DIR, sharp: process.env.SHARP_DIR, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--core" || a === "--hf" || a === "--pdfjs" || a === "--sharp" || a === "--review") out[a.slice(2)] = argv[++i];
    else if (a === "--dry") out.dry = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.core || !out.hf || !out.pdfjs) {
    console.error("usage: node scripts/srd/extract-environment-art.mjs --core <core.pdf> --hf <hopefear.pdf> --pdfjs <node_modules dir> [--sharp <dir>] [--review <dir>] [--dry]");
    process.exit(2);
  }
  return out;
}

const norm = (s) =>
  s
    .toUpperCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^A-Z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function bboxDistance([x, y], [x0, y0, x1, y1]) {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

/** Images painted on a page, in paint order, with their page-space box (pt, y down). */
function pageImages(pdfjs, ops, vp) {
  const { OPS, Util } = pdfjs;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const imgs = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    const a = ops.argsArray[k];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (a[0]) ctm = Util.transform(ctm, a[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject) {
      const m = Util.transform(vp.transform, ctm);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      imgs.push({ index: imgs.length, name: a[0], w: a[1], h: a[2], box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  return imgs;
}

/**
 * Page furniture: the parchment backgrounds (bleeding past the page, so over 95 % of it; the Burning Heart of the
 * Woods art on CB p.248 fills about 92 % and is kept), footer strips, edge slivers and small icons.
 */
function isFurniture(img, vp) {
  const [x0, y0, x1, y1] = img.box;
  const area = (x1 - x0) * (y1 - y0);
  if (area > 0.95 * vp.width * vp.height) return true;
  if (img.w / img.h > 6 || img.h / img.w > 6) return true;
  if (img.w < 200 && img.h < 200) return true;
  if (y0 >= vp.height - 60) return true; // footer band
  return false;
}

/** Caption lines (small all-caps text in a font used for captions on this page), grouped into captions. */
function pageCaptions(pdfjs, text, vp) {
  const { Util } = pdfjs;
  const isCapLine = (x) => x.str.trim() && x.height < 7.6 && /[A-Z]{3}/.test(x.str) && x.str === x.str.toUpperCase();
  const fonts = new Set(text.items.filter(isCapLine).map((x) => x.fontName));
  const lines = text.items
    .filter((x) => fonts.has(x.fontName) && x.height < 7.6 && x.str.trim() && x.str.trim() !== ":")
    .map((x) => {
      const q = Util.transform(vp.transform, x.transform);
      return { font: x.fontName, s: x.str.trim(), x0: q[4], x1: q[4] + x.width, y: q[5] };
    })
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const groups = [];
  for (const l of lines) {
    const g = groups.find((g) => {
      const last = g.lines[g.lines.length - 1];
      const dy = l.y - last.y;
      const cx = (l.x0 + l.x1) / 2;
      const gcx = (last.x0 + last.x1) / 2;
      return g.font === l.font && dy >= 0 && dy <= 11 && Math.abs(cx - gcx) < 45;
    });
    if (g) g.lines.push(l);
    else groups.push({ font: l.font, lines: [l] });
  }
  return groups.map((g) => {
    const x0 = Math.min(...g.lines.map((l) => l.x0));
    const x1 = Math.max(...g.lines.map((l) => l.x1));
    const y0 = Math.min(...g.lines.map((l) => l.y)) - 7;
    const y1 = Math.max(...g.lines.map((l) => l.y));
    return { text: g.lines.map((l) => l.s).join(" "), point: [(x0 + x1) / 2, (y0 + y1) / 2] };
  });
}

async function imageData(page, name) {
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  const img = await new Promise((r) => store.get(name, r));
  const channels = img.kind === 3 ? 4 : img.kind === 2 ? 3 : 1;
  if (!img.data || channels === 1) throw new Error(`unsupported image ${name} kind ${img.kind}`);
  return { width: img.width, height: img.height, channels, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length) };
}

async function main() {
  const opts = args();
  const pdfjs = await import(pathToFileURL(join(resolve(opts.pdfjs), "pdfjs-dist/legacy/build/pdf.mjs")).href);
  const sharp = (await import(opts.sharp ? pathToFileURL(join(resolve(opts.sharp), "lib/index.js")).href : "sharp")).default;
  const { ENVIRONMENTS } = await import(pathToFileURL(join(ROOT, "src/lib/srd/environments.ts")).href);
  const byName = new Map(ENVIRONMENTS.map((e) => [`${e.source}:${norm(e.name)}`, e]));
  const byId = new Map(ENVIRONMENTS.map((e) => [e.id, e]));

  const assigned = new Map(); // id -> { where, book, ... }
  const report = [];
  const unassigned = [];
  const cropsUsed = new Set();
  if (opts.review) mkdirSync(opts.review, { recursive: true });

  for (const book of BOOKS) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(opts[book.arg])), verbosity: 0 }).promise;
    for (const [from, to] of book.ranges) {
      for (let p = from; p <= to; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const ops = await page.getOperatorList();
        const imgs = pageImages(pdfjs, ops, vp).filter((im) => !isFurniture(im, vp));
        const caps = pageCaptions(pdfjs, await page.getTextContent(), vp);
        const printed = p - PRINTED_OFFSET;
        const where = `${book.short} p.${printed}`;
        const used = new Map(); // image index -> caption
        const picks = []; // { id, img, how, crop? }
        const named = [];
        for (const cap of caps) {
          const env = byName.get(`${book.key}:${norm(cap.text)}`);
          if (!env) unassigned.push(`${where}: caption "${cap.text}" matches no environment`);
          else named.push({ cap, env, how: `caption "${cap.text}"`, crop: CROPS[`${book.key}:${printed}:${norm(cap.text)}`] });
        }
        const nearest = (cap) =>
          imgs
            .map((im) => ({ im, d: bboxDistance(cap.point, im.box) }))
            .filter((x) => x.d <= 60)
            .sort((a, b) => a.d - b.d)[0]?.im;
        // Cropped captions share their image: each takes its own part of the nearest image.
        for (const n of named.filter((n) => n.crop)) {
          const im = nearest(n.cap);
          if (!im) throw new Error(`${where}: CROPS caption "${n.cap.text}" has no image within 60 pt`);
          cropsUsed.add(`${book.key}:${printed}:${norm(n.cap.text)}`);
          used.set(im.index, n.cap.text);
          picks.push({ id: n.env.id, img: im, how: `${n.how}, part [${n.crop.join(", ")}] of the image`, crop: n.crop });
        }
        // Greedy nearest pairing for the rest (distance to the box, then to its centre); one image per caption.
        const rest = named.filter((n) => !n.crop);
        const pairs = rest.flatMap((n) =>
          imgs.map((im) => {
            const [x0, y0, x1, y1] = im.box;
            return { n, im, d: bboxDistance(n.cap.point, im.box), c: Math.hypot(n.cap.point[0] - (x0 + x1) / 2, n.cap.point[1] - (y0 + y1) / 2) };
          }),
        );
        pairs.sort((a, b) => a.d - b.d || a.c - b.c);
        const done = new Set();
        for (const { n, im, d } of pairs) {
          if (done.has(n) || used.has(im.index) || d > 60) continue;
          done.add(n);
          used.set(im.index, n.cap.text);
          picks.push({ id: n.env.id, img: im, how: n.how });
        }
        for (const n of rest) if (!done.has(n)) unassigned.push(`${where}: caption "${n.cap.text}" has no free image within 60 pt`);
        // A shared image needs a CROPS entry for every caption near it, so no caption gets the other environment too.
        for (const n of rest.filter((n) => done.has(n))) {
          const im = picks.find((pk) => pk.id === n.env.id).img;
          const others = named.filter((o) => o !== n && bboxDistance(o.cap.point, im.box) <= 60);
          if (others.length) throw new Error(`${where}: "${n.cap.text}" and "${others.map((o) => o.cap.text).join('", "')}" share one image; add CROPS`);
        }
        for (const im of imgs) if (!used.has(im.index)) unassigned.push(`${where}: image ${im.index} (${im.w}x${im.h}) has no caption`);

        for (const pick of picks) {
          if (!byId.has(pick.id)) throw new Error(`unknown environment ${pick.id}`);
          if (assigned.has(pick.id)) throw new Error(`${pick.id} assigned twice (${assigned.get(pick.id).where}, ${where})`);
          const raw = await imageData(page, pick.img.name);
          let base = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } });
          if (pick.crop) {
            const [x0, y0, x1, y1] = pick.crop;
            const left = Math.round(x0 * raw.width);
            const top = Math.round(y0 * raw.height);
            const cut = await base
              .extract({ left, top, width: Math.round(x1 * raw.width) - left, height: Math.round(y1 * raw.height) - top })
              .png()
              .toBuffer();
            base = sharp(cut);
          }
          const trimmed = await base.clone().trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true }).catch(() => null);
          const src = trimmed ? sharp(trimmed.data) : base;
          const out = await src
            .resize({ width: MAX_WIDTH, withoutEnlargement: true })
            .webp({ quality: QUALITY, alphaQuality: 80, effort: 6 })
            .toBuffer({ resolveWithObject: true });
          assigned.set(pick.id, { where, book: book.key, width: out.info.width, height: out.info.height, bytes: out.data.length, data: out.data });
          report.push(`${where}: ${pick.id} <- image ${pick.img.index} (${raw.width}x${raw.height}) by ${pick.how}`);
          if (opts.review) writeFileSync(join(opts.review, `${pick.id}.webp`), out.data);
        }
        if (opts.review) {
          for (const im of imgs.filter((im) => !used.has(im.index))) {
            const raw = await imageData(page, im.name);
            await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
              .resize({ width: 400, withoutEnlargement: true })
              .png()
              .toFile(join(opts.review, `unassigned-${book.short}-p${printed}-${im.index}.png`));
          }
        }
        page.cleanup();
      }
    }
    await doc.destroy();
  }
  for (const key of Object.keys(CROPS)) if (!cropsUsed.has(key)) throw new Error(`CROPS entry ${key} matched no caption`);

  const ids = [...assigned.keys()].sort();
  const perBook = Object.fromEntries(BOOKS.map((b) => [b.key, ids.filter((id) => assigned.get(id).book === b.key).length]));
  const total = ids.reduce((n, id) => n + assigned.get(id).bytes, 0);
  const lines = [...report, "", "unassigned:", ...unassigned.map((s) => `  ${s}`), "", `assigned ${ids.length} (${JSON.stringify(perBook)}), ${(total / 1024 / 1024).toFixed(2)} MB`];
  console.log(lines.join("\n"));
  if (opts.review) writeFileSync(join(opts.review, "report.txt"), lines.join("\n") + "\n");
  if (opts.dry) return;

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const id of ids) writeFileSync(join(OUT_DIR, `${id}.webp`), assigned.get(id).data);
  const entries = ids.map((id) => {
    const a = assigned.get(id);
    return `  ${JSON.stringify(id)}: { src: "/environment-art/${id}.webp", width: ${a.width}, height: ${a.height}, credit: ${JSON.stringify(a.where)} },`;
  });
  writeFileSync(
    OUT_TS,
    `// GENERATED FILE, do not edit by hand. Generator: scripts/srd/extract-environment-art.mjs (plan
// .omc/plans/env-actions.yaml, EA1). Rerun locally with the two rulebook PDFs from .reference-private/.
// Environment id -> its illustration from the rulebook's environment chapter (credit = book and printed page).
// Pure data: no framework imports.

import type { AdversaryArt } from "./adversary-art";

export type EnvironmentArt = AdversaryArt;

/** Illustrations per book: ${BOOKS.map((b) => `${b.label} ${perBook[b.key]}`).join(", ")}. */
export const ENVIRONMENT_ART_COUNT = ${JSON.stringify(perBook)} as const;

export const ENVIRONMENT_ART: Readonly<Record<string, EnvironmentArt>> = {
${entries.join("\n")}
};

/** The art for an environment id, if the rulebook illustrates it. */
export function environmentArt(id: string | undefined): EnvironmentArt | undefined {
  return id === undefined ? undefined : ENVIRONMENT_ART[id];
}
`,
  );
}

await main();
