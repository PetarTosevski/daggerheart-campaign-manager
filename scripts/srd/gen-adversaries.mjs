#!/usr/bin/env node
// Generates src/lib/srd/adversaries.ts: the 267 SRD adversaries (129 Core Rulebook, 135 Hope & Fear,
// 3 Reign of the Weredragon) as typed data (plan .omc/plans/d8.yaml, tracer A1).
//
//   node scripts/srd/gen-adversaries.mjs --core <core.txt> --hf <hopefear.txt> [--check]
//
// <core.txt> and <hopefear.txt> are the text of the two books (one "===== PAGE <printed page> =====" line per
// page), extracted locally from the PDFs in .reference-private/ (pdfjs-dist). The books and their text are never
// committed and nothing in CI runs this script: the generated file is committed instead.
// --check prints the cross-checks and writes nothing.
//
// Sources:
// - Core 129: the ADV constant of reference/designs/project/Adversaries.dc.html (verbatim Core text, and the only
//   source with the digits of CB pp.224-225), with the patches in CORE_PATCHES and the countdown labels the board
//   merged into 12 feature names split out. Cross-checked against the Core text.
// - Hope & Fear 135 (HF pp.62-97) and the Reign of the Weredragon blocks (HF pp.142-143): parsed verbatim from the
//   book text (user decision: verbatim, not the board's summaries). Cross-checked against the board's numbers.
//   The book prints Forlorne Lykona as a framework plus a Dragon Form and a Faun Form block; each form becomes one
//   entry with the framework's description, motives, HP, Stress, Experience and features repeated.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BOARD = join(ROOT, "reference/designs/project/Adversaries.dc.html");
const OUT = join(ROOT, "src/lib/srd/adversaries.ts");
const WEREDRAGON = "reign-of-the-weredragon";

function args() {
  const out = { check: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") out.check = true;
    else if (argv[i] === "--core") out.core = argv[++i];
    else if (argv[i] === "--hf") out.hf = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out.core || !out.hf) {
    console.error("usage: node scripts/srd/gen-adversaries.mjs --core <core.txt> --hf <hopefear.txt> [--check]");
    process.exit(2);
  }
  return out;
}

// ---------------------------------------------------------------- board

function readBoard() {
  const src = readFileSync(BOARD, "utf8");
  const start = src.indexOf("const ADV = [") + "const ADV = ".length;
  const end = src.indexOf("\n];", start) + 2;
  return JSON.parse(src.slice(start, end));
}

/** Board defects, checked against the Core Rulebook (see the task doc). */
const CORE_PATCHES = {
  "Zombie Legion": (a) => ({ ...a, rng: "Melee" }), // "Undead Hands: Melee" (CB p.239)
  "Swarm of Rats": (a) => ({ ...a, type: "Horde (10/HP)" }), // CB p.218
  "Electric Eels": (a) => ({ ...a, type: "Horde (2/HP)" }), // CB p.222
  "Minor Chaos Elemental": (a) => ({ ...a, f: a.f.map((f) => (f.n === "Magical reflection" ? { ...f, n: "Magical Reflection" } : f)) }), // CB p.214
  "Tiny Red Ooze": (a) => ({ ...a, mot: "Blaze, camouflage" }), // CB p.216
  "Vault Guardian Turret": (a) => ({ ...a, desc: a.desc.replace("pistondriven", "piston-driven") }), // CB p.233
};

// ---------------------------------------------------------------- text helpers

const FEATURE_START = /^(“?[A-Z0-9][^:]{0,70}?) - (Passive|Action|Reaction|Evolution)(?::\s*(.*))?$/;
const COUNTDOWN = /^((?:[A-Z][\w-]* )*Countdown(?: \([^)]*\))?)\.\s*/;

/** Private-use digits U+E540+n -> n (the books' number font). */
const mapDigits = (s) => s.replace(/[-]/g, (c) => String(c.codePointAt(0) - 0xe540));

/**
 * U+E53F stands for different digits in different fonts of the Hope & Fear PDF; both uses, read from the rendered
 * HF p.93: Ghastly Legion "Tier 4 Horde (10/HP)" and Fire Titan Warlord "Colossus Crafter - Passive: Countdown (6)".
 */
