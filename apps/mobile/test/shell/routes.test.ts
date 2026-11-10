import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@jest/globals";

const appDir = path.resolve(__dirname, "../../app");

function routeFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...routeFiles(full));
      continue;
    }
    if (entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

test("every route file exports a default screen and an ErrorBoundary", () => {
  const files = routeFiles(appDir);
  expect(files.length).toBeGreaterThan(0);
  const missing: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(appDir, file);
    if (!/export\s+default\s+function\b/.test(source)) missing.push(`${relative} default`);
    if (!/export\s*\{[^}]*\bErrorBoundary\b/.test(source) && !/export\s+function\s+ErrorBoundary\b/.test(source)) {
      missing.push(`${relative} ErrorBoundary`);
    }
  }
  expect(missing).toEqual([]);
});

test("GM routes sit in the protected group", () => {
  const layout = fs.readFileSync(path.join(appDir, "campaign/[campaignId]/_layout.tsx"), "utf8");
  const gmLayout = fs.readFileSync(path.join(appDir, "campaign/[campaignId]/(gm)/_layout.tsx"), "utf8");
  expect(layout).toContain("Stack.Protected");
  expect(layout).toContain('name="(gm)"');
  expect(gmLayout).toContain('name="adversaries"');
  expect(gmLayout).toContain('name="adversaries/[encounterId]"');
  expect(gmLayout).toContain('name="packs"');
  expect(fs.existsSync(path.join(appDir, "campaign/[campaignId]/(gm)/adversaries.tsx"))).toBe(true);
  expect(fs.existsSync(path.join(appDir, "campaign/[campaignId]/(gm)/adversaries/[encounterId].tsx"))).toBe(true);
  expect(fs.existsSync(path.join(appDir, "campaign/[campaignId]/(gm)/packs.tsx"))).toBe(true);
});

test("Journal is a route, and Sessions and Notes redirect into its sub-tabs", () => {
  const dir = path.join(appDir, "campaign/[campaignId]");
  const layout = fs.readFileSync(path.join(dir, "_layout.tsx"), "utf8");
  const sessions = fs.readFileSync(path.join(dir, "sessions.tsx"), "utf8");
  const notes = fs.readFileSync(path.join(dir, "notes.tsx"), "utf8");
  expect(fs.existsSync(path.join(dir, "journal.tsx"))).toBe(true);
  expect(sessions).toContain("<Redirect");
  expect(sessions).toContain('journalHref(firstParam(params.campaignId), "sessions")');
  expect(notes).toContain("<Redirect");
  expect(notes).toContain('journalHref(firstParam(params.campaignId), "notes")');
  expect(fs.existsSync(path.join(dir, "sessions/[sessionId].tsx"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "notes/[pageId].tsx"))).toBe(true);
  expect(layout).not.toContain('sectionLabel("sessions")');
  expect(layout).not.toContain('sectionLabel("notes")');
});
