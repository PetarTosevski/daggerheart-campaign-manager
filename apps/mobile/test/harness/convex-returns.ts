import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { convexDir } from "./gm-functions";

/**
 * A Convex validator as `exportReturns()` serialises it (the JSON the server
 * deploys): `{ type: "object", value: { fear: { fieldType: { type: "number" }, optional: false } } }`.
 */
export type ValidatorJson =
  | { type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { type: "id"; tableName: string }
  | { type: "literal"; value: unknown }
  | { type: "array"; value: ValidatorJson }
  | { type: "object"; value: Record<string, FieldJson> }
  | { type: "record"; keys: ValidatorJson; values: FieldJson }
  | { type: "union"; value: readonly ValidatorJson[] };

type FieldJson = { fieldType: ValidatorJson; optional: boolean };

type Exported = { returns: Record<string, ValidatorJson | null>; failures: string[] };

const mobileDir = path.resolve(__dirname, "../..");
const repoDir = path.resolve(mobileDir, "../..");
const script = path.join(mobileDir, "scripts/convex-returns.mjs");
const hooks = path.join(mobileDir, "scripts/convex-hooks.mjs");
const cacheDir = path.join(mobileDir, "node_modules/.cache/convex-returns");

/** Sources the validators can come from: convex/ and the shared src/lib it imports. */
function sourceStamp(): string {
  const hash = createHash("sha1");
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
        const stat = fs.statSync(full);
        hash.update(`${full}\0${stat.size}\0${stat.mtimeMs}\n`);
      }
    }
  };
  walk(convexDir());
  walk(path.join(repoDir, "src/lib"));
  hash.update(fs.readFileSync(script));
  return hash.digest("hex");
}

let loaded: Exported | null = null;

/**
 * Every public function's `returns` validator, read from the real convex/ modules by
 * `scripts/convex-returns.mjs` (no second schema to keep in step). Cached on disk per
 * source stamp, so the export (~2 s) runs once per convex/ change, not once per test file.
 */
export function convexReturns(): Exported {
  if (loaded !== null) return loaded;
  const file = path.join(cacheDir, `${sourceStamp()}.json`);
  if (fs.existsSync(file)) {
    loaded = JSON.parse(fs.readFileSync(file, "utf8")) as Exported;
    return loaded;
  }
  const out = execFileSync(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", "--import", hooks, script],
    { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out) as Exported;
  if (parsed.failures.length > 0) {
    throw new Error(`Could not load the Convex validators:\n${parsed.failures.join("\n")}`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  // Parallel jest workers may export at once: write aside, then rename into place.
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, out);
  fs.renameSync(temp, file);
  loaded = parsed;
  return loaded;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  return `${typeof value} ${String(value)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function depth(problems: string[]): number {
  return Math.max(...problems.map((problem) => problem.split(": ")[0].length));
}

/**
 * Every place `value` breaks `validator`, as `path: problem` (array items as `[]`, record values as `{}`),
 * empty when it conforms. Mirrors the check Convex runs on a function's return value.
 */
export function mismatches(validator: ValidatorJson, value: unknown, at = "$"): string[] {
  const wrong = (expected: string) => [`${at}: expected ${expected}, got ${describe(value)}`];
  switch (validator.type) {
    case "any":
      return [];
    case "null":
      return value === null ? [] : wrong("null");
    case "number":
    case "bigint":
    case "boolean":
    case "string":
      return typeof value === validator.type ? [] : wrong(validator.type);
    case "id":
      return typeof value === "string" ? [] : wrong(`Id<"${validator.tableName}">`);
    case "bytes":
      return value instanceof ArrayBuffer ? [] : wrong("bytes");
    case "literal":
      return value === validator.value ? [] : wrong(JSON.stringify(validator.value));
    case "array": {
      if (!Array.isArray(value)) return wrong("array");
      const found = new Set<string>();
      for (const item of value) {
        for (const problem of mismatches(validator.value, item, `${at}[]`)) found.add(problem);
      }
      return [...found];
    }
    case "object": {
      if (!isPlainObject(value)) return wrong("object");
      const found: string[] = [];
      for (const [key, field] of Object.entries(validator.value)) {
        const child = value[key];
        if (child === undefined) {
          if (!field.optional) found.push(`${at}.${key}: missing (required)`);
          continue;
        }
        found.push(...mismatches(field.fieldType, child, `${at}.${key}`));
      }
      for (const key of Object.keys(value)) {
        if (!(key in validator.value) && value[key] !== undefined) found.push(`${at}.${key}: not in the validator`);
      }
      return found;
    }
    case "record": {
      if (!isPlainObject(value)) return wrong("record");
      const found = new Set<string>();
      for (const [key, child] of Object.entries(value)) {
        for (const problem of mismatches(validator.keys, key, `${at}{key}`)) found.add(problem);
        if (child === undefined && validator.values.optional) continue;
        for (const problem of mismatches(validator.values.fieldType, child, `${at}{}`)) found.add(problem);
      }
      return [...found];
    }
    case "union": {
      // The member the fixture meant: one of the value's own kind (an object for an object, not `null`),
      // then the one with the fewest problems, then the one that got deepest.
      const rank = (found: string[]) => [found.some((p) => p.startsWith(`${at}: `)) ? 1 : 0, found.length, -depth(found)];
      let best: string[] | null = null;
      for (const member of validator.value) {
        const found = mismatches(member, value, at);
        if (found.length === 0) return [];
        if (best === null) {
          best = found;
          continue;
        }
        const [a, b] = [rank(found), rank(best)];
        const index = a.findIndex((n, i) => n !== b[i]);
        if (index !== -1 && a[index] < b[index]) best = found;
      }
      if (best === null || rank(best)[0] === 1) {
        // Wrong at this level for every member: name them all (`"draft" | "running"`).
        return wrong(validator.value.map((member) => (member.type === "literal" ? JSON.stringify(member.value) : member.type)).join(" | "));
      }
      return best;
    }
  }
}

/** A paginated query's `returns` (`{ page, isDone, continueCursor, ... }`): the page element validator. */
function pageElement(validator: ValidatorJson): ValidatorJson | null {
  if (validator.type !== "object") return null;
  const page = validator.value.page?.fieldType;
  if (page === undefined || page.type !== "array" || validator.value.isDone === undefined) return null;
  return page.value;
}

/**
 * Why the fixture `value` for `name` is not something the server could return, as
 * `name $.path: problem`; empty when it could. `undefined` is "still loading" and always fine.
 * A paginated query's fixture may be the page rows (an array) or the hook's `{ results, status }`;
 * each row is checked against the page element.
 */
export function fixtureMismatches(name: string, value: unknown): string[] {
  if (value === undefined) return [];
  const validator = convexReturns().returns[name];
  if (validator === undefined || validator === null) return [];
  let found: string[];
  const element = pageElement(validator);
  const rows =
    element === null
      ? null
      : Array.isArray(value)
        ? value
        : isPlainObject(value) && Array.isArray(value.results)
          ? value.results
          : null;
  if (element !== null && rows !== null) found = mismatches({ type: "array", value: element }, rows);
  else found = mismatches(validator, value);
  return found.map((problem) => `${name} ${problem}`);
}
