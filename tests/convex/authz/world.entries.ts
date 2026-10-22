import { api } from "../../../convex/_generated/api";
import type { Id, TableNames } from "../../../convex/_generated/dataModel";
import type { Area, Entry, Outcome, Role, World } from "./harness";

/**
 * Authz matrix: world (maps, codex, scenes). Filled by tracer H9 (.omc/plans/d12-hardening.yaml).
 *
 * Every map function goes through `mapAccess` (permission on the `map` resource) and every entry-scoped codex
 * function through `findEntry` (permission on the `codexEntry` resource); both fall back to the campaign's grants, so
 * the grantee (edit on the campaign) acts as the GM. The players' view of hidden data (secret codex entries, hidden
 * markers) is covered here where an outcome can state it (`entryText` → null, `locations` → empty) and in
 * world.test.ts for the views that return a filtered object (`codex.list`, `maps.get`).
 *
 * Upload-URL mutations are covered for access only: no blob goes through an upload URL. The attach functions get a
 * file stored directly in the entry's setup (convex-test files carry no content type, so the GM's attach resolves
 * with a rejection message, which still proves access).
 */

/** GM-level map or codex change: the grantee's campaign edit grant reaches the map and the entries. */
const GM_CHANGE: Partial<Record<Role, Outcome>> = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", grantee: "ok", gm: "ok" };
/** Map reads: every member reads the map (players get the filtered view). */
const MEMBER_READ: Partial<Record<Role, Outcome>> = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "ok", player: "ok", grantee: "ok", gm: "ok" };

const HORIZON = { frameId: "journey-to-horizon" } as const;

/** The first seeded codex entry (every seeded entry starts secret), registered as `entryId`. */
async function firstEntry(w: World): Promise<Id<"codexEntries">> {
  const entryId = (await w.idOf("codexEntries")) as Id<"codexEntries">;
  w.set("entryId", entryId);
  return entryId;
}

/** A file stored directly (no upload URL), unclaimed: the `_storage` row synthesis uses (system tables cannot be scanned). */
async function storedFile(w: World) {
  const storageId = await w.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
  // `use` is typed for user tables; synthesis looks the chosen id up before touching the table.
  w.use("_storage" as TableNames, storageId);
}

/** An image on the first entry, recorded the way `attachImage` records it; registered as `storageId`. */
async function entryImage(w: World) {
  const entryId = await firstEntry(w);
  const gm = w.users.gm;
  const storageId = await w.t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob(["img"], { type: "image/jpeg" }));
    const entry = (await ctx.db.get(entryId))!;
    await ctx.db.insert("files", { storageId: id, campaignId: entry.campaignId, uploadedBy: gm, kind: "codexImage", refId: entryId, createdAt: 0 });
    const data = entry.data as { images: { storageId: string; shown: boolean }[]; cover: string | null };
    await ctx.db.patch(entryId, { data: { ...data, images: [...data.images, { storageId: id, shown: false }], cover: data.cover ?? id } });
    return id;
  });
  w.set("storageId", storageId);
}

/** A marker (id 1) on the map, as a row of the split map. */
async function marker(w: World, over: { hidden?: boolean; location?: boolean } = {}) {
  const campaignId = w.campaignId;
  await w.t.run((ctx) =>
    ctx.db.insert("mapTokens", { campaignId, tokenId: 1, type: "village", x: 50, y: 50, name: "Pin", notes: "", hidden: false, location: false, ...over }),
  );
}

/** The party on hex (0, 0) of a Journey to Horizon crawl. */
async function partyOnHex(w: World) {
  await w.as("gm").mutation(api.maps.placePartyHex, { campaignId: w.campaignId, q: 0, r: 0 });
}

const codex: Entry[] = [
  // The GM's codex for edit and owner, the players' codex (known entries only) for view; world.test.ts checks content.
  { fn: api.codex.list, access: "scoped", expect: MEMBER_READ },
  // A secret entry: a player gets null (never the text); a stranger gets null too (no existence leak).
  {
    fn: api.codex.entryText,
    access: "scoped",
    setup: async (w) => void (await firstEntry(w)),
    expect: { anon: "UNAUTHENTICATED", outsider: "null", otherPlayer: "null", player: "null", grantee: "ok", gm: "ok" },
  },
  { fn: api.codex.create, access: "edit" },
  { fn: api.codex.seed, access: "edit" },
  { fn: api.codex.importPins, access: "edit" },
  { fn: api.codex.update, access: "scoped", args: () => ({ patch: { name: "Renamed" } }), expect: GM_CHANGE },
  { fn: api.codex.setPin, access: "scoped", args: () => ({ tokenId: null }), expect: GM_CHANGE },
  { fn: api.codex.remove, access: "scoped", expect: GM_CHANGE },
  { fn: api.codex.imageUploadUrl, access: "scoped", expect: GM_CHANGE },
  { fn: api.codex.attachImage, access: "scoped", setup: storedFile, expect: GM_CHANGE },
  { fn: api.codex.setImageShown, access: "scoped", setup: entryImage, args: (w) => ({ storageId: w.ids.storageId, shown: true }), expect: GM_CHANGE },
  { fn: api.codex.setCover, access: "scoped", setup: entryImage, args: (w) => ({ storageId: w.ids.storageId }), expect: GM_CHANGE },
  { fn: api.codex.removeImage, access: "scoped", setup: entryImage, args: (w) => ({ storageId: w.ids.storageId }), expect: GM_CHANGE },
];

