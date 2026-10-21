import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail } from "./allowlist";
import { canReadPage } from "../../src/lib/domain/notes/visibility";
import { departed } from "./journalState";

/**
 * The single authorization model (CF2). `permissionFor` decides every access:
 * the campaign wrappers in `lib/functions.ts` call it through `campaignAccess`,
 * and the entry- or character-scoped functions call it directly.
 */

export type Permission = Doc<"grants">["permission"];

/** A user's role in a campaign: its creator is the GM; members and invitees are players. */
export type Role = "gm" | "player";

/** Something a permission applies to, with the campaign it lives in. */
export type Resource =
  | { type: "campaign"; campaign: Doc<"campaigns"> }
  | { type: "map"; campaign: Doc<"campaigns"> }
  | { type: "codexEntry"; campaign: Doc<"campaigns">; entry: Doc<"codexEntries"> }
  | { type: "character"; campaign: Doc<"campaigns">; character: Doc<"characters"> }
  /**
   * D11: a journal page with its journal; decided by `journalPagePermission` alone (no role default, no grants).
   * `cache` (a query's `pageReadCache`) shares the caller's role, each journal's departure and the caller's ticks
   * between the pages of one list; the answer is the same with or without it.
   */
  | { type: "journalPage"; campaign: Doc<"campaigns">; journal: Doc<"journals">; page: Doc<"journalPages">; cache?: PageReadCache };

/** Resources that grants can name (journal pages cannot: their visibility is the rule, analysis 2). */
type GrantableResource = Exclude<Resource, { type: "journalPage" }>;

const RANK: Record<Permission, number> = { view: 1, edit: 2, owner: 3 };

/** Whether `permission` includes `need` (owner ⊃ edit ⊃ view). */
export function atLeast(permission: Permission | null, need: Permission): boolean {
  return permission !== null && RANK[permission] >= RANK[need];
}

function stronger(a: Permission | null, b: Permission | null): Permission | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * The normalized email an invite may match, or null. Password sign-ups never
 * verify their address, so only a verified email (Google, e2e) counts;
 * otherwise anyone could register an invited address and join.
 */
export function inviteEmail(user: Doc<"users">): string | null {
  return user.email && user.emailVerificationTime !== undefined ? normalizeEmail(user.email) : null;
}

/**
 * The role half of `permissionFor`: no read for the GM, then at most two point
 * reads (membership, then invite). Call `permissionFor`, which also counts
 * grants; this stays exported only for `campaigns.list`/`get` until they move
 * onto the wrappers.
 */
export async function campaignRole(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">): Promise<Role | null> {
  if (campaign.ownerId === user._id) return "gm";
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
    .unique();
  if (member !== null) return "player";
  const email = inviteEmail(user);
  if (email !== null) {
    const invite = await ctx.db
      .query("campaignInvites")
      .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaign._id).eq("email", email))
      .first();
    if (invite !== null) return "player";
  }
  return null;
}

/**
 * `campaignRole` for a user known only by id (a journal's owner, D1): no read for the GM, then the membership lookup,
 * and only for a non-member the users row and the invite lookup.
 */
export async function campaignRoleOf(ctx: QueryCtx, userId: Id<"users">, campaign: Doc<"campaigns">): Promise<Role | null> {
  if (campaign.ownerId === userId) return "gm";
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", userId))
    .unique();
  if (member !== null) return "player";
  const user = await ctx.db.get("users", userId);
  const email = user === null ? null : inviteEmail(user);
  if (email === null) return null;
  const invite = await ctx.db
    .query("campaignInvites")
    .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaign._id).eq("email", email))
    .first();
  return invite === null ? null : "player";
}

/**
 * Today's rules: the campaign's GM owns everything in it; a player (member or
 * invitee) views it and edits their own character.
 */
