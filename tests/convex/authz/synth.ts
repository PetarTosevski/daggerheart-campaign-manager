/**
 * Valid arguments for any public function, built from its own args validator (`fn.exportArgs()`, which every
 * registered function has, wrappers included), so most matrix entries need no hand-written arguments (analysis 2.4).
 *
 * - `v.id(table)` → `w.idOf(table)` (the row `w.use` picked, else the table's first document);
 * - fields named in NAME_HINTS (`v.string()` ids such as `characterId`, `mapId`, `sessionId`; `paginationOpts`) → that
 *   table's id, or what the hint's resolver returns (ids inside blobs, such as a pyre or a hunt; the first page);
 * - `idempotencyKey` → a fresh key; literal → its value; union → its first member; number → 0; int64 → 0n;
 *   boolean → false; other strings → "x"; array → []; object → its required fields; optional → omitted; record → {}.
 *
 * Entries override only what matters; an area extends the hints through its own `nameHints`.
 */
import type { TableNames } from "../../../convex/_generated/dataModel";
import type { World } from "./world";

/** A table name, or a resolver for ids that are not documents (or need a specific row). */
export type NameHint = TableNames | ((w: World) => unknown);
export type NameHints = Record<string, NameHint>;

/** Arguments by field name: `v.string()` ids (normalized by the handler) and pagination. Never applied to a `v.id`. */
export const NAME_HINTS: NameHints = {
  campaignId: "campaigns",
  characterId: "characters",
  fromCharacterId: "characters",
  userId: "users",
  mapId: "combatMaps",
  tokenId: "combatTokens",
  objectId: "combatMapObjects",
  packId: "spritePacks",
  spriteId: "spritePackSprites",
  sessionId: "sessions",
  logId: "sessionLog",
  encounterId: "encounters",
  instanceId: "encounterAdversaries",
  customId: "customAdversaries",
  pageId: "journalPages",
  journalId: "journals",
  // paginationOpts: the first page.
  cursor: () => null,
  numItems: () => 10,
};

type Field = { fieldType: Validator; optional: boolean };
type Validator =
  | { type: "id"; tableName: TableNames }
  | { type: "string" | "number" | "float64" | "int64" | "bigint" | "boolean" | "null" | "any" | "bytes" }
  | { type: "literal"; value: unknown }
  | { type: "array"; value: Validator }
  | { type: "object"; value: Record<string, Field> }
  | { type: "record"; keys: Validator; values: Field }
  | { type: "union"; value: Validator[] };

let keys = 0;
/** A key no other call in this process has used. */
export const freshKey = () => `authz-${++keys}`;

async function valueFor(validator: Validator, w: World, hints: NameHints, field: string | null): Promise<unknown> {
  // A typed id names its own table; a hint applies to every other field of that name, at any depth.
  const hint = field === null || validator.type === "id" ? undefined : hints[field];
  if (hint !== undefined) return typeof hint === "function" ? hint(w) : w.idOf(hint);
  switch (validator.type) {
    case "id":
      return w.idOf(validator.tableName);
    case "string":
      return field === "idempotencyKey" ? freshKey() : "x";
    case "number":
    case "float64":
      return 0;
    case "int64":
    case "bigint":
      return BigInt(0);
    case "boolean":
      return false;
    case "null":
    case "any":
      return null;
    case "bytes":
      return new ArrayBuffer(0);
    case "literal":
      return validator.value;
    case "array":
      return [];
    case "record":
      return {};
    case "union":
      return valueFor(validator.value[0]!, w, hints, field);
    case "object":
      return objectFor(validator.value, w, hints);
  }
}

async function objectFor(fields: Record<string, Field>, w: World, hints: NameHints): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field.optional) continue;
    out[name] = await valueFor(field.fieldType, w, hints, name);
  }
  return out;
}

/**
 * Arguments that pass `exportArgs` (the JSON from `fn.exportArgs()`, or its parsed form) in world `w`. `hints` replace
 * NAME_HINTS (pass `{ ...NAME_HINTS, ...more }` to extend them).
 */
export async function synthArgs(exportArgs: string | object, w: World, hints: NameHints = NAME_HINTS): Promise<Record<string, unknown>> {
  const json = (typeof exportArgs === "string" ? JSON.parse(exportArgs) : exportArgs) as Validator;
  if (json.type !== "object") throw new Error(`Expected an object args validator, got ${json.type}.`);
  return objectFor(json.value, w, hints);
}
