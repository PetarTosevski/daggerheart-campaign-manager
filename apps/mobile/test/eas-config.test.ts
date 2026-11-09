import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@jest/globals";

const easPath = path.join(__dirname, "..", "eas.json");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: Json, label: string): { [key: string]: Json } {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function collectTracks(value: Json, tracks: { [key: string]: Json }[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTracks(item, tracks);
    return;
  }
  if (!isRecord(value)) return;
  if ("track" in value) tracks.push(value);
  for (const child of Object.values(value)) collectTracks(child, tracks);
}

function assertNoReviewRequest(value: Json, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoReviewRequest(item, `${label}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string") {
      expect({ label, value: value.toLowerCase() }).not.toEqual(
        expect.objectContaining({ value: expect.stringMatching(/review/) }),
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const here = `${label}.${key}`;
    if (/review/i.test(key)) {
      const requestsReview = key === "changesNotSentForReview" ? child !== true : child !== false;
      expect({ field: here, requestsReview }).toEqual({ field: here, requestsReview: false });
    }
    assertNoReviewRequest(child, here);
  }
}

test("eas.json keeps remote versions, the internal track, and no review request", () => {
  const raw = fs.readFileSync(easPath, "utf8");
  expect(raw).not.toContain("EXPO_PUBLIC_CONVEX_URL");
  expect(raw).not.toContain("EXPO_PUBLIC_SOCIAL_SIGN_IN");
  expect(raw).not.toContain("convex.cloud");

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("eas.json must be an object");
  }
  const eas = asRecord(parsed as Json, "eas.json");
  const cli = asRecord(eas.cli ?? null, "cli");
  expect(cli.appVersionSource).toBe("remote");

  const build = asRecord(eas.build ?? null, "build");
  expect(build.development).toBeDefined();
  expect(build.preview).toBeDefined();
  const production = asRecord(build.production ?? null, "build.production");
  expect(production.distribution).toBe("store");
  expect(production.autoIncrement).toBe(true);
  const androidBuild = asRecord(production.android ?? null, "build.production.android");
  expect(androidBuild.buildType).toBe("app-bundle");

  const submit = asRecord(eas.submit ?? null, "submit");
  const tracks: { [key: string]: Json }[] = [];
  collectTracks(submit, tracks);
  expect(tracks.length).toBeGreaterThan(0);
  for (const track of tracks) {
    expect(track.track).toBe("internal");
    expect(track.releaseStatus).toBe("draft");
    expect(track.changesNotSentForReview).toBe(true);
  }

  assertNoReviewRequest(submit, "submit");
  const productionSubmit = asRecord(submit.production ?? null, "submit.production");
  expect(productionSubmit.ios).toEqual({});
});

test("every build profile names the https site it signs in through (dcm-gdzi.41)", () => {
  const eas = asRecord(JSON.parse(fs.readFileSync(easPath, "utf8")) as Json, "eas.json");
  const build = asRecord(eas.build ?? null, "build");
  for (const profile of ["development", "preview", "production"]) {
    const env = asRecord(asRecord(build[profile] ?? null, profile).env ?? null, `${profile}.env`);
    expect({ profile, site: env.EXPO_PUBLIC_SITE_URL }).toEqual({ profile, site: expect.stringMatching(/^https:\/\/[^/]+$/) });
  }
});