export function rolePermission(role: Role | null, resource: GrantableResource, userId: Id<"users">): Permission | null {
  if (role === "gm") return "owner";
  if (role === "player") return resource.type === "character" && resource.character.ownerId === userId ? "edit" : "view";
  return null;
}

function resourceId(resource: GrantableResource): string {
  if (resource.type === "codexEntry") return resource.entry._id;
  if (resource.type === "character") return resource.character._id;
  return resource.campaign._id;
}

/** Campaigns a user acts for, read from the user's side (owned and joined) when that side is at most this long. */
const PRINCIPALS_TAKE = 16;

/**
 * The live campaigns the user acts for (runs, or is a member of; `deletedAt` unset), or null when they run or joined
 * more than PRINCIPALS_TAKE: then the caller falls back to the target's grant range. Reads at most PRINCIPALS_TAKE + 1
 * rows of each index plus one campaign get per membership, however many grants exist.
 */
async function principalCampaigns(ctx: QueryCtx, user: Doc<"users">): Promise<Id<"campaigns">[] | null> {
  const owned = await ctx.db
    .query("campaigns")
    .withIndex("by_owner_deletedAt_lastOpened", (q) => q.eq("ownerId", user._id).eq("deletedAt", undefined))
    .take(PRINCIPALS_TAKE + 1);
  if (owned.length > PRINCIPALS_TAKE) return null;
  const memberships = await ctx.db
    .query("campaignMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(PRINCIPALS_TAKE + 1);
  if (memberships.length > PRINCIPALS_TAKE) return null;
  const joined = await Promise.all(memberships.map((m) => ctx.db.get("campaigns", m.campaignId)));
  const ids = new Set<Id<"campaigns">>(owned.map((c) => c._id));
  for (const campaign of joined) if (campaign !== null && campaign.deletedAt === undefined) ids.add(campaign._id);
  return [...ids];
}

/**
 * The strongest grant on `target` to a campaign the user acts for (exact up to `need`). One `first()` probe of the
 * target's grants to campaigns: none (the usual case) costs no document. Otherwise from the user's side
 * (`principals()`, `principalCampaigns`): one `by_resource_principal` point lookup per campaign they run or joined, so
 * the cost does not grow with the target's grants (PF10). Only for a user in more than PRINCIPALS_TAKE campaigns
 * (`principals()` null) does it walk the target's grants to campaigns, each checked with `actsFor`. Both give the same
 * answer.
 */
async function campaignGrant(
  ctx: QueryCtx,
  user: Doc<"users">,
  target: { type: GrantableResource["type"]; id: string },
  loadPrincipals: () => Promise<Id<"campaigns">[] | null>,
  best: Permission | null,
  need: Permission,
): Promise<Permission | null> {
  const anyGrant = await ctx.db
    .query("grants")
    .withIndex("by_resource_principal", (q) => q.eq("resourceType", target.type).eq("resourceId", target.id).eq("principalKind", "campaign"))
    .first();
  if (anyGrant === null) return best;
  const principals = await loadPrincipals();
  if (principals !== null) {
    const grants = await Promise.all(
      principals.map((principalId) =>
        ctx.db
          .query("grants")
          .withIndex("by_resource_principal", (q) =>
            q.eq("resourceType", target.type).eq("resourceId", target.id).eq("principalKind", "campaign").eq("principalId", principalId),
          )
          .unique(),
      ),
    );
    for (const grant of grants) best = stronger(best, grant?.permission ?? null);
    return best;
  }
  const toCampaigns = await ctx.db
    .query("grants")
    .withIndex("by_resource_principal", (q) => q.eq("resourceType", target.type).eq("resourceId", target.id).eq("principalKind", "campaign"))
    .collect();
  for (const grant of toCampaigns) {
    if (atLeast(best, grant.permission) || !(await actsFor(ctx, user, grant.principalId))) continue;
    best = grant.permission;
    if (atLeast(best, need)) return best;
  }
  return best;
}

/**
 * Whether the user acts for a campaign principal: they run it (and it is
 * live) or are a member of it. One or two point reads.
 */
async function actsFor(ctx: QueryCtx, user: Doc<"users">, principalId: string): Promise<boolean> {
  const campaignId = ctx.db.normalizeId("campaigns", principalId);
  if (campaignId === null) return false;
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) return false;
  if (campaign.ownerId === user._id) return true;
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId).eq("userId", user._id))
    .unique();
  return member !== null;
}

