#!/usr/bin/env node
// Extracts the adversary illustrations from the two rulebooks' adversary chapters (plan .omc/plans/adversary-art.yaml,
// tracer AA1) into public/adversary-art/<adversary-id>.webp and generates src/lib/srd/adversary-art.ts.
//
//   node scripts/srd/extract-adversary-art.mjs --core <core.pdf> --hf <hopefear.pdf> \
//     [--pdfjs <dir with pdfjs-dist>] [--sharp <sharp package dir>] [--review <dir>] [--dry]
//
// The PDFs live in .reference-private/ and are never committed; nothing in CI runs this script, the generated
// images and mapping are committed instead. pdfjs-dist is not a project dependency: pass the node_modules directory
// that holds it with --pdfjs (or PDFJS_DIR). sharp comes from --sharp / SHARP_DIR, else from the import "sharp".
// --review <dir> also writes every candidate image as PNG with a report, for checking by eye; --dry writes nothing
// into the repository.
//
// Matching. Every illustration in these chapters carries a hand-lettered caption naming what it shows (e.g. "ACID
// BURROWER" under the art on CB p.210, which sits beside the Bear's block, so page position alone would be wrong).
// A caption is the text in a caption font: small (7 pt) all-caps lines. Each caption is matched to an adversary by
// name (ALIASES for the few captions that name it differently, each checked on the rendered page) and to the
// nearest non-furniture image. Group and scene captions (SKIP) stay unassigned. Uncaptioned art (the Reign of the
// Weredragon pages) is assigned only through MANUAL, each entry checked on the rendered page. A picture of several
// adversaries together (SHARED) goes whole to each of them, the others greyed out a little so that one stands out.

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = join(ROOT, "public/adversary-art");
const OUT_TS = join(ROOT, "src/lib/srd/adversary-art.ts");
const MAX_WIDTH = 900;
const QUALITY = 80;

/** PDF page ranges (1-based PDF indices); the printed page is the PDF index minus PRINTED_OFFSET in both books. */
const BOOKS = [
  { key: "core", label: "Core Rulebook", short: "CB", arg: "core", ranges: [[210, 241]] },
  { key: "hope-and-fear", label: "Hope & Fear", short: "HF", arg: "hf", ranges: [[62, 98], [142, 144]] },
];
const PRINTED_OFFSET = 1;

/** Caption (normalised) -> adversary id, where the caption names the adversary differently. Checked by eye. */
const ALIASES = {
  "core:MINOTAUR": "minotaur-wrecker", // CB p.225, beside the Minotaur Wrecker block, battleaxe in hand; the only minotaur.
  "hope-and-fear:VAMPIRE LORD WITH HELLWING EVOLUTION": "vampire-lord", // HF p.88, the Vampire Lord in its Hellwing form.
};

/** Captions left unassigned: not an adversary, a group, or one image shared by several adversaries. */
const SKIP = {
  "core:JAGGED KNIFE": "the gang's knife, not an adversary",
  "core:HEAD VAMPIRE": "one image shows the Head Vampire and a Dire Bat together (SHARED)",
  "core:DIRE BAT": "one image shows the Head Vampire and a Dire Bat together (SHARED)",
  "hope-and-fear:DARKWEAVE CRAWLERS": "two small crawlers inside the Darkweave Queen's image; the image goes to the Queen",
  "hope-and-fear:THE HARBINGERS": "the four Harbingers together in one image (SHARED)",
};

/**
 * Caption -> image index (paint order on the page) where the nearest image is wrong, checked by eye:
 * CB p.216 paints the Red Ooze as a luminosity mask (image 2) plus the colour art (image 3); on CB p.228 the Demon
 * of Avarice's caption sits nearer the Demon of Despair's art and vice versa.
 */
const PICK = {
  "core:216:RED OOZE": 3,
  "core:228:DEMON OF AVARICE": 2,
  "core:228:DEMON OF DESPAIR": 3,
};

/**
 * Uncaptioned art assigned by hand, checked by eye: book, PDF page, image index on the page (paint order), id.
 * Left out on purpose: the horned brute on the CB p.209 chapter opener.
 */