const BOOK_FIXES = [
  ["Horde (1\uE53F/HP)", "Horde (10/HP)"],
  ["Countdown (\uE53F)", "Countdown (6)"],
  // Extraction spacing, rendered HF p.63: "“Get ’em Off, Get ’em Off!”".
  ["Get ’em Off !”", "Get ’em Off!”"],
];
const applyFixes = (s) => BOOK_FIXES.reduce((acc, [from, to]) => acc.replace(from, to), s);

/** Ligatures split by the extraction ("fi rst", "refl ect"). */
const joinLigatures = (s) => s.replace(/(fi|fl) (?=[a-z])/g, "$1");

/** A numbered move inside a feature ("1–2: Dimension Rift.", "3. Doom."), kept as a list item like the board's Battle Box. */
const LIST_ITEM = /^\d+(?:–\d+)?[.:] [A-Z]/;

/** Join wrapped lines: hyphen or dash at a line end joins without a space; numbered moves start "\n\n- " items. */
function joinLines(lines) {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (out && LIST_ITEM.test(line)) out += "\n\n- " + line;
    else if (!out) out = line;
    else if (/[A-Za-z]-$/.test(out) || /—$/.test(out) || /^—/.test(line)) out += line;
    else out += " " + line;
  }
  return joinLigatures(out).replace(/[^\S\n]+/g, " ").trim();
}

const norm = (s) =>
  s
    .toUpperCase()
    .replace(/[’']/g, "")
    .replace(/[^A-Z0-9]/g, "");

/** An art caption, running head or section label: letters present, none lower case. */
const isCaps = (line) => line !== "FEATURES" && /[A-Z].*[A-Z]/.test(line) && !/[a-z]/.test(line);

const isFooter = (line) => /^\d{1,3}\s?Chapter \d+:/.test(line) || /^TIER \d ADVERSARIES/.test(line);

const slug = (name) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function pagesOf(text, from, to) {
  const re = /^===== PAGE (\d+) =====$/gm;
  const marks = [...text.matchAll(re)].map((m) => ({ page: Number(m[1]), at: m.index, body: m.index + m[0].length }));
  const out = [];
  marks.forEach((m, i) => {
    if (m.page < from || m.page > to) return;
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    for (const line of text.slice(m.body, end).split("\n")) {
      out.push({ page: m.page, line: applyFixes(mapDigits(line)).replace(/\s+/g, " ").trim() });
    }
  });
  return out;
}

// ---------------------------------------------------------------- stat block parser

/**
 * Splits page lines into stat blocks. A block starts with its name (1-3 all-caps lines that together equal a known
 * name) directly above a "Tier ..." line; other all-caps lines (art captions, running heads) are dropped.
 */
function splitBlocks(lines, names) {
  const known = new Map(names.map((n) => [norm(n), n]));
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^Tier\b/.test(lines[i].line)) continue;
    for (let k = 3; k >= 1; k--) {
      const nameLines = lines.slice(i - k, i);
      if (nameLines.length < k || !nameLines.every((l) => isCaps(l.line))) continue;
      if (starts.length && i - k <= starts[starts.length - 1].tierLine) continue;
      const name = known.get(norm(nameLines.map((l) => l.line).join(" ")));
      if (name) {
        starts.push({ i: i - k, tierLine: i, name, page: lines[i - k].page });
        break;
      }
    }
  }
  return starts.map((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1].i : lines.length;
    const body = lines.slice(s.tierLine, end).filter((l) => l.line && !isFooter(l.line) && !isCaps(l.line));
    return { name: s.name, page: s.page, lines: body.map((l) => l.line) };
  });
}

