#!/usr/bin/env node
// Generates src/lib/srd/environments.ts: the SRD environment stat blocks (19 Core Rulebook, 28 Hope & Fear) as typed
// data (plan .omc/plans/environments.yaml, tracer EV1).
//
//   node scripts/srd/gen-environments.mjs --core <core.txt> --hf <hopefear.txt> [--check]
//
// <core.txt> and <hopefear.txt> are the text of the two books (one "===== PAGE <printed page> =====" line per page),
// extracted locally from the PDFs in .reference-private/ (pdfjs-dist), as for gen-adversaries.mjs. The books and their
// text are never committed and nothing in CI runs this script: the generated file is committed instead.
// --check prints the cross-checks and writes nothing.
//
// Sources, verbatim (D3-D11 decision):
// - Core Rulebook pp.243-251 ("Environment Stat Blocks"; the list "Environments by Tier" on p.242). The Raging River
//   example of p.240 repeats the p.245 block and is skipped.
// - Hope & Fear pp.99-112 (the list on p.98). The extraction prints the tier digits in a private-use font
//   (U+E540 + n), mapped back to n.
// Names, tiers and types come from the two lists and are checked against each block's heading and "Tier N Type" line.
// Feature questions are the italic lines below each feature; the text has no italics, so they are the feature's last
// lines that hold nothing but questions (checked against the PDF's italic runs, see docs/tasks/TASK-EV1.md).
// Potential adversaries are matched to src/lib/srd/adversaries.ts by name (and by group, "Jagged Knife Bandits
// (Hexer, ...)" -> "Jagged Knife Hexer").

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/lib/srd/environments.ts");
const ADVERSARIES = join(ROOT, "src/lib/srd/adversaries.ts");

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
    console.error("usage: node scripts/srd/gen-environments.mjs --core <core.txt> --hf <hopefear.txt> [--check]");
    process.exit(2);
  }
  return out;
}

// ---------------------------------------------------------------- text helpers (as gen-adversaries.mjs)

const FEATURE_START = /^(“?[A-Z0-9][^:]{0,70}?) - (Passive|Action|Reaction)(?::\s*(.*))?$/;
const COUNTDOWN = /^((?:[A-Z][\w-]* )*Countdown(?: \([^)]*\))?)\.\s*/;

/** Private-use digits U+E540+n -> n (the books' number font). */
const mapDigits = (s) => s.replace(/[-]/g, (c) => String(c.codePointAt(0) - 0xe540));

/** Digits the Core text lost, read from the rendered pages (CB p.248 "Countdown (Loop 6)", p.250 "Countdown (Loop 1d4)"). */
const BOOK_FIXES = [
  ["Choking Ash - Reaction: Countdown (Loop )", "Choking Ash - Reaction: Countdown (Loop 6)"],
  ["Countdown (Loop 1d). Activate the countdown.", "Countdown (Loop 1d4). Activate the countdown."],
];
const applyFixes = (s) => BOOK_FIXES.reduce((acc, [from, to]) => acc.replace(from, to), s);

/** Ligatures split by the extraction ("fi rst", "refl ect"). */
const joinLigatures = (s) => s.replace(/(fi|fl) (?=[a-z])/g, "$1");

/** A numbered item inside a feature ("1. Loose gemstones ..."), kept as a list item. */
const NUMBERED = /^\d+\. \S/;
const BULLET = /^• /;