/**
 * The user's permission on a resource: the strongest of the role-derived one
 * (`rolePermission`) and any grant to the user, or to a campaign they run or
 * belong to, on the resource or on the campaign it lives in.
 *
 * The result is exact up to `need`: it returns as soon as `need` is reached,
 * so a GM costs no grant reads and a player asking for `view` only the
 * membership read. Otherwise, per target (the resource, then its campaign):
 * one `by_resource_principal` point lookup for a grant to the user, then
 * `campaignGrant` for grants to campaigns: a one-row probe, and only when the
 * target has such grants, one point lookup per campaign the user runs or
 * joined (read once per call, at most PRINCIPALS_TAKE of each), so a player's
 * check does not grow with the campaign's grants (PF10).
 */
export async function permissionFor(ctx: QueryCtx, user: Doc<"users">, resource: Resource, need: Permission = "owner"): Promise<Permission | null> {
  if (resource.type === "journalPage") return journalPagePermission(ctx, user, resource);
  let best = rolePermission(await campaignRole(ctx, user, resource.campaign), resource, user._id);
  if (atLeast(best, need)) return best;
  const targets: { type: GrantableResource["type"]; id: string }[] = [{ type: resource.type, id: resourceId(resource) }];
  if (resource.type !== "campaign") targets.push({ type: "campaign", id: resource.campaign._id });
  let principals: Promise<Id<"campaigns">[] | null> | undefined;
  const loadPrincipals = () => (principals ??= principalCampaigns(ctx, user));
  for (const target of targets) {
    const own = await ctx.db
      .query("grants")
      .withIndex("by_resource_principal", (q) =>
        q.eq("resourceType", target.type).eq("resourceId", target.id).eq("principalKind", "user").eq("principalId", user._id),
      )
      .unique();
    best = stronger(best, own?.permission ?? null);
    if (atLeast(best, need)) return best;
    best = await campaignGrant(ctx, user, target, loadPrincipals, best, need);
    if (atLeast(best, need)) return best;
  }
  return best;
}

// ---------------------------------------------------------------- journal pages

/** Pages that tick the caller, read in one range when there are at most this many (else one lookup per page). */
const TICKED_TAKE = 1_000;

/**
 * A per-query memo for checking many journal pages of one campaign for one caller (PF10): the caller's role, each
 * journal (and its departure, D1) and the pages that tick the caller are read once instead of once per page. Queries
 * only: a mutation may change a membership, a character or a recipient between two checks, so mutations never pass
 * one. Keyed to its user and campaign; the helpers ignore it for any other.
 */
export type PageReadCache = {
  userId: Id<"users">;
  campaignId: Id<"campaigns">;
  role?: Promise<Role | null>;
  departed: Map<Id<"journals">, Promise<boolean>>;
  journals: Map<Id<"journals">, Promise<Doc<"journals"> | null>>;
  /** The pages that tick the caller, or null when there are more than TICKED_TAKE (then each page is looked up). */
  ticked?: Promise<Set<Id<"journalPages">> | null>;
};

/** A new, empty `PageReadCache` for the caller in one campaign. */
export function pageReadCache(user: Doc<"users">, campaign: Doc<"campaigns">): PageReadCache {
  return { userId: user._id, campaignId: campaign._id, departed: new Map(), journals: new Map() };
}

function usable(cache: PageReadCache | undefined, user: Doc<"users">, campaign: Doc<"campaigns">): PageReadCache | undefined {
  return cache !== undefined && cache.userId === user._id && cache.campaignId === campaign._id ? cache : undefined;
}