const maps: Entry[] = [
  { fn: api.maps.get, access: "scoped", expect: MEMBER_READ },
  // A hidden location marker: players never get it, so their list is empty; the GM's is not.
  {
    fn: api.maps.locations,
    access: "scoped",
    setup: (w) => marker(w, { hidden: true, location: true }),
    expect: { ...MEMBER_READ, otherPlayer: "empty", player: "empty" },
  },
  { fn: api.maps.addToken, access: "scoped", args: () => ({ type: "village", x: 50, y: 50 }), expect: GM_CHANGE },
  { fn: api.maps.updateToken, access: "scoped", setup: (w) => marker(w), args: () => ({ id: 1, patch: { name: "Renamed" } }), expect: GM_CHANGE },
  { fn: api.maps.removeToken, access: "scoped", setup: (w) => marker(w), args: () => ({ id: 1 }), expect: GM_CHANGE },
  { fn: api.maps.moveParty, access: "scoped", args: () => ({ x: 40, y: 40 }), expect: GM_CHANGE },
  { fn: api.maps.clearTrail, access: "scoped", expect: GM_CHANGE },
  { fn: api.maps.paintCells, access: "scoped", args: () => ({ indexes: [], codes: "" }), expect: GM_CHANGE },
  { fn: api.maps.setTerrain, access: "scoped", args: () => ({ reset: true }), expect: GM_CHANGE },
  { fn: api.maps.setOptions, access: "scoped", args: () => ({ scaleKm: 100 }), expect: GM_CHANGE },
  { fn: api.maps.setTravelRules, access: "scoped", args: () => ({ rules: null }), expect: GM_CHANGE },
  { fn: api.maps.addCustomType, access: "scoped", args: () => ({ label: "Camp", icon: "village", color: "#aabbcc" }), expect: GM_CHANGE },
  { fn: api.maps.renameType, access: "scoped", args: () => ({ typeId: "village", label: "Hamlet" }), expect: GM_CHANGE },
  { fn: api.maps.mapImageUploadUrl, access: "scoped", expect: GM_CHANGE },
  {
    fn: api.maps.attachMapImage,
    access: "scoped",
    setup: storedFile,
    args: () => ({ width: 10, height: 10 }),
    expect: GM_CHANGE,
  },
  { fn: api.maps.removeMapImage, access: "scoped", expect: GM_CHANGE },
  // Journey to Horizon hex crawl (other frames answer MECHANIC_DISABLED after the access check).
  {
    fn: api.maps.setHexGrid,
    access: "scoped",
    world: HORIZON,
    args: () => ({ grid: { originX: 0, originY: 0, size: 40, orientation: "flat" } }),
    expect: GM_CHANGE,
  },
  { fn: api.maps.updateHex, access: "scoped", world: HORIZON, args: () => ({ q: 0, r: 0, patch: { explored: true } }), expect: GM_CHANGE },
  // Filed `own` by the analysis, but it is a GM map change like the rest of the crawl (gmCrawl).
  { fn: api.maps.placePartyHex, access: "scoped", world: HORIZON, args: () => ({ q: 0, r: 0 }), expect: GM_CHANGE },
  {
    fn: api.maps.moveToHex,
    access: "scoped",
    world: HORIZON,
    setup: partyOnHex,
    args: () => ({ q: 1, r: 0, terrain: 1, travelMode: "land" }),
    expect: GM_CHANGE,
  },
  { fn: api.maps.setCrawlDay, access: "scoped", world: HORIZON, args: () => ({ day: 3 }), expect: GM_CHANGE },
];

const area: Area = {
  area: "world",
  // codex.setPin's `tokenId` is a world-map marker number, not a combat token.
  nameHints: { tokenId: () => null },
  entries: [...codex, ...maps, { fn: api.scenes.end, access: "gm" }],
};

export default area;
