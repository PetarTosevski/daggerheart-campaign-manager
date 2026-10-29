import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const srcRoot = path.resolve(__dirname, "../../src");

function listSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSources(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

test("apps/mobile/src does not call Math.random", () => {
  const files = listSources(srcRoot);
  expect(files.length).toBeGreaterThan(0);
  const violations: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (/\bMath\s*\.\s*random\s*\(/.test(source) || /Math\s*\[\s*["']random["']\s*\]/.test(source)) {
      violations.push(path.relative(srcRoot, file));
    }
  }
  expect(violations).toEqual([]);
});