const MANUAL = [
  { book: "hope-and-fear", page: 142, image: 2, id: "forlorne-lykona-dragon-form", note: "HF p.141, uncaptioned: a purple dragon breathing gas, taken as Forlorne's Dragon Form (user 2026-10-19)" },
  { book: "hope-and-fear", page: 144, image: 1, id: "weredrake", note: "HF p.143 beside the Weredrake block: a wingless, quadrupedal dragon, as its text describes" },
];

/**
 * One picture of several adversaries (user 2026-10-19: "keep the entire picture without crop, but grey out the other
 * characters a little bit so the main one stands out"): book, PDF page, image index, and per adversary the ellipses
 * that stay in full colour, as [centre x, centre y, radius x, radius y] in fractions of the trimmed image, set by eye.
 */
const SHARED = [
  {
    book: "core",
    page: 234,
    image: 2,
    note: "CB p.233, captioned HEAD VAMPIRE and DIRE BAT",
    focus: {
      "head-vampire": [[0.33, 0.55, 0.26, 0.5]],
      "dire-bat": [[0.72, 0.5, 0.3, 0.42]],
    },
  },
  {
    book: "hope-and-fear",
    page: 95,
    image: 3,
    note: "HF p.94, captioned THE HARBINGERS; told apart by their descriptions",
    focus: {
      // A withered white horse (top left, the rider with the scythe).
      "harbinger-of-famine": [[0.24, 0.38, 0.22, 0.2], [0.22, 0.15, 0.11, 0.15]],
      // A skeletal horse (top middle).
      "harbinger-of-death": [[0.58, 0.25, 0.28, 0.27]],
      // A worm-eaten horse (bottom left).
      "harbinger-of-pestilence": [[0.24, 0.73, 0.24, 0.26]],
      // Black armour and a bloody banner (bottom right).
      "harbinger-of-war": [[0.68, 0.68, 0.27, 0.3], [0.8, 0.22, 0.14, 0.18]],
    },
  },
];

/** Greys out what lies outside `ellipses` (soft-edged) in RGBA pixels: most of the colour gone and a little paler. */
function spotlight({ data, info }, ellipses) {
  const { width: w, height: h, channels: c } = info;
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 0;
      for (const [cx, cy, rx, ry] of ellipses) {
        const d = Math.hypot((x / w - cx) / rx, (y / h - cy) / ry);
        keep = Math.max(keep, Math.min(1, Math.max(0, (1.15 - d) / 0.3)));
      }
      if (keep >= 1) continue;
      const i = (y * w + x) * c;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      for (let k = 0; k < 3; k++) {
        const grey = 0.7 * lum + 0.3 * data[i + k];
        const pale = grey + (255 - grey) * 0.2;
        out[i + k] = Math.round(keep * data[i + k] + (1 - keep) * pale);
      }
    }
  }
  return out;
}

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
    console.error("usage: node scripts/srd/extract-adversary-art.mjs --core <core.pdf> --hf <hopefear.pdf> --pdfjs <node_modules dir> [--sharp <dir>] [--review <dir>] [--dry]");
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

