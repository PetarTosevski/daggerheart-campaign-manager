// Shared helpers for the perf harness (docs/performance.md): the e2e stack's ports and secret, the
// test sign-in, the benchmark campaign seed, and small statistics helpers.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";

import { e2ePorts } from "../e2e-ports.mjs";

const require = createRequire(import.meta.url);
export const { chromium } = require("@playwright/test");
const { ConvexHttpClient } = require("convex/browser");
const { anyApi } = require("convex/server");

export const ports = e2ePorts();
export const BASE = `http://localhost:${ports.next}`;
export const CONVEX = `http://127.0.0.1:${ports.convex}`;
export const GM_EMAIL = "e2e-gm@example.test";

/** The benchmark data: 4 Witherwild campaigns, the last of which ("Perf 3") has 4 level-1 characters. */
export const BENCH_CAMPAIGNS = ["Perf 0", "Perf 1", "Perf 2", "Perf 3"];
export const BENCH_CAMPAIGN = "Perf 3";
const BENCH_CHARACTERS = ["Ash", "Brin", "Cael", "Dov"];

export function e2eSecret() {
  const file = ".env.e2e.local";
  if (!existsSync(file)) throw new Error("No .env.e2e.local: run `pnpm e2e:setup` (or `pnpm worktree:setup`) first.");
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("E2E_AUTH_SECRET="));
  if (!line) throw new Error("E2E_AUTH_SECRET missing from .env.e2e.local.");
  return line.slice("E2E_AUTH_SECRET=".length);
}

/** Signs in through the test sign-in form; returns the context's storage state (cookies + Convex JWT in localStorage). */
export async function signIn(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`);
  const form = page.getByRole("form", { name: "Test sign-in" });
  await form.getByLabel("Email").fill(GM_EMAIL);
  await form.getByLabel("Secret").fill(e2eSecret());
  await form.getByRole("button", { name: "Test sign-in" }).click();
  await page.waitForURL(`${BASE}/`);
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  const state = await context.storageState();
  await context.close();
  return { state, token };
}

function client(token) {
  const c = new ConvexHttpClient(CONVEX);
  c.setAuth(token);
  return c;
}

const draft = (name) => ({
  classId: "bard",
  subclassId: "troubadour",
  ancestry: { kind: "single", id: "elf" },
  communityId: "loreborne",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
  name,
  pronouns: "she/her",
  description: "",
  primaryWeaponId: "rapier",
  armorId: "gambeson-armor",
  potion: "Minor Health Potion",
  classItem: "",
  background: [],
  experiences: ["Wandering minstrel", "Silver tongue"],
  domainCards: ["deft-deceiver", "book-of-ava"],
  connections: [],
});

/** Creates the benchmark campaigns and characters that are missing (idempotent). Returns the bench campaign id. */
export async function ensureBench(token) {
  const c = client(token);
  const find = async () => (await c.query(anyApi.campaigns.list, {})).filter((x) => BENCH_CAMPAIGNS.includes(x.name));
  let existing = await find();
  for (const name of BENCH_CAMPAIGNS) {
    if (existing.some((x) => x.name === name)) continue;
    await c.mutation(anyApi.campaigns.create, { frameId: "witherwild", name, idempotencyKey: crypto.randomUUID() });
    console.error(`seeded campaign ${name}`);
  }
  existing = await find();
  const bench = existing.find((x) => x.name === BENCH_CAMPAIGN);
  const characters = await c.query(anyApi.characters.listByCampaign, { campaignId: bench._id });
  const have = new Set();
  for (const x of characters) {
    const name = x.sheet?.name;
    if (!BENCH_CHARACTERS.includes(name)) continue;
    // Exactly one of each, so every run measures the same party.
    if (have.has(name)) await c.mutation(anyApi.characters.remove, { characterId: x._id });
    have.add(name);
  }
  for (const name of BENCH_CHARACTERS) {
    if (have.has(name)) continue;
    await c.mutation(anyApi.characters.create, { campaignId: bench._id, draft: draft(name), idempotencyKey: crypto.randomUUID() });
    console.error(`seeded character ${name}`);
  }
  // Opened last, so Load Campaign expands it and the title menu's Continue points at it.
  await c.mutation(anyApi.campaigns.markOpened, { campaignId: bench._id }).catch(() => {});
  return bench._id;
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

export function environment() {
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {}
  return { commit, cores: os.cpus().length, loadavg: os.loadavg().map((x) => Number(x.toFixed(1))) };
}

export const kb = (bytes) => Math.round(bytes / 1024);