/** Parses one block's lines (starting at its "Tier" line, or at the first field for frame form blocks). */
function parseBlock(lines) {
  const sections = { tier: [], desc: [], motives: [], stats: [], atk: [], exp: [], features: [] };
  let at = "desc";
  for (const line of lines) {
    if (/^Tier\b/.test(line) && at === "desc" && !sections.tier.length) {
      sections.tier.push(line);
      continue;
    }
    if (/^Motives & Tactics:/.test(line) && at === "desc") at = "motives";
    else if (/^(Difficulty|HP):/.test(line) && ["desc", "motives"].includes(at)) at = "stats";
    else if (/^ATK:/.test(line) && at !== "features") at = "atk";
    else if (/^Experience:/.test(line) && at !== "features") at = "exp";
    else if (line === "FEATURES") {
      at = "features";
      continue;
    }
    sections[at].push(line);
  }
  const block = {
    tierLine: sections.tier[0] ?? "",
    description: joinLines(sections.desc),
    motives: joinLines(sections.motives).replace(/^Motives & Tactics:\s*/, ""),
    stats: joinLines(sections.stats),
    atk: joinLines(sections.atk),
    exp: joinLines(sections.exp).replace(/^Experience:\s*/, ""),
    features: [],
  };
  let current = null;
  for (const line of sections.features) {
    const m = FEATURE_START.exec(line);
    if (m) {
      current = { name: m[1].trim(), kind: m[2], lines: m[3] ? [m[3]] : [] };
      block.features.push(current);
    } else if (current) current.lines.push(line);
    else throw new Error(`feature text before the first feature: ${line}`);
  }
  block.features = block.features.map((f) => ({ name: joinLigatures(f.name), kind: f.kind, text: joinLines(f.lines) }));
  return block;
}