/** `campaignRole`, read once per cache. */
export function cachedRole(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">, cache?: PageReadCache): Promise<Role | null> {
  const c = usable(cache, user, campaign);
  if (c === undefined) return campaignRole(ctx, user, campaign);
  c.role ??= campaignRole(ctx, user, campaign);
  return c.role;
}

/** `departed` (D1), read once per journal per cache. */
export function cachedDeparted(ctx: QueryCtx, campaign: Doc<"campaigns">, journal: Doc<"journals">, cache?: PageReadCache): Promise<boolean> {
  if (cache === undefined || cache.campaignId !== campaign._id) return departed(ctx, campaign, journal);
  let known = cache.departed.get(journal._id);
  if (known === undefined) {
    known = departed(ctx, campaign, journal);
    cache.departed.set(journal._id, known);
  }
  return known;
}

/** A journal by id, read once per cache. */
export function cachedJournal(ctx: QueryCtx, journalId: Id<"journals">, cache?: PageReadCache): Promise<Doc<"journals"> | null> {
  if (cache === undefined) return ctx.db.get("journals", journalId);
  let known = cache.journals.get(journalId);
  if (known === undefined) {
    known = ctx.db.get("journals", journalId);
    cache.journals.set(journalId, known);
  }
  return known;
}

/** Whether the page ticks the caller: the caller's recipient rows in the campaign read once per cache, else a point lookup. */
async function ticks(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">, page: Doc<"journalPages">, cache?: PageReadCache): Promise<boolean> {
  const c = usable(cache, user, campaign);
  if (c !== undefined) {
    c.ticked ??= ctx.db
      .query("journalPageRecipients")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
      .take(TICKED_TAKE + 1)
      .then((rows) => (rows.length > TICKED_TAKE ? null : new Set(rows.map((r) => r.pageId))));
    const ticked = await c.ticked;
    // A recipient row carries its page's campaign (addRecipient writes both), so these rows hold every tick.
    if (ticked !== null) return ticked.has(page._id);
  }
  const row = await ctx.db
    .query("journalPageRecipients")
    .withIndex("by_page_user", (q) => q.eq("pageId", page._id).eq("userId", user._id))
    .unique();
  return row !== null;
}

/**
 * A journal page (D11): `owner` for the page's owner, `view` for a reader, else null. Readers besides the owner
 * (analysis 3.1; A3, A4, A5, Q2, Q4, D4):
 *
 * | visibility | journal present                         | journal departed (D1, Q12) |
 * |------------|-----------------------------------------|----------------------------|
 * | `gm`       | the GM                                  | every member               |
 * | `private`  | nobody                                  | nobody                     |
 * | `players`  | the other players, not the GM           | every member               |
 * | `everyone` | every member                            | every member               |
 * | `chosen`   | its recipients (the GM only if ticked)  | every member               |
 *
 * The GM is never owner of a player's page (unlike `rolePermission`), and grants do not apply. Someone without a
 * campaign role (removed, left, an outsider) reads nothing, not even their own pages. A torn-out page (Q11) is
 * readable only by its owner, and by the GM who tore it out (a departed journal's page, D2) while that GM would still
 * read it if it were not torn out. A page of another
 * campaign, or one whose journal does not match, is null. `need` does not shorten it: the result is always exact.
 * Cost: the caller's role (GM: none; player: one or two reads), then at most `departed` (two to four reads) and one
 * `by_page_user` point lookup. With a `pageReadCache`, the role, each journal's departure and the caller's ticks are
 * read once per list.
 */