const norm = (s) =>
  s
    .toUpperCase()
    .replace(/[’']/g, "")
    .replace(/[^A-Z0-9]/g, "");

/** An art caption, running head or section label: letters present, none lower case. */
const isCaps = (line) => line !== "FEATURES" && /[A-Z].*[A-Z]/.test(line) && !/[a-z]/.test(line);

/** Running heads and footers: "240 Chapter 4: ...", "Chapter 3: Tier 1 Environments100", "105105Chapter 3: ...". */
const isFooter = (line) => /^\d{0,6}\s?Chapter \d+:/.test(line);

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

/** Wrapped prose joined: a hyphen or dash at a line end joins without a space. */
function joinProse(lines) {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/[A-Za-z]-$/.test(out) || /—$/.test(out) || /^—/.test(line)) out += line;
    else out += " " + line;
  }
  return joinLigatures(out).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- the "Environments by Tier" lists

/** "Tier 1 (Level 1)" headings and "Name (Type) [page]" lines (a name may wrap before its "(Type)"). */
function parseIndex(lines) {
  const out = [];
  let tier = null;
  let pending = "";
  for (const { line } of lines) {
    const t = /^Tier (\d) \(Levels? [\d–]+\)$/.exec(line);
    if (t) {
      tier = Number(t[1]);
      pending = "";
      continue;
    }
    if (tier === null) continue;
    const m = /^(.*?)\s*\((Exploration|Social|Traversal|Event)\)(?: \d+)?$/.exec(line);
    if (m) {
      out.push({ name: joinLigatures(`${pending} ${m[1]}`.trim()), tier, type: m[2] });
      pending = "";
    } else if (/^Tip:/.test(line) || isFooter(line)) break;
    else pending = line;
  }
  return out;
}

// ---------------------------------------------------------------- stat blocks

/**
 * Splits page lines into stat blocks. A block starts with its name (1-3 all-caps lines that together equal a listed
 * name or an alias) directly above a "Tier ..." line; other all-caps lines (art captions, running heads) are dropped.
 */
function splitBlocks(lines, names) {
  const known = new Map(names.map((n) => [norm(n.heading ?? n.name), n.name]));
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

/** Questions only: ends with "?", and no sentence inside it ends with "." or "!". */
const onlyQuestions = (text) => /\?[”"]?$/.test(text) && !/[.!][”"]?\s/.test(text) && !/[.!]$/.test(text);

/**
 * A feature's lines -> { text, questions }. The questions are the shortest run of last lines that starts a sentence and
 * holds nothing but questions (never a list item). Text: "• " bullets and "1. " items become "- " lines; after a list,
 * a capitalised line after a short line (the item ended before the column did) starts a new paragraph, other lines
 * continue the item.
 */
function splitFeature(rawLines) {
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);
  let q = lines.length;
  for (let k = 1; k < lines.length; k++) {
    const rest = lines.slice(k);
    if (!/^[A-Z“"]/.test(lines[k]) || rest.some((l) => BULLET.test(l) || NUMBERED.test(l))) continue;
    if (onlyQuestions(joinProse(rest))) {
      q = k;
      break;
    }
  }
  const textLines = lines.slice(0, q);
  const questions = q < lines.length ? joinProse(lines.slice(q)) : undefined;

  const paras = [];
  let inList = false;
  let prev = "";
  for (const line of textLines) {
    if (BULLET.test(line) || NUMBERED.test(line)) {
      paras.push(["- " + line.replace(BULLET, "")]);
      inList = true;
    } else if (!paras.length) paras.push([line]);
    else if (inList && /^[A-Z“"]/.test(line) && prev.length < 45) {
      paras.push([line]);
      inList = false;
    } else paras[paras.length - 1].push(line);
    prev = line;
  }
  const text = paras.map((p) => joinProse(p)).join("\n");
  return { text, questions };
}

/** Same rule as featureFearCost in src/lib/domain/adversaries (the unit test keeps them equal). */
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function fearCost(text) {
  const m = /\bspend (a|an|one|two|three|four|five|six|\d+) Fear\b/i.exec(text);
  if (!m) return undefined;
  const word = m[1].toLowerCase();
  return WORD_NUMBERS[word] ?? Number(word);
}

/** Top-level comma split, ignoring commas inside parentheses. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Adversary lookup by normalised name, with simple plurals ("Constructs", "Yufos") and group prefixes. */
function adversaryResolver(adversaries) {
  const byName = new Map(adversaries.map((a) => [norm(a.name), a.id]));
  // The Volcanic Dragon is three stat blocks fought in order (CB pp.237-238); the link opens the first phase.
  byName.set(norm("Volcanic Dragon"), "volcanic-dragon-obsidian-predator");
  const find = (name) => byName.get(norm(name)) ?? (/s$/.test(name) ? byName.get(norm(name.replace(/s$/, ""))) : undefined);
  return (name, group) => {
    const direct = find(name);
    if (direct) return direct;
    if (!group) return undefined;
    // "Jagged Knife Bandits (Hexer)" -> "Jagged Knife Hexer"; "Outer Realms Monstrosities (Thrall)" -> "Outer Realms Thrall".
    const words = group.split(" ");
    for (let n = words.length - 1; n >= 1; n--) {
      const hit = find(`${words.slice(0, n).join(" ")} ${name}`);
      if (hit) return hit;
    }
    return undefined;
  };
}

/** Members whose group name gives no prefix: the prefix of a sibling ("Jagged Knife Bandit, Lackey" -> "Jagged Knife Lackey"). */
function resolveMembers(names, group, resolve) {
  const ids = names.map((name) => resolve(name, group));
  return names.map((name, i) => {
    let id = ids[i];
    for (const sibling of names) {
      if (id) break;
      const words = sibling.split(" ");
      if (words.length > 1 && resolve(sibling)) id = resolve(name, words.slice(0, -1).join(" ") + " x");
    }
    return id ? { name, adversaryId: id } : { name };
  });
}

function potentialAdversaries(text, resolve) {
  return splitTop(text).map((item) => {
    const m = /^(.+?) \((.+)\)$/.exec(item);
    if (m && !/^see /.test(m[2])) {
      const ref = { name: m[1], members: resolveMembers(splitTop(m[2]), m[1], resolve) };
      const id = resolve(m[1]);
      return id ? { name: ref.name, adversaryId: id, members: ref.members } : ref;
    }
    const id = resolve(item);
    return id ? { name: item, adversaryId: id } : { name: item };
  });
}

/** The "Potential Adversaries" line rebuilt from the parsed entries (must equal the book's). */
const potentialText = (refs) => refs.map((r) => (r.members ? `${r.name} (${r.members.map((m) => m.name).join(", ")})` : r.name)).join(", ");

/** One block's lines (starting at its "Tier" line) -> environment fields. */
function parseBlock(name, lines) {
  const sections = { tier: [lines[0]], desc: [], impulses: [], difficulty: [], adversaries: [], features: [] };
  let at = "desc";
  for (const line of lines.slice(1)) {
    if (/^Impulses:/.test(line) && at === "desc") at = "impulses";
    else if (/^Difficulty:/.test(line) && at === "impulses") at = "difficulty";
    else if (/^Potential Adversaries:/.test(line) && at === "difficulty") at = "adversaries";
    else if (line === "FEATURES" && at === "adversaries") {
      at = "features";
      continue;
    }
    sections[at].push(line);
  }
  const tier = /^Tier\s+(\d)\s+(Exploration|Social|Traversal|Event)$/.exec(sections.tier[0]);
  if (!tier) throw new Error(`${name}: unparsed tier line "${sections.tier[0]}"`);
  const difficultyText = joinProse(sections.difficulty).replace(/^Difficulty:\s*/, "");
  const features = [];
  let current = null;
  for (const line of sections.features) {
    const m = FEATURE_START.exec(line);
    if (m) {
      current = { name: joinLigatures(m[1].trim()), kind: m[2].toLowerCase(), lines: m[3] ? [m[3]] : [] };
      features.push(current);
    } else if (current) current.lines.push(line);
    else throw new Error(`${name}: feature text before the first feature: ${line}`);
  }
  return {
    tier: Number(tier[1]),
    type: tier[2],
    description: joinProse(sections.desc),
    impulses: joinProse(sections.impulses).replace(/^Impulses:\s*/, ""),
    difficulty: /^\d+$/.test(difficultyText) ? Number(difficultyText) : difficultyText,
    adversariesText: joinProse(sections.adversaries).replace(/^Potential Adversaries:\s*/, ""),
    features: features.map((f) => {
      const { text, questions } = splitFeature(f.lines);
      const out = { name: f.name, kind: f.kind, text };
      const cd = COUNTDOWN.exec(text);
      if (cd) {
        out.countdown = cd[1];
        out.text = text.slice(cd[0].length);
      }
      const cost = fearCost(out.text);
      if (cost !== undefined) out.fearCost = cost;
      if (questions) out.questions = questions;
      return out;
    }),
  };
}

function readAdversaries() {
  const src = readFileSync(ADVERSARIES, "utf8");
  return [...src.matchAll(/^ {4}id: "([^"]+)",\n {4}name: "([^"]+)",/gm)].map((m) => ({ id: m[1], name: m[2] }));
}

/** Stat block headings that differ from the list's name (the list's name is kept). */
const HEADINGS = { "Convergence, City of Portals": "Convergence, the City of Portals" };

function book(text, { listPages, blockPages, source }, resolve) {
  const index = parseIndex(pagesOf(text, listPages, listPages));
  const names = index.map((e) => ({ name: e.name, heading: HEADINGS[e.name] }));
  const blocks = splitBlocks(pagesOf(text, blockPages[0], blockPages[1]), names);
  const report = [];
  const defs = blocks.map((b) => {
    const p = parseBlock(b.name, b.lines);
    const listed = index.find((e) => e.name === b.name);
    if (listed.tier !== p.tier || listed.type !== p.type) report.push(`${b.name}: list says Tier ${listed.tier} ${listed.type}, block Tier ${p.tier} ${p.type}`);
    const refs = potentialAdversaries(p.adversariesText, resolve);
    if (potentialText(refs) !== p.adversariesText) report.push(`${b.name}: potential adversaries do not round-trip: "${p.adversariesText}"`);
    return {
      id: slug(b.name),
      name: b.name,
      tier: p.tier,
      type: p.type,
      description: p.description,
      impulses: p.impulses,
      difficulty: p.difficulty,
      potentialAdversaries: refs,
      features: p.features,
      source,
      page: b.page,
    };
  });
  const missing = index.filter((e) => !blocks.some((b) => b.name === e.name)).map((e) => e.name);
  return { index, defs, report, missing };
}

// ---------------------------------------------------------------- main

function serialize(defs) {
  const body = JSON.stringify(defs, null, 2).replace(/^(\s*)"([A-Za-z]\w*)":/gm, "$1$2:");
  return `// GENERATED FILE, do not edit by hand. Generator: scripts/srd/gen-environments.mjs (plan .omc/plans/environments.yaml, EV1).
// Rerun: node scripts/srd/gen-environments.mjs --core <core.txt> --hf <hopefear.txt>, with the two books' text
// extracted locally from .reference-private/ (never committed). Core Rulebook 19 (CB pp.243-251) and Hope & Fear 28
// (HF pp.99-112), verbatim. Pure data: no framework imports, relative imports only. Import this leaf module, never
// through the srd barrel.

import type { EnvironmentDef } from "./types";

export const ENVIRONMENTS: readonly EnvironmentDef[] = ${body};
`;
}

function main() {
  const opts = args();
  const resolve = adversaryResolver(readAdversaries());
  const core = book(readFileSync(opts.core, "utf8"), { listPages: 242, blockPages: [243, 251], source: "core" }, resolve);
  const hf = book(readFileSync(opts.hf, "utf8"), { listPages: 98, blockPages: [99, 112], source: "hope-and-fear" }, resolve);
  const defs = [...core.defs, ...hf.defs].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  const ids = new Set(defs.map((d) => d.id));
  const count = (list) => list.reduce((m, d) => ((m[d.tier] = (m[d.tier] ?? 0) + 1), m), {});

  console.log(`total ${defs.length} (core ${core.defs.length}, hope & fear ${hf.defs.length}); unique ids ${ids.size}`);
  console.log(`core list ${core.index.length}`, count(core.index), "blocks", count(core.defs), `missing: ${core.missing.join(", ") || "none"}`);
  console.log(`hope & fear list ${hf.index.length}`, count(hf.index), "blocks", count(hf.defs), `missing: ${hf.missing.join(", ") || "none"}`);
  for (const line of [...core.report, ...hf.report]) console.log("  " + line);
  const features = defs.flatMap((d) => d.features);
  console.log(`features ${features.length}; with questions ${features.filter((f) => f.questions).length}; countdowns ${features.filter((f) => f.countdown).length}; Fear costs ${features.filter((f) => f.fearCost).length}`);
  const refs = defs.flatMap((d) => d.potentialAdversaries.flatMap((r) => [r, ...(r.members ?? [])]));
  console.log(`potential adversary names ${refs.length}; linked ${refs.filter((r) => r.adversaryId).length}`);
  console.log(`  unlinked: ${[...new Set(refs.filter((r) => !r.adversaryId && !r.members).map((r) => r.name))].join("; ")}`);
  const bad = defs
    .flatMap((d) => [d.description, d.impulses, ...d.features.flatMap((f) => [f.name, f.text, f.questions ?? ""])])
    .filter((s) => /\b(fi|fl) [a-z]|[-]/.test(s));
  console.log(`texts with ligature splits or private-use characters: ${bad.length}`);
  for (const s of bad) console.log("  " + s.slice(0, 120));

  if (ids.size !== defs.length) throw new Error("duplicate ids");
  if (core.defs.length !== 19 || hf.defs.length !== 28) throw new Error(`expected 19 + 28 environments, got ${core.defs.length} + ${hf.defs.length}`);
  if (core.report.length || hf.report.length) throw new Error("cross-check differences");
  if (!opts.check) {
    writeFileSync(OUT, serialize(defs));
    console.log(`wrote ${OUT}`);
  }
}

main();
