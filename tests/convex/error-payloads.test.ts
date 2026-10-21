import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every server error is `ConvexError<AppError>` with an object payload
 * `{ code, message? }` (rule 9, CF13); the client reads no other shape
 * (`src/lib/convex-errors.ts`). This scans the raw source of `convex/**` and
 * fails on a `ConvexError` built from anything but an object literal: a string
 * (`new ConvexError("FORBIDDEN")`), a template, or a bare identifier whose
 * shape the scan can't see. Throw `appError(code)` instead.
 */

const ROOT = join(__dirname, "../../convex");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "_generated" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** `ConvexError(` or `ConvexError<T>(`, then the first character of its payload. */
const CONSTRUCTION = /\bConvexError\s*(?:<[^>()]*>)?\s*\(\s*(\S)/g;

/** The 1-based lines of `source` that build a `ConvexError` without an object-literal payload. */
function nonObjectPayloads(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(CONSTRUCTION)) {
    if (match[1] === "{") continue;
    lines.push(source.slice(0, match.index).split("\n").length);
  }
  return lines;
}

describe("ConvexError payloads", () => {
  it("the scan flags string, template and identifier payloads and accepts object literals", () => {
    expect(nonObjectPayloads('throw new ConvexError("FORBIDDEN");')).toEqual([1]);
    expect(nonObjectPayloads("x;\nthrow new ConvexError('NOT_FOUND');")).toEqual([2]);
    expect(nonObjectPayloads("throw new ConvexError(`NOT_${what}`);")).toEqual([1]);
    expect(nonObjectPayloads("throw new ConvexError(code);")).toEqual([1]);
    expect(nonObjectPayloads('throw new ConvexError<string>(\n  "FORBIDDEN",\n);')).toEqual([1]);
    expect(nonObjectPayloads('throw ConvexError("FORBIDDEN");')).toEqual([1]);
    expect(nonObjectPayloads("throw new ConvexError({ code, message: error.message });")).toEqual([]);
    expect(nonObjectPayloads("return new ConvexError<AppError>({ code });")).toEqual([]);
    expect(nonObjectPayloads('import { ConvexError } from "convex/values";\nif (e instanceof ConvexError) throw e;')).toEqual([]);
  });

  it("convex/** builds every ConvexError from an object literal (use appError)", () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(0);
    const bad = files.flatMap((file) =>
      nonObjectPayloads(readFileSync(file, "utf8")).map((line) => `convex/${relative(ROOT, file)}:${line}`),
    );
    expect(bad).toEqual([]);
  });
});