async function journalPagePermission(
  ctx: QueryCtx,
  user: Doc<"users">,
  { campaign, journal, page, cache }: Extract<Resource, { type: "journalPage" }>,
): Promise<Permission | null> {
  if (page.campaignId !== campaign._id || journal.campaignId !== campaign._id || page.journalId !== journal._id) return null;
  const role = await cachedRole(ctx, user, campaign, cache);
  if (role === null) return null;
  const isOwner = page.ownerId === user._id;
  if (page.binnedAt !== undefined) {
    if (isOwner) return "owner";
    // Q11, N1 actions.canRestore: the GM who tore it out, while they could still read it if it were not torn out.
    if (role !== "gm" || page.binnedBy !== user._id) return null;
  } else if (isOwner) return "owner";
  return (await readsJournalPage(ctx, user, role, campaign, journal, page, cache)) ? "view" : null;
}

/**
 * Whether a member who does not own the page reads it by the visibility table, ignoring the bin: N1's `canReadPage`
 * (src/lib/domain/notes/visibility.ts, the one copy of the table) fed with departure (D1) and the caller's recipient
 * row. A private page costs no read.
 */
async function readsJournalPage(
  ctx: QueryCtx,
  user: Doc<"users">,
  role: Role,
  campaign: Doc<"campaigns">,
  journal: Doc<"journals">,
  page: Doc<"journalPages">,
  cache?: PageReadCache,
): Promise<boolean> {
  if (page.visibility === "private") return false;
  const ownerIsGm = journal.userId === campaign.ownerId;
  const isDeparted = !ownerIsGm && (await cachedDeparted(ctx, campaign, journal, cache));
  const isRecipient = !isDeparted && page.visibility === "chosen" && (await ticks(ctx, user, campaign, page, cache));
  return canReadPage({ visibility: page.visibility, ownerIsGm, departed: isDeparted, viewer: role, isRecipient });
}

/**
 * A live campaign and the user's permission on it (exact up to `enough`), or
 * null when it is missing, deleted, or the user has no access at all. The
 * campaign wrappers throw on null; `maybeUserQuery` handlers return null.
 */
export async function campaignAccess(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaignId: Id<"campaigns">,
  enough: Permission = "view",
): Promise<{ campaign: Doc<"campaigns">; permission: Permission } | null> {
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) return null;
  const permission = await permissionFor(ctx, user, { type: "campaign", campaign }, enough);
  return permission === null ? null : { campaign, permission };
}

/**
 * `permissionFor`, requiring `need`: NOT_FOUND without any access (never
 * revealing the resource), FORBIDDEN when too weak. The result is exact up to
 * `enough` (pass "edit" when the caller also tells view from edit).
 */
export async function requirePermission(ctx: QueryCtx, user: Doc<"users">, resource: Resource, need: Permission, enough: Permission = need): Promise<Permission> {
  const permission = await permissionFor(ctx, user, resource, enough);
  if (permission === null) throw appError("NOT_FOUND");
  if (!atLeast(permission, need)) throw appError("FORBIDDEN");
  return permission;
}

/** A live (not deleted) campaign, or NOT_FOUND. Access is checked separately (`requirePermission`). */
export async function liveCampaign(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"campaigns">> {
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) throw appError("NOT_FOUND");
  return campaign;
}

/** Sets a principal's permission on a resource: one row per (resource, principal); a new grant replaces the old one. */
export async function upsertGrant(
  ctx: MutationCtx,
  grant: Pick<Doc<"grants">, "resourceType" | "resourceId" | "principalKind" | "principalId" | "permission" | "createdBy">,
): Promise<Id<"grants">> {
  const existing = await ctx.db
    .query("grants")
    .withIndex("by_resource_principal", (q) =>
      q.eq("resourceType", grant.resourceType).eq("resourceId", grant.resourceId).eq("principalKind", grant.principalKind).eq("principalId", grant.principalId),
    )
    .unique();
  if (existing) {
    await ctx.db.patch("grants", existing._id, { permission: grant.permission, createdBy: grant.createdBy, createdAt: Date.now() });
    return existing._id;
  }
  return ctx.db.insert("grants", { ...grant, createdAt: Date.now() });
}
