import type { z } from "zod";

import { appError, type AppErrorCode } from "../../src/lib/errors/app-error";

/** The error codes a blob reader may throw. */
export type CorruptCode = Extract<AppErrorCode, `${string}_CORRUPT`>;

/**
 * Parses a stored JSON blob, throwing `ConvexError {code}` when it does not
 * match (CD2). The only way to read a blob that is not yet a typed validator:
 * never `row.data as T` and never a bare `.parse()`.
 */
export function parseOrCorrupt<S extends z.ZodType>(schema: S, raw: unknown, code: CorruptCode): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw appError(code);
  return parsed.data;
}

/** One version of a blob: its schema and, for every version but the latest, how to upgrade it to the next. */
type VersionStep<S extends z.ZodType> = { schema: S; upgrade?: (data: z.output<S>) => unknown };
type AnyStep = { schema: z.ZodType; upgrade?: (data: never) => unknown };
type SchemaOf<T> = T extends { schema: infer S extends z.ZodType } ? S : never;

/** The output of the latest version (the one step without `upgrade`). */
type Latest<V> = {
  [K in keyof V]: V[K] extends { upgrade: (data: never) => unknown } ? never : V[K] extends VersionStep<infer S> ? z.output<S> : never;
}[keyof V];

/**
 * Reads a versioned blob (CD3). Dispatches on `raw.schemaVersion` (a blob
 * written before versioning has none and counts as version 1), parses it with
 * that version's schema, then applies each `upgrade` up to the latest version,
 * re-checking every step's output with the next schema. Throws `code` for an
 * unknown version or a blob that fails any check.
 *
 * ```ts
 * const map = readVersioned(
 *   {
 *     1: { schema: mapV1, upgrade: (old) => ({ ...old, fog: [] }) },
 *     2: { schema: mapV2 },
 *   },
 *   row.data,
 *   "MAP_CORRUPT",
 * );
 * ```
 */
export function readVersioned<V extends { [K in keyof V]: VersionStep<SchemaOf<V[K]>> }>(
  schemaByVersion: V & Record<number, AnyStep>,
  raw: unknown,
  code: CorruptCode,
): Latest<V> {
  const steps = schemaByVersion as Record<number, VersionStep<z.ZodType>>;
  const latest = Math.max(...Object.keys(steps).map(Number));
  const stored = typeof raw === "object" && raw !== null ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  let version = stored === undefined ? 1 : stored;
  if (typeof version !== "number" || !Number.isInteger(version) || !(version in steps) || version > latest) throw appError(code);
  let data = parseOrCorrupt(steps[version].schema, raw, code);
  while (version < latest) {
    const { upgrade } = steps[version];
    const next = steps[version + 1];
    if (upgrade === undefined || next === undefined) throw new Error(`readVersioned: no upgrade path from version ${version}`);
    version++;
    data = parseOrCorrupt(next.schema, upgrade(data), code);
  }
  return data as Latest<V>;
}