/** Page furniture: page backgrounds, footer strips, edge slivers and small icons. */
function isFurniture(img, vp) {
  const [x0, y0, x1, y1] = img.box;
  const area = (x1 - x0) * (y1 - y0);
  if (area > 0.6 * vp.width * vp.height) return true;
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
  const { ADVERSARIES } = await import(pathToFileURL(join(ROOT, "src/lib/srd/adversaries.ts")).href);
  const byName = new Map(ADVERSARIES.map((a) => [`${a.source}:${norm(a.name)}`, a]));
  const byId = new Map(ADVERSARIES.map((a) => [a.id, a]));

  const assigned = new Map(); // id -> { book, page, image }
  const report = [];
  const unassigned = [];
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
        const picks = []; // { id, img, how }
        const named = [];
        for (const cap of caps) {
          const key = `${book.key}:${norm(cap.text)}`;
          if (SKIP[key]) {
            unassigned.push(`${where}: caption "${cap.text}" skipped, ${SKIP[key]}`);
            continue;
          }
          const adv = ALIASES[key] ? byId.get(ALIASES[key]) : byName.get(key);
          const how = ALIASES[key] ? `alias "${cap.text}"` : `caption "${cap.text}"`;
          const pick = PICK[`${book.key}:${printed}:${norm(cap.text)}`];
          if (!adv) unassigned.push(`${where}: caption "${cap.text}" matches no adversary`);
          else if (pick !== undefined) {
            const img = imgs.find((im) => im.index === pick);
            if (!img) throw new Error(`${where}: PICK image ${pick} not found`);
            used.set(img.index, cap.text);
            picks.push({ id: adv.id, img, how: `${how}, image picked by hand` });
          } else named.push({ cap, adv, how });
        }
        // Greedy nearest pairing over all caption-image pairs of the page (distance to the box, then to its centre).
        const pairs = named.flatMap((n) =>
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
          picks.push({ id: n.adv.id, img: im, how: n.how });
        }
        for (const n of named) if (!done.has(n)) unassigned.push(`${where}: caption "${n.cap.text}" has no free image within 60 pt`);
        for (const m of MANUAL.filter((m) => m.book === book.key && m.page === p)) {
          const img = imgs.find((im) => im.index === m.image);
          if (!img) throw new Error(`${where}: MANUAL image ${m.image} not found`);
          picks.push({ id: m.id, img, how: `manual (${m.note})` });
          used.set(img.index, m.id);
        }
        for (const sh of SHARED.filter((sh) => sh.book === book.key && sh.page === p)) {
          const img = imgs.find((im) => im.index === sh.image);
          if (!img) throw new Error(`${where}: SHARED image ${sh.image} not found`);
          for (const [id, focus] of Object.entries(sh.focus)) picks.push({ id, img, focus, how: `shared (${sh.note})` });
          used.set(img.index, Object.keys(sh.focus).join(", "));
        }
        for (const im of imgs) if (!used.has(im.index)) unassigned.push(`${where}: image ${im.index} (${im.w}x${im.h}) has no caption`);

        for (const pick of picks) {
          if (!byId.has(pick.id)) throw new Error(`unknown adversary ${pick.id}`);
          if (assigned.has(pick.id)) throw new Error(`${pick.id} assigned twice (${assigned.get(pick.id).where}, ${where})`);
          const raw = await imageData(page, pick.img.name);
          const base = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } });
          const trimmed = await base.trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true }).catch(() => null);
          let src = trimmed ? sharp(trimmed.data) : base;
          if (pick.focus) {
            const rgba = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            src = sharp(spotlight(rgba, pick.focus), { raw: { width: rgba.info.width, height: rgba.info.height, channels: rgba.info.channels } });
          }
          const out = await src
            .resize({ width: MAX_WIDTH, withoutEnlargement: true })
            .webp({ quality: QUALITY, alphaQuality: 80, effort: 6 })
            .toBuffer({ resolveWithObject: true });
          assigned.set(pick.id, { where, printed, book: book.key, how: pick.how, width: out.info.width, height: out.info.height, bytes: out.data.length, data: out.data });
          report.push(`${where}: ${pick.id} <- image ${pick.img.index} (${pick.img.w}x${pick.img.h}) by ${pick.how}`);
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
    return `  ${JSON.stringify(id)}: { src: "/adversary-art/${id}.webp", width: ${a.width}, height: ${a.height}, credit: ${JSON.stringify(`${a.where}`)} },`;
  });
  writeFileSync(
    OUT_TS,
    `// GENERATED FILE, do not edit by hand. Generator: scripts/srd/extract-adversary-art.mjs (plan
// .omc/plans/adversary-art.yaml, AA1). Rerun locally with the two rulebook PDFs from .reference-private/.
// Adversary id -> its illustration from the rulebook's adversary chapter (credit = book and printed page).
// Pure data: no framework imports.

export type AdversaryArt = { src: string; width: number; height: number; credit?: string };

/** Illustrations per book: ${BOOKS.map((b) => `${b.label} ${perBook[b.key]}`).join(", ")}. */
export const ADVERSARY_ART_COUNT = ${JSON.stringify(perBook)} as const;

export const ADVERSARY_ART: Readonly<Record<string, AdversaryArt>> = {
${entries.join("\n")}
};

/** The art for an adversary id, if the rulebook illustrates it. */
export function adversaryArt(id: string | undefined): AdversaryArt | undefined {
  return id === undefined ? undefined : ADVERSARY_ART[id];
}
`,
  );
}

await main();
