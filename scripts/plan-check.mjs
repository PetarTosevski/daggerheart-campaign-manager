// Validates a tracer-bullet build plan (docs/workflow.md) and refuses plans in
// which two tracers of the same wave own overlapping files.
//
//   node scripts/plan-check.mjs .omc/plans/<plan>.yaml
//
// Exit 0: valid (warnings may be printed). Exit 1: invalid. Exit 2: usage.
//
// YAML: plans are parsed by the small subset parser below, so the scripts need
// no dependency (the `yaml` package is not resolvable from the project root).
// Supported subset, which is all the plan format uses:
//   - block mappings (`key: value`, `key:` + indented block) with identifier
//     keys ([A-Za-z_][A-Za-z0-9_-]*); a block sequence may sit at the same
//     indent as its key, as in standard YAML
//   - block sequences (`- item`, `- key: value` starting a mapping)
//   - flow sequences of scalars on one line (`[]`, `[T1, T2]`)
//   - scalars: plain, "double-quoted" (JSON escapes), 'single-quoted';
//     integers, true/false and null/~ are converted
//   - full-line comments and ` #` trailing comments outside quotes
// Not supported: tabs, anchors/aliases, flow mappings, multi-line scalars.
// Quote a sequence item that starts with `word: ` (e.g. "- 'lint: passes'"),
// otherwise it reads as a mapping.
//
// Globs in `owns`/`reads`: `**` = any number of path segments (including
// none), `*` = any characters within one segment, `?` = one character. All
// other characters are literal, so Next.js paths like `[campaignId]` and
// `(gm)` need no escaping. A trailing `/` means the whole directory (`dir/**`).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// YAML subset parser

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[,:-]/.test(text[i - 1])) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

