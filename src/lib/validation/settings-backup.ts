import { z } from "zod";

import { settingsSchema } from "./campaigns";

/**
 * Settings backup (TitleMenu "Saved data", D12 H17). Campaigns live in Convex and sync through the account, so the
 * backup covers only the user's app settings, as copy-and-paste text:
 * `{ daggerheartBackup: 2, kind: "settings", schemaVersion: 1, settings }`.
 *
 * `daggerheartBackup: 2` tells it apart from the board's browser-storage backup (format 1). `schemaVersion` versions the
 * `settings` shape (rule 7 / CD3): the reader dispatches on it, and a version it does not know is refused. Every object
 * is strict, so an unknown field is refused too. Parsing throws a `ZodError`, which the Convex wrappers turn into
 * `{ code: "INVALID", message }`.
 */
const BACKUP_FORMAT = 2;
const SETTINGS_BACKUP_VERSION = 1;
/** Far above any real backup (two names of at most 80 characters); stops a huge paste before JSON.parse. */
const SETTINGS_BACKUP_MAX_LENGTH = 4000;

export const NOT_A_BACKUP =
  "That doesn’t look like a settings backup. Paste the full text you copied from “Show backup”.";
export const NEWER_BACKUP = "That backup comes from a newer version of the app. Update the app and try again.";

const backupSettingsV1 = settingsSchema
  .extend({ expansions: z.object({ hopeAndFear: z.boolean().optional() }).strict() })
  .strict();

type BackupSettings = z.infer<typeof backupSettingsV1>;

const envelope = z.object({
  daggerheartBackup: z.literal(BACKUP_FORMAT),
  kind: z.literal("settings"),
  schemaVersion: z.number().int().positive(),
});

const backupV1 = envelope
  .extend({ schemaVersion: z.literal(SETTINGS_BACKUP_VERSION), settings: backupSettingsV1 })
  .strict();

const json = z
  .string()
  .max(SETTINGS_BACKUP_MAX_LENGTH, NOT_A_BACKUP)
  .transform((text, ctx): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: NOT_A_BACKUP });
      return z.NEVER;
    }
  });

/** Pasted text → settings. Throws a `ZodError` whose first message is one of the two above. */
export function parseSettingsBackup(text: string): BackupSettings {
  const value = json.parse(text);
  const head = envelope.safeParse(value);
  if (!head.success) throw new z.ZodError([{ code: "custom", path: [], message: NOT_A_BACKUP, input: value }]);
  switch (head.data.schemaVersion) {
    case 1: {
      const v1 = backupV1.safeParse(value);
      if (!v1.success) throw new z.ZodError([{ code: "custom", path: [], message: NOT_A_BACKUP, input: value }]);
      return v1.data.settings;
    }
    default:
      throw new z.ZodError([{ code: "custom", path: ["schemaVersion"], message: NEWER_BACKUP, input: value }]);
  }
}

/** A safe-parse for the dialog: the settings, or the message to show. */
export function readSettingsBackup(text: string): { ok: true; settings: BackupSettings } | { ok: false; message: string } {
  try {
    return { ok: true, settings: parseSettingsBackup(text) };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? NOT_A_BACKUP };
    throw error;
  }
}

/** What `settings.get` returns. */
export type SettingsView = {
  tableName: string;
  gmName: string;
  accent: string;
  expansions: { hopeAndFear?: boolean };
};

/** The text "Show backup" puts in the textarea. */
export function settingsBackupText(settings: SettingsView): string {
  const { tableName, gmName, accent, expansions } = settings;
  return JSON.stringify({
    daggerheartBackup: BACKUP_FORMAT,
    kind: "settings",
    schemaVersion: SETTINGS_BACKUP_VERSION,
    settings: {
      tableName,
      gmName,
      accent,
      expansions: expansions.hopeAndFear === undefined ? {} : { hopeAndFear: expansions.hopeAndFear },
    },
  });
}