/** "Difficulty: 12 | Thresholds: 5/9 | HP: 4 | Stress: 3" -> fields present. */
function parseStats(stats) {
  const out = {};
  for (const part of stats.split("|").map((p) => p.trim())) {
    const m = /^(Difficulty|Thresholds|HP|Stress):\s*(.+)$/.exec(part);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** "ATK: +2 | Bite: Melee | 1d6+2 phy" -> board-shaped fields. */
function parseAtk(atk) {
  const m = /^ATK:\s*(\S+)\s*\|\s*(.+?):\s*(Melee|Very Close|Close|Far|Very Far)\s*\|\s*(.+)$/.exec(atk);
  if (!m) throw new Error(`unparsed attack line: ${atk}`);
  return { atk: m[1].replace(/[−–]/g, "-"), wpn: m[2], rng: m[3], dmg: m[4] };
}

// ---------------------------------------------------------------- typed output

const BASE_TYPE = /^(Bruiser|Horde|Leader|Minion|Ranged|Skulk|Social|Solo|Standard|Support)(?: \((\d+)\/HP\))?$/;

/** Same rule as featureFearCost in src/lib/domain/adversaries (the unit test keeps them equal). */
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function fearCost(text) {
  const m = /\bspend (a|an|one|two|three|four|five|six|\d+) Fear\b/i.exec(text);
  if (!m) return undefined;
  const word = m[1].toLowerCase();
  return WORD_NUMBERS[word] ?? Number(word);
}

function threshold(s) {
  if (s === "None") return { major: null, severe: null };
  const [major, severe] = s.split("/").map((x) => (x === "None" ? null : Number(x)));
  return { major, severe };
}

function experiences(exp) {
  if (!exp) return [];
  return exp.split(/,\s*/).map((e) => {
    const m = /^(.+?) ([+−–-]\d+)$/.exec(e.trim());
    if (!m) throw new Error(`unparsed experience: ${exp}`);
    return { name: m[1], value: Number(m[2].replace(/[−–]/g, "-")) };
  });
}

function modifier(atk) {
  const s = atk.replace(/[−–]/g, "-");
  return /^[+-]\d+$/.test(s) ? Number(s) : s;
}

/** Board-shaped feature {n, k, t, countdown?} -> AdversaryFeature. */
function feature(f) {
  const out = { name: f.n, kind: f.k.toLowerCase(), text: f.t };
  const cd = COUNTDOWN.exec(f.t);
  if (f.countdown) out.countdown = f.countdown;
  else if (cd) {
    out.countdown = cd[1];
    out.text = f.t.slice(cd[0].length);
  }
  const cost = fearCost(out.text);
  if (cost !== undefined) out.fearCost = cost;
  return out;
}

/** Board-shaped entry -> AdversaryDef. */
function toDef(a, { source, frameId, page }) {
  const t = BASE_TYPE.exec(a.type);
  if (!t) throw new Error(`${a.name}: unknown type ${a.type}`);
  const def = {
    id: slug(a.name),
    name: a.name,
    tier: a.tier,
    type: t[1],
    ...(t[2] ? { hordePerHp: Number(t[2]) } : {}),
    description: a.desc,
    motives: a.mot,
    difficulty: Number(a.dif),
    thresholds: threshold(a.thr),
    hp: Number(a.hp),
    stress: a.st === "None" ? null : Number(a.st),
    attack: { modifier: modifier(a.atk), name: a.wpn, range: a.rng, damage: a.dmg },
    experiences: experiences(a.exp),
    features: a.f.map(feature),
    source,
    ...(frameId ? { frameId } : {}),
    ...(page ? { page } : {}),
  };
  for (const [k, v] of Object.entries({ difficulty: def.difficulty, hp: def.hp })) {
    if (!Number.isInteger(v)) throw new Error(`${a.name}: ${k} is not a number`);
  }
  return def;
}

/** Board feature "On My Signal - Reaction: Countdown (5)" -> name, kind and countdown apart. */
function splitMergedKind(f) {
  if (f.k) return f;
  const m = /^(.+?) - (Passive|Action|Reaction|Evolution): (.+)$/.exec(f.n);
  if (!m) throw new Error(`board feature without kind: ${f.n}`);
  return { n: m[1], k: m[2], t: f.t, countdown: m[3] };
}

// ---------------------------------------------------------------- Hope & Fear

/** Parsed book block -> board-shaped entry (numbers as text, like the board). */
function bookEntry(name, tier, type, block, extra = {}) {
  const stats = parseStats(block.stats);
  const atk = block.atk ? parseAtk(block.atk) : {};
  return {
    name,
    tier,
    type,
    desc: block.description,
    mot: block.motives,
    dif: stats.Difficulty,
    thr: stats.Thresholds,
    hp: stats.HP,
    st: stats.Stress,
    ...atk,
    exp: block.exp,
    f: block.features.map((f) => ({ n: f.name, k: f.kind, t: f.text })),
    ...extra,
  };
}

function parseTierLine(line, name) {
  const m = /^Tier\s+(\d)\s+(.+)$/.exec(line);
  if (!m) throw new Error(`${name}: unparsed tier line "${line}"`);
  return { tier: Number(m[1]), type: m[2].trim() };
}

function hopeAndFear(text, board) {
  const names = board.filter((a) => a.hf && !a.frame).map((a) => a.name);
  const blocks = splitBlocks(pagesOf(text, 62, 97), names);
  return blocks.map((b) => {
    const block = parseBlock(b.lines);
    const { tier, type } = parseTierLine(block.tierLine, b.name);
    return { entry: bookEntry(b.name, tier, type, block), page: b.page };
  });
}

/** Lines of the HF frame pages between two marker lines (exclusive). */
function between(lines, from, to) {
  const i = lines.findIndex((l) => l.line === from);
  const j = lines.findIndex((l, n) => n > i && l.line === to);
  if (i < 0 || j < 0) throw new Error(`frame marker not found: ${from} .. ${to}`);
  return lines
    .slice(i + 1, j)
    .filter((l) => l.line && !isFooter(l.line) && !/^REign OF THE WEREdRAgOn$/.test(l.line))
    .map((l) => ({ line: l.line, page: l.page }));
}

/** HF pp.142-143. The extraction lost the tier digits there ("Tier  Solo"), so tiers come from the board. */
function weredragon(text, board) {
  const lines = pagesOf(text, 142, 143);
  const tierOf = (name) => board.find((a) => a.name === name).tier;
  const fw = between(lines, "FORLORNE LYKONA", "FAUN FORM");
  const framework = parseBlock(fw.map((l) => l.line));
  const faun = between(lines, "FORLORNE’S FAUN FORM", "ZOETROPE OF THE");
  const dragon = between(lines, "FORLORNE’S DRAGON FORM", "Weredrake");
  const drake = between(lines, "WEREDRAKE", "SESSION ZERO QUESTIONS");
  const typeOf = (block) => block.tierLine.replace(/^Tier\s*\d?\s*/, "").trim();

  const form = (formLines, name) => {
    const block = parseBlock(formLines.map((l) => l.line));
    const merged = {
      ...framework,
      stats: `${block.stats} | ${framework.stats}`,
      atk: block.atk,
      features: [...framework.features, ...block.features],
    };
    return {
      entry: bookEntry(name, tierOf(name), typeOf(framework), merged),
      page: formLines[0].page,
    };
  };
  const drakeBlock = parseBlock(drake.map((l) => l.line));
  return [
    { entry: bookEntry("Weredrake", tierOf("Weredrake"), typeOf(drakeBlock), drakeBlock), page: drake[0].page },
    form(dragon, "Forlorne Lykona (Dragon Form)"),
    form(faun, "Forlorne Lykona (Faun Form)"),
  ];
}

// ---------------------------------------------------------------- cross-checks

const textNorm = (s) =>
  joinLigatures(s)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

function compareFields(label, a, b, fields, report) {
  for (const k of fields) {
    const x = typeof a[k] === "string" ? textNorm(a[k]) : a[k];
    const y = typeof b[k] === "string" ? textNorm(b[k]) : b[k];
    if (x !== y) report.push(`${label}: ${k} board "${a[k]}" vs book "${b[k]}"`);
  }
}

const NUMBER_FIELDS = ["tier", "type", "dif", "thr", "hp", "st", "atk", "wpn", "rng", "dmg"];

function checkHopeAndFear(board, parsed) {
  const report = [];
  for (const { entry } of parsed) {
    const b = board.find((a) => a.name === entry.name);
    compareFields(entry.name, b, entry, NUMBER_FIELDS, report);
    const be = experiences(b.exp).map((e) => `${e.name} ${e.value}`).join(", ");
    const pe = experiences(entry.exp).map((e) => `${e.name} ${e.value}`).join(", ");
    if (be !== pe) report.push(`${entry.name}: experience board "${be}" vs book "${pe}"`);
    const bf = b.f.map((f) => `${textNorm(f.n)}|${f.k}`).join("; ");
    const pf = entry.f.map((f) => `${textNorm(f.n)}|${f.k}`).join("; ");
    if (bf !== pf) report.push(`${entry.name}: features board [${bf}] vs book [${pf}]`);
  }
  return report;
}

/** Where two texts part: a few words of context from each. */
function diffAt(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: board "…${a.slice(Math.max(0, i - 20), i + 40)}" vs book "…${b.slice(Math.max(0, i - 20), i + 40)}"`;
}

/** The book's spelling where it differs from the board's (the board's is kept). */
const CORE_BOOK_NAMES = { "Outer Realms Corrupter": "Outer Realms Corruptor" };

function checkCore(board, coreText) {
  const core = board.filter((a) => !a.hf);
  const names = [...core.map((a) => a.name), ...Object.keys(CORE_BOOK_NAMES)];
  const blocks = splitBlocks(pagesOf(coreText, 210, 239), names).map((b) => ({ ...b, name: CORE_BOOK_NAMES[b.name] ?? b.name }));
  const report = [];
  const pages = new Map();
  let featuresEqual = 0;
  let featuresTotal = 0;
  const digitless = [];
  for (const b of blocks) {
    pages.set(b.name, b.page);
    const a = core.find((x) => x.name === b.name);
    // CB pp.224-225: the extraction lost every digit there; those blocks are checked from rendered pages.
    if (b.page === 224 || b.page === 225) {
      digitless.push(b.name);
      continue;
    }
    const block = parseBlock(b.lines);
    const { tier, type } = parseTierLine(block.tierLine, b.name);
    const book = bookEntry(b.name, tier, type, block);
    compareFields(b.name, a, book, [...NUMBER_FIELDS, "desc", "mot", "exp"], report);
    for (const f of a.f.map(splitMergedKind)) {
      featuresTotal++;
      const bf = book.f.find((x) => textNorm(x.n) === textNorm(f.n));
      const bookText = bf ? textNorm(bf.t).replace(COUNTDOWN, "") : null;
      if (!bf) report.push(`${b.name}: feature "${f.n}" not in the book`);
      else if (bf.k !== f.k) report.push(`${b.name}: feature "${f.n}" kind board ${f.k} vs book ${bf.k}`);
      else if (bookText !== textNorm(f.t)) report.push(`${b.name}: feature "${f.n}" text differs ${diffAt(textNorm(f.t), bookText)}`);
      else featuresEqual++;
    }
    if (book.f.length !== a.f.length) report.push(`${b.name}: ${a.f.length} board features vs ${book.f.length} in the book`);
  }
  const missing = core.filter((a) => !pages.has(a.name)).map((a) => a.name);
  return { report, pages, featuresEqual, featuresTotal, digitless, missing };
}

// ---------------------------------------------------------------- main

function serialize(defs) {
  const body = JSON.stringify(defs, null, 2).replace(/^(\s*)"([A-Za-z]\w*)":/gm, "$1$2:");
  return `// GENERATED FILE, do not edit by hand. Generator: scripts/srd/gen-adversaries.mjs (plan .omc/plans/d8.yaml, A1).
// Rerun: node scripts/srd/gen-adversaries.mjs --core <core.txt> --hf <hopefear.txt>, with the two books' text
// extracted locally from .reference-private/ (never committed). Core 129 from the Adversaries board (verbatim Core
// Rulebook text, patched); Hope & Fear 135 and Reign of the Weredragon 3 verbatim from the Hope & Fear book.
// Pure data: no framework imports, relative imports only. Import this leaf module, never through the srd barrel.

import type { AdversaryDef } from "./types";

export const ADVERSARIES: readonly AdversaryDef[] = ${body};
`;
}

function main() {
  const opts = args();
  const board = readBoard();
  const coreText = readFileSync(opts.core, "utf8");
  const hfText = readFileSync(opts.hf, "utf8");

  const patched = board.map((a) => (CORE_PATCHES[a.name] ? CORE_PATCHES[a.name](a) : a));
  const coreCheck = checkCore(patched, coreText);
  const core = patched
    .filter((a) => !a.hf)
    .map((a) => ({ ...a, f: a.f.map(splitMergedKind) }))
    .map((a) => toDef(a, { source: "core", page: coreCheck.pages.get(a.name) }));

  const hf = hopeAndFear(hfText, board);
  const frame = weredragon(hfText, board);
  const hfDefs = hf.map(({ entry, page }) => toDef(entry, { source: "hope-and-fear", page }));
  const frameDefs = frame.map(({ entry, page }) => toDef(entry, { source: "hope-and-fear", frameId: WEREDRAGON, page }));
  const defs = [...core, ...hfDefs, ...frameDefs].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  const hfReport = checkHopeAndFear(board, [...hf, ...frame]);
  const ids = new Set(defs.map((d) => d.id));
  const count = (f) => defs.reduce((m, d) => ((m[f(d)] = (m[f(d)] ?? 0) + 1), m), {});

  console.log(`total ${defs.length} (core ${core.length}, hope & fear ${hfDefs.length}, frame ${frameDefs.length}); unique ids ${ids.size}`);
  console.log("core by tier", count((d) => (d.source === "core" ? d.tier : "-")));
  console.log("hope & fear (incl. frame) by tier", count((d) => (d.source === "hope-and-fear" ? d.tier : "-")));
  console.log("core by type", count((d) => (d.source === "core" ? d.type : "-")));
  console.log(`H&F blocks found in the book: ${hf.length}; missing: ${board.filter((a) => a.hf && !a.frame && !hf.some((h) => h.entry.name === a.name)).map((a) => a.name).join(", ") || "none"}`);
  console.log(`H&F + frame vs board (numbers, experiences, feature names and kinds): ${hfReport.length} differences`);
  for (const line of hfReport) console.log("  " + line);
  console.log(`Core blocks found in the book: ${coreCheck.pages.size}; missing: ${coreCheck.missing.join(", ") || "none"}`);
  console.log(`Core blocks on CB pp.224-225 (no digits in the text, checked from rendered pages): ${coreCheck.digitless.join(", ")}`);
  console.log(`Core features equal to the book text after normalising: ${coreCheck.featuresEqual}/${coreCheck.featuresTotal}`);
  console.log(`Core differences: ${coreCheck.report.length}`);
  for (const line of coreCheck.report) console.log("  " + line);
  const bad = defs.flatMap((d) => [d.description, d.motives, ...d.features.flatMap((f) => [f.name, f.text])]).filter((s) => /\b(fi|fl) [a-z]|[-]/.test(s));
  console.log(`texts with ligature splits or private-use characters: ${bad.length}`);
  for (const s of bad) console.log("  " + s.slice(0, 120));

  if (ids.size !== defs.length) throw new Error("duplicate ids");
  if (defs.length !== 267) throw new Error(`expected 267 adversaries, got ${defs.length}`);
  if (!opts.check) {
    writeFileSync(OUT, serialize(defs));
    console.log(`wrote ${OUT}`);
  }
}

main();