function parseScalar(raw, lineNo) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`line ${lineNo}: invalid double-quoted string ${value}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error(`line ${lineNo}: unterminated single-quoted string ${value}`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new Error(`line ${lineNo}: unterminated flow sequence ${value}`);
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseScalar(item, lineNo));
  }
  if (value.startsWith("{")) throw new Error(`line ${lineNo}: flow mappings are not supported`);
  if (value.startsWith("&") || value.startsWith("*") || value.startsWith("|") || value.startsWith(">")) {
    throw new Error(`line ${lineNo}: anchors, aliases and block scalars are not supported`);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~" || value === "") return null;
  return value;
}

const KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/;
const isSeqItem = (text) => text === "-" || text.startsWith("- ");

/** Parses the documented YAML subset into plain objects/arrays/scalars. */
export function parseYaml(source) {
  const lines = [];
  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const indentMatch = /^[ \t]*/.exec(rawLine)[0];
    if (indentMatch.includes("\t")) throw new Error(`line ${lineNo}: tabs are not allowed for indentation`);
    const text = stripComment(rawLine.slice(indentMatch.length));
    if (text === "" || text === "---") return;
    lines.push({ indent: indentMatch.length, text, lineNo });
  });
  if (lines.length === 0) return null;

  let pos = 0;

  function parseBlock(indent) {
    return isSeqItem(lines[pos].text) ? parseSequence(indent) : parseMapping(indent);
  }

  function parseSequence(indent) {
    const items = [];
    while (pos < lines.length && lines[pos].indent === indent && isSeqItem(lines[pos].text)) {
      const line = lines[pos];
      const rest = line.text.slice(1).trimStart();
      if (rest === "") {
        pos++;
        if (pos < lines.length && lines[pos].indent > indent) items.push(parseBlock(lines[pos].indent));
        else items.push(null);
      } else if (KEY.test(rest) || isSeqItem(rest)) {
        // "- key: value" opens a mapping whose keys align with "key".
        const childIndent = indent + (line.text.length - rest.length);
        lines[pos] = { indent: childIndent, text: rest, lineNo: line.lineNo };
        items.push(parseBlock(childIndent));
      } else {
        items.push(parseScalar(rest, line.lineNo));
        pos++;
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) {
      throw new Error(`line ${lines[pos].lineNo}: unexpected indentation`);
    }
    return items;
  }

  function parseMapping(indent) {
    const map = {};
    while (pos < lines.length && lines[pos].indent === indent && !isSeqItem(lines[pos].text)) {
      const line = lines[pos];
      const match = KEY.exec(line.text);
      if (!match) throw new Error(`line ${line.lineNo}: expected "key: value", got "${line.text}"`);
      const [, key, value] = match;
      if (Object.hasOwn(map, key)) throw new Error(`line ${line.lineNo}: duplicate key "${key}"`);
      pos++;
      if (value !== undefined && value !== "") {
        map[key] = parseScalar(value, line.lineNo);
      } else if (pos < lines.length && lines[pos].indent > indent) {
        map[key] = parseBlock(lines[pos].indent);
      } else if (pos < lines.length && lines[pos].indent === indent && isSeqItem(lines[pos].text)) {
        map[key] = parseSequence(indent);
      } else {
        map[key] = null;
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) {
      throw new Error(`line ${lines[pos].lineNo}: unexpected indentation`);
    }
    return map;
  }

  const result = parseBlock(lines[0].indent);
  if (pos < lines.length) throw new Error(`line ${lines[pos].lineNo}: unexpected content "${lines[pos].text}"`);
  return result;
}

// ---------------------------------------------------------------------------
// Globs

function normalizeGlob(glob) {
  let g = String(glob).trim().replace(/^\.\//, "");
  if (g.endsWith("/")) g += "**";
  return g;
}

function tokenizeSegment(segment, literal) {
  return [...segment].map((c) => (literal ? c : c === "*" ? STAR : c === "?" ? ANY : c));
}
const STAR = Symbol("*");
const ANY = Symbol("?");

/** True when some string matches both token lists (segment-level patterns). */
function segmentsIntersect(p, q) {
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (q.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (i < p.length && p[i] === STAR) result = go(i + 1, j) || (j < q.length && go(i, j + 1));
    else if (j < q.length && q[j] === STAR) result = go(i, j + 1) || (i < p.length && go(i + 1, j));
    else if (i === p.length || j === q.length) result = i === p.length && j === q.length;
    else result = (p[i] === ANY || q[j] === ANY || p[i] === q[j]) && go(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

function toPattern(pathOrGlob, literal) {
  const normalized = literal ? String(pathOrGlob).replace(/^\.\//, "") : normalizeGlob(pathOrGlob);
  return normalized
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => (!literal && segment === "**" ? "**" : tokenizeSegment(segment, literal)));
}

function patternsIntersect(a, b) {
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (b.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (i < a.length && a[i] === "**") result = go(i + 1, j) || (j < b.length && go(i, j + 1));
    else if (j < b.length && b[j] === "**") result = go(i, j + 1) || (i < a.length && go(i + 1, j));
    else if (i === a.length || j === b.length) result = i === a.length && j === b.length;
    else result = segmentsIntersect(a[i], b[j]) && go(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

/** True when at least one path could match both globs. */
export function globsOverlap(a, b) {
  return patternsIntersect(toPattern(a, false), toPattern(b, false));
}

/** True when the literal repository path matches the glob. */
export function matchGlob(glob, path) {
  return patternsIntersect(toPattern(glob, false), toPattern(path, true));
}

// ---------------------------------------------------------------------------
// Plan validation

export const ALWAYS_SHARED = ["package.json", "pnpm-lock.yaml", "convex/_generated/**"];

/** T0 or a tracer marked `foundation: true` may own always-shared files. */
export function isFoundationTracer(tracer) {
  return tracer.id === "T0" || tracer.foundation === true;
}

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");

/** Every tracer of the plan with the index of its wave, in plan order. */
export function planTracers(plan) {
  const result = [];
  (Array.isArray(plan?.waves) ? plan.waves : []).forEach((wave, waveIndex) => {
    (Array.isArray(wave?.tracers) ? wave.tracers : []).forEach((tracer) => {
      if (tracer && typeof tracer === "object") result.push({ tracer, waveIndex, wave: wave.wave ?? waveIndex + 1 });
    });
  });
  return result;
}

/** Returns the first dependency cycle as a list of ids (first id repeated at the end), or null. */
export function findCycle(edges) {
  const state = new Map(); // id -> "visiting" | "done"
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const id of edges.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/** Validates a parsed plan. Returns { errors: string[], warnings: string[] }. */
export function validatePlan(plan) {
  const errors = [];
  const warnings = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { errors: ["plan must be a mapping with `plan` and `waves`"], warnings };
  }
  if (typeof plan.plan !== "string" || plan.plan.trim() === "") errors.push("`plan` must be a non-empty name");
  if (!Array.isArray(plan.waves) || plan.waves.length === 0) {
    errors.push("`waves` must be a non-empty list");
    return { errors, warnings };
  }
  plan.waves.forEach((wave, index) => {
    if (!wave || typeof wave !== "object" || !Array.isArray(wave.tracers) || wave.tracers.length === 0) {
      errors.push(`wave ${wave?.wave ?? index + 1}: \`tracers\` must be a non-empty list`);
    }
  });

  const entries = planTracers(plan);
  const waveOf = new Map();
  for (const { tracer, waveIndex, wave } of entries) {
    const id = tracer.id;
    const label = typeof id === "string" && id !== "" ? id : `(tracer without id in wave ${wave})`;
    if (typeof id !== "string" || id.trim() === "") errors.push(`${label}: \`id\` is required`);
    else if (waveOf.has(id)) errors.push(`${id}: duplicate tracer id`);
    else waveOf.set(id, waveIndex);
    if (typeof tracer.goal !== "string" || tracer.goal.trim() === "") errors.push(`${label}: \`goal\` is required`);
    if (!isStringList(tracer.owns) || tracer.owns.length === 0) errors.push(`${label}: \`owns\` must be a non-empty list of paths/globs`);
    if (!isStringList(tracer.acceptance) || tracer.acceptance.length === 0) errors.push(`${label}: \`acceptance\` must be a non-empty list`);
    if (tracer.reads !== undefined && tracer.reads !== null && !isStringList(tracer.reads)) errors.push(`${label}: \`reads\` must be a list of paths/globs`);
    if (tracer.depends_on !== undefined && tracer.depends_on !== null && !isStringList(tracer.depends_on)) {
      errors.push(`${label}: \`depends_on\` must be a list of tracer ids`);
    }
  }

  const edges = new Map();
  for (const { tracer, waveIndex } of entries) {
    if (typeof tracer.id !== "string") continue;
    const deps = isStringList(tracer.depends_on) ? tracer.depends_on : [];
    edges.set(tracer.id, deps.filter((dep) => dep !== tracer.id));
    for (const dep of deps) {
      if (dep === tracer.id) errors.push(`${tracer.id}: depends on itself`);
      else if (!waveOf.has(dep)) errors.push(`${tracer.id}: depends_on "${dep}", which is not a tracer in this plan`);
      else if (waveOf.get(dep) > waveIndex) errors.push(`${tracer.id}: depends_on "${dep}", which is in a later wave`);
    }
  }
  const cycle = findCycle(edges);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(" -> ")}`);

  for (let x = 0; x < entries.length; x++) {
    for (let y = x + 1; y < entries.length; y++) {
      const a = entries[x];
      const b = entries[y];
      if (a.waveIndex !== b.waveIndex || !isStringList(a.tracer.owns) || !isStringList(b.tracer.owns)) continue;
      for (const ownA of a.tracer.owns) {
        for (const ownB of b.tracer.owns) {
          if (globsOverlap(ownA, ownB)) {
            errors.push(
              `wave ${a.wave}: ${a.tracer.id} and ${b.tracer.id} own overlapping paths: ` +
                `"${ownA}" (${a.tracer.id}) overlaps "${ownB}" (${b.tracer.id})`,
            );
          }
        }
      }
    }
  }

  for (const { tracer } of entries) {
    if (!isStringList(tracer.owns) || isFoundationTracer(tracer)) continue;
    for (const own of tracer.owns) {
      const shared = ALWAYS_SHARED.find((path) => globsOverlap(own, path));
      if (shared) {
        warnings.push(
          `${tracer.id}: owns "${own}", which touches always-shared "${shared}"; ` +
            "give it to a T0/foundation tracer or let the orchestrator edit it at merge time",
        );
      }
    }
  }

  return { errors, warnings };
}

/** Reads and parses a plan file; throws with the file name on syntax errors. */
export function loadPlan(file) {
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/plan-check.mjs <plan.yaml>");
    process.exit(2);
  }
  let plan;
  try {
    plan = loadPlan(file);
  } catch (error) {
    console.error(`plan-check: ${error.message}`);
    process.exit(1);
  }
  const { errors, warnings } = validatePlan(plan);
  for (const warning of warnings) console.warn(`plan-check: warning: ${warning}`);
  if (errors.length > 0) {
    console.error(`plan-check: ${file} is invalid:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const count = planTracers(plan).length;
  console.log(`plan-check: ${file} OK (${plan.waves.length} wave(s), ${count} tracer(s))`);
}
