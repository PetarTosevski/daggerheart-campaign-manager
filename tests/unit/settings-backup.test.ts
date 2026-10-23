import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  NEWER_BACKUP,
  NOT_A_BACKUP,
  parseSettingsBackup,
  readSettingsBackup,
  settingsBackupText,
} from "@/lib/validation/settings-backup";

const settings = { tableName: "Thursday Crew", gmName: "Ana", accent: "#8f78d8", expansions: { hopeAndFear: false } };
const backup = (inner: Record<string, unknown>, envelope: Record<string, unknown> = {}) =>
  JSON.stringify({ daggerheartBackup: 2, kind: "settings", schemaVersion: 1, settings: inner, ...envelope });

describe("settings backup text (H17)", () => {
  it("has the versioned shape { daggerheartBackup: 2, kind, schemaVersion: 1, settings }", () => {
    expect(JSON.parse(settingsBackupText(settings))).toEqual({
      daggerheartBackup: 2,
      kind: "settings",
      schemaVersion: 1,
      settings,
    });
  });

  it("round-trips, with and without the expansion default", () => {
    expect(parseSettingsBackup(settingsBackupText(settings))).toEqual(settings);
    const unset = { ...settings, expansions: {} };
    expect(parseSettingsBackup(settingsBackupText(unset))).toEqual(unset);
  });

  it("carries the default map style when set, and still reads a backup without it (dcm-bxp.89, widened v1; absent = Sprites, dcm-bxp.135)", () => {
    const sprites = { ...settings, defaultMapStyle: "sprites" as const };
    expect(JSON.parse(settingsBackupText(sprites)).settings.defaultMapStyle).toBe("sprites");
    expect(parseSettingsBackup(settingsBackupText(sprites))).toEqual(sprites);
    expect(parseSettingsBackup(backup(settings)).defaultMapStyle).toBeUndefined();
    expect(readSettingsBackup(backup({ ...settings, defaultMapStyle: "pixel" }))).toEqual({ ok: false, message: NOT_A_BACKUP });
  });

  it("trims names like the settings form", () => {
    expect(parseSettingsBackup(backup({ ...settings, tableName: "  Crew  " })).tableName).toBe("Crew");
  });

  it.each([
    ["empty text", ""],
    ["not JSON", "{ nope"],
    ["JSON that is not an object", "42"],
    ["the board's browser backup", JSON.stringify({ daggerheartBackup: 1, at: "x", data: { "dh.settings": "{}" } })],
    ["another kind", backup(settings, { kind: "campaign" })],
    ["no schemaVersion", JSON.stringify({ daggerheartBackup: 2, kind: "settings", settings })],
    ["an unknown top-level field", backup(settings, { at: "2026-10-21" })],
    ["an unknown settings field", backup({ ...settings, theme: "dark" })],
    ["an unknown expansion", backup({ ...settings, expansions: { other: true } })],
    ["an accent outside the palette", backup({ ...settings, accent: "red" })],
    ["a missing field", backup({ tableName: "T", accent: "#e3b45a", expansions: {} })],
    ["a name over 80 characters", backup({ ...settings, gmName: "x".repeat(81) })],
    ["an oversized paste", " ".repeat(5000)],
  ])("refuses %s as not a backup (ZodError)", (_label, text) => {
    expect(() => parseSettingsBackup(text)).toThrow(ZodError);
    expect(readSettingsBackup(text)).toEqual({ ok: false, message: NOT_A_BACKUP });
  });

  it("refuses a schemaVersion it does not know as a newer backup", () => {
    expect(readSettingsBackup(backup(settings, { schemaVersion: 2 }))).toEqual({ ok: false, message: NEWER_BACKUP });
  });
});
