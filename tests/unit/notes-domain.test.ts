import { describe, expect, it } from "vitest";

import {
  activeMentionQuery,
  addPlaceholder,
  allowedVisibilities,
  authorLabel,
  authorSuffix,
  BIN_DAYS,
  binCutoff,
  binDaysLeft,
  BULLETS,
  bulletTip,
  canAdd,
  canArrangeEntry,
  canBin,
  canCycle,
  canDeleteEntry,
  canEditEntry,
  canEditPage,
  canReadPage,
  canRestore,
  clampTitle,
  countMentions,
  daysLeftLabel,
  defaultPages,
  defaultVisibility,
  effectiveReaders,
  emptyLine,
  ENTRY_KINDS,
  ENTRY_STATES,
  entryActions,
  entryToMarkdown,
  formatToken,
  GM_DEFAULT_PAGES,
  glyphFor,
  groupEmptyText,
  headerLine,
  insertMention,
  isAddedEntry,
  isAllowedVisibility,
  isDimmed,
  isOpenThread,
  isStruck,
  isValidEntryText,
  isValidTitle,
  journalTitle,
  journalToMarkdown,
  journalWho,
  KEY_LEGEND,
  matches,
  mentionIds,
  migrationTarget,
  migrationTip,
  newContinuationTitle,
  newPageTape,
  newPageTitle,
  nextState,
  nextTape,
  NOTE_LIMITS,
  openTasks,
  openThreads,
  PAGE_GROUPS,
  pageActions,
  pageCountLabel,
  pageMatches,
  pageMeta,
  parseQuickKey,
  parseTokens,
  pastJournalTitle,
  planMigration,
  PLAYER_DEFAULT_PAGES,
  QUICK_KEYS,
  QUICK_KEYS_COPY,
  renderParts,
  sanitizeMentionName,
  sessionLogTitle,
  subLine,
  TAPES,
  tapeBackground,
  tearLabel,
  THREADS_COPY,
  THREADS_TAPE,
  threadPageLink,
  threadsButtonLabel,
  toPlainText,
  UNDO_MS,
  VISIBILITIES,
  visibilityLabel,
  withinMentionLimit,
  type EntryKind,
  type EntryState,
  type PageActionInput,
  type PageKind,
  type Visibility,
} from "@/lib/domain/notes";

const DAY = 24 * 60 * 60 * 1000;

describe("bullets (B4, B5, Q7)", () => {
  it("has the six kinds with the board's glyphs, colours, labels and tooltips", () => {
    expect(ENTRY_KINDS).toEqual(["task", "event", "note", "idea", "hope", "fear"]);
    expect(ENTRY_KINDS.map((k) => BULLETS[k].glyph)).toEqual(["•", "○", "–", "!", "✦", "☠"]);
    expect(ENTRY_KINDS.map((k) => BULLETS[k].label)).toEqual(["Task", "Event", "Note", "Idea", "Hope", "Fear"]);
    expect(BULLETS.task.tip).toBe("Something to do. Click its bullet to complete, migrate or schedule it.");
    expect(BULLETS.event.tip).toBe("Something that happened or will happen.");
    expect(BULLETS.note.tip).toBe("A fact, quote or observation.");
    expect(BULLETS.idea.tip).toBe("Inspiration for later.");
    expect(BULLETS.hope.tip).toBe("A boon, ally or lucky break for the party.");
    expect(BULLETS.fear.tip).toBe("A threat brewing against the party. Counts as an open thread.");
    expect(BULLETS.idea.color).toBe("#8e2b2b");
    expect(BULLETS.hope.color).toBe("#9a6b10");
    expect(BULLETS.fear.color).toBe("#6b3fae");
    expect(BULLETS.hope.glow).toBeDefined();
    expect(BULLETS.fear.textColor).toBe("#4a2a7a");
    expect(BULLETS.task.glow).toBeUndefined();
  });

  it("runs the full task cycle open -> done -> migrated -> scheduled -> struck -> open", () => {
    const seen: EntryState[] = [];
    let s: EntryState = "open";
    for (let i = 0; i < 5; i++) {
      s = nextState("task", s);
      seen.push(s);
    }
    expect(seen).toEqual(["done", "migrated", "scheduled", "struck", "open"]);
  });

  it("toggles every other kind between open and done", () => {
    for (const k of ENTRY_KINDS.filter((k) => k !== "task")) {
      expect(nextState(k, "open")).toBe("done");
      expect(nextState(k, "done")).toBe("open");
      expect(nextState(k, "migrated")).toBe("open");
    }
  });

  it("shows a task's state glyph and every other kind's own glyph", () => {
    expect(glyphFor({ kind: "task", state: "open" })).toBe("•");
    expect(glyphFor({ kind: "task", state: "done" })).toBe("×");
    expect(glyphFor({ kind: "task", state: "migrated" })).toBe(">");
    expect(glyphFor({ kind: "task", state: "scheduled" })).toBe("<");
    expect(glyphFor({ kind: "task", state: "struck" })).toBe("•");
    expect(glyphFor({ kind: "fear", state: "done" })).toBe("☠");
    expect(glyphFor({ kind: "event", state: "open" })).toBe("○");
  });

  it("strikes a struck task and a resolved non-task; dims done, migrated and scheduled tasks", () => {
    expect(isStruck({ kind: "task", state: "struck" })).toBe(true);
    expect(isStruck({ kind: "task", state: "done" })).toBe(false);
    expect(isStruck({ kind: "note", state: "done" })).toBe(true);
    expect(isStruck({ kind: "note", state: "open" })).toBe(false);
    expect(isDimmed({ kind: "task", state: "open" })).toBe(false);
    for (const s of ["done", "migrated", "scheduled", "struck"] as const) expect(isDimmed({ kind: "task", state: s })).toBe(true);
    expect(isDimmed({ kind: "hope", state: "done" })).toBe(true);
    expect(isDimmed({ kind: "hope", state: "open" })).toBe(false);
  });

  it("writes the board's bullet tooltips", () => {
    expect(bulletTip({ kind: "task", state: "open" })).toBe("Task: open. Click to change.");
    expect(bulletTip({ kind: "task", state: "struck" })).toBe("Task: no longer relevant. Click to change.");
    expect(bulletTip({ kind: "task", state: "scheduled" })).toBe("Task: scheduled. Click to change.");
    expect(bulletTip({ kind: "idea", state: "open" })).toBe("Idea. Click to mark resolved.");
    expect(bulletTip({ kind: "fear", state: "done" })).toBe("Fear (resolved). Click to reopen.");
  });

  it("counts open tasks and unresolved Fears as open threads, nothing else", () => {
    const table: [EntryKind, EntryState, boolean][] = [
      ["task", "open", true],
      ["task", "done", false],
      ["task", "migrated", false],
      ["task", "scheduled", false],
      ["task", "struck", false],
      ["fear", "open", true],
      ["fear", "done", false],
      ["hope", "open", false],
      ["event", "open", false],
      ["note", "open", false],
      ["idea", "open", false],
    ];
    for (const [kind, state, open] of table) expect(isOpenThread({ kind, state })).toBe(open);
    const entries = [
      { kind: "task" as const, state: "open" as const, id: 1 },
      { kind: "hope" as const, state: "open" as const, id: 2 },
      { kind: "fear" as const, state: "open" as const, id: 3 },
    ];
    expect(openThreads(entries).map((e) => e.id)).toEqual([1, 3]);
  });

  it("Hope and Fear are labels: their bullets cycle like any other non-task kind (Q7)", () => {
    expect(nextState("hope", "open")).toBe(nextState("note", "open"));
    expect(nextState("fear", "done")).toBe(nextState("idea", "done"));
  });

  it("has the add placeholder and the KEY legend", () => {
    expect(addPlaceholder("task")).toBe("Write a task and press Enter… (@ to link)");
    expect(addPlaceholder("hope")).toBe("Write a hope and press Enter… (@ to link)");
    expect(KEY_LEGEND.map((k) => k.text)).toEqual([
      "• task",
      "× done",
      "> migrated",
      "< scheduled",
      "○ event",
      "– note",
      "! idea",
      "✦ Hope · a boon",
      "☠ Fear · a threat",
      "★ priority",
    ]);
    expect(ENTRY_STATES).toEqual(["open", "done", "migrated", "scheduled", "struck"]);
  });
});

describe("quick keys (B4)", () => {
  it("maps each key plus a space to its kind and drops the prefix", () => {
    const table: [string, EntryKind][] = [
      ["*", "task"],
      [".", "task"],
      ["o", "event"],
      ["-", "note"],
      ["!", "idea"],
      ["+", "hope"],
      ["^", "fear"],
    ];
    for (const [key, kind] of table) {
      expect(parseQuickKey(`${key} the text `, "note")).toEqual({ kind, text: "the text" });
      expect(QUICK_KEYS[key]).toBe(kind);
    }
  });

  it("keeps the selected kind without a key, without the space, or for other characters", () => {
    expect(parseQuickKey("plain line", "idea")).toEqual({ kind: "idea", text: "plain line" });
    expect(parseQuickKey("*no space", "note")).toEqual({ kind: "note", text: "*no space" });
    expect(parseQuickKey("open the door", "task")).toEqual({ kind: "task", text: "open the door" });
    expect(parseQuickKey("# heading", "task")).toEqual({ kind: "task", text: "# heading" });
  });

  it("allows leading spaces and returns empty text for a bare key", () => {
    expect(parseQuickKey("   ^ ambush", "task")).toEqual({ kind: "fear", text: "ambush" });
    expect(parseQuickKey("^ ", "task")).toEqual({ kind: "fear", text: "" });
  });

  it("has the Quick keys card copy", () => {
    expect(QUICK_KEYS_COPY.keys).toBe("Start a line with * task · o event · - note · ! idea · + Hope · ^ Fear");
    expect(QUICK_KEYS_COPY.mentions).toBe("Type @name to link someone or somewhere from Characters & Locations.");
  });
});

describe("migration (B6)", () => {
  const p = (id: string, kind: PageKind, title: string, createdAt: number) => ({ id, kind, title, createdAt });
  const s1 = p("s1", "log", "Session 1", 1);
  const rumors = p("r", "collection", "Rumors & hooks", 2);
  const s2 = p("s2", "log", "Session 2", 5);
  const s3 = p("s3", "log", "Session 3", 9);

  it("targets the first later page of the same kind", () => {
    expect(migrationTarget(s1, [s3, rumors, s1, s2])).toBe(s2);
    expect(migrationTarget(s2, [s1, rumors, s2, s3])).toBe(s3);
  });

  it("has no target for the newest page or a lone kind", () => {
    expect(migrationTarget(s3, [s1, s2, s3])).toBeNull();
    expect(migrationTarget(rumors, [s1, rumors, s2])).toBeNull();
  });

  it("breaks equal creation times by array order and skips the page itself", () => {
    const a = p("a", "future", "A", 3);
    const b = p("b", "future", "B", 4);
    const c = p("c", "future", "C", 4);
    expect(migrationTarget(a, [a, c, b])).toBe(c);
    expect(migrationTarget(b, [a, b, c])).toBeNull();
  });

  it("titles a new page 'Session <log pages + 1>' or '<title> (cont.)', cut to 80", () => {
    expect(newContinuationTitle(s3, [s1, s2, s3, rumors])).toBe("Session 4");
    expect(newContinuationTitle(rumors, [s1, rumors])).toBe("Rumors & hooks (cont.)");
    const long = p("l", "collection", "x".repeat(80), 1);
    const title = newContinuationTitle(long, [long]);
    expect(title).toHaveLength(80);
    expect(title.endsWith(" (cont.)")).toBe(true);
  });

  it("writes the Migrate tooltips", () => {
    expect(migrationTip(s2)).toBe("Copy open tasks to “Session 2” and mark them > here");
    expect(migrationTip(null)).toBe("Copy open tasks to a new page and mark them > here");
  });

  const entries = [
    { id: "e1", kind: "task" as const, state: "open" as const, authorId: "gm" },
    { id: "e2", kind: "task" as const, state: "done" as const, authorId: "gm" },
    { id: "e3", kind: "fear" as const, state: "open" as const, authorId: "gm" },
    { id: "e4", kind: "task" as const, state: "open" as const, authorId: "player" },
  ];

  it("plans a migration to an existing later page", () => {
    expect(openTasks(entries).map((e) => e.id)).toEqual(["e1", "e4"]);
    const plan = planMigration(s1, [s1, s2, s3], entries);
    expect(plan).not.toBeNull();
    expect(plan!.target).toBe(s2);
    expect(plan!.newPage).toBeNull();
    expect(plan!.copies.map((e) => e.id)).toEqual(["e1", "e4"]);
    expect(plan!.copies.map((e) => e.authorId)).toEqual(["gm", "player"]);
    expect(plan!.migrate.map((e) => e.id)).toEqual(["e1", "e4"]);
  });

  it("plans a new page when there is no later one", () => {
    const plan = planMigration(s3, [s1, s2, s3], entries);
    expect(plan!.target).toBeNull();
    expect(plan!.newPage).toEqual({ kind: "log", title: "Session 4" });
    const plan2 = planMigration(rumors, [s1, rumors], entries);
    expect(plan2!.newPage).toEqual({ kind: "collection", title: "Rumors & hooks (cont.)" });
  });

  it("returns null without open tasks (an open Fear is not migrated)", () => {
    expect(planMigration(s1, [s1, s2], [entries[1]!, entries[2]!])).toBeNull();
    expect(planMigration(s1, [s1, s2], [])).toBeNull();
  });
});

describe("defaults, titles and tapes (B7, Q5, D6)", () => {
  it("has the GM and player default pages with the board's tapes", () => {
    expect(GM_DEFAULT_PAGES).toEqual([
      { kind: "log", title: "Session 1", tape: 0 },
      { kind: "collection", title: "Rumors & hooks", tape: 1 },
      { kind: "collection", title: "Loot & debts", tape: 2 },
      { kind: "future", title: "Future log", tape: 3 },
    ]);
    expect(PLAYER_DEFAULT_PAGES).toEqual([
      { kind: "log", title: "Session 1", tape: 2 },
      { kind: "collection", title: "People we met", tape: 1 },
      { kind: "collection", title: "Clues & secrets", tape: 4 },
      { kind: "collection", title: "My goals", tape: 0 },
    ]);
    expect(defaultPages(true)).toBe(GM_DEFAULT_PAGES);
    expect(defaultPages(false)).toBe(PLAYER_DEFAULT_PAGES);
  });

  it("titles new pages per kind", () => {
    const pages = [{ kind: "log" as const }, { kind: "log" as const }, { kind: "future" as const }];
    expect(newPageTitle("log", pages)).toBe("Session 3");
    expect(newPageTitle("future", pages)).toBe("Future log 2");
    expect(newPageTitle("collection", pages)).toBe("New collection");
    expect(newPageTitle("log", [])).toBe("Session 1");
  });

  it("titles session log pages after the session (D6)", () => {
    expect(sessionLogTitle({ n: 2 })).toBe("Session 2");
    expect(sessionLogTitle({ n: 2, title: "  " })).toBe("Session 2");
    expect(sessionLogTitle({ n: 3, title: "The Ford" })).toBe("Session 3: The Ford");
    expect(sessionLogTitle({ n: 4, title: "y".repeat(120) })).toHaveLength(80);
  });

  it("picks tapes by page count and cycles them", () => {
    expect(TAPES).toHaveLength(6);
    expect(newPageTape([])).toBe(0);
    expect(newPageTape([1, 2, 3, 4, 5, 6, 7])).toBe(1);
    expect(nextTape(0)).toBe(1);
    expect(nextTape(5)).toBe(0);
    expect(tapeBackground(7)).toBe(TAPES[1]);
    expect(tapeBackground(-1)).toBe(TAPES[5]);
    expect(TAPES[THREADS_TAPE]).toContain("#c9a8ff");
  });

  it("lists the index groups", () => {
    expect(PAGE_GROUPS.map((g) => [g.label, g.addLabel])).toEqual([
      ["Session logs", "New session log"],
      ["Collections", "New collection"],
      ["Future log", "New future page"],
    ]);
  });
});

describe("visibility (A3, A4, A5, Q4, Q12, D4)", () => {
  it("allows five values for players and three for the GM", () => {
    expect(allowedVisibilities(false)).toEqual(["gm", "private", "players", "everyone", "chosen"]);
    expect(allowedVisibilities(true)).toEqual(["private", "everyone", "chosen"]);
    for (const v of VISIBILITIES) expect(isAllowedVisibility(false, v)).toBe(true);
    const gm: [Visibility, boolean][] = [
      ["gm", false],
      ["private", true],
      ["players", false],
      ["everyone", true],
      ["chosen", true],
    ];
    for (const [v, ok] of gm) expect(isAllowedVisibility(true, v)).toBe(ok);
  });

  it("defaults the GM to private and a player to 'GM can read'", () => {
    expect(defaultVisibility(true)).toBe("private");
    expect(defaultVisibility(false)).toBe("gm");
  });

  it("labels the chip per owner type", () => {
    expect(VISIBILITIES.map((v) => visibilityLabel(v, false))).toEqual([
      "Private · GM can read",
      "Private · hidden from everyone",
      "Players only (hidden from the GM)",
      "Everyone",
      "Chosen players",
    ]);
    expect(["private", "everyone", "chosen"].map((v) => visibilityLabel(v as Visibility, true))).toEqual([
      "Private",
      "Everyone",
      "Chosen players",
    ]);
  });

  it("names the readers of a present journal's page", () => {
    const r = (v: Visibility) => effectiveReaders(v, { ownerIsGm: false, departed: false });
    expect(r("gm")).toEqual({ visibility: "gm", gm: "yes", players: "none" });
    expect(r("private")).toEqual({ visibility: "private", gm: "no", players: "none" });
    expect(r("players")).toEqual({ visibility: "players", gm: "no", players: "all" });
    expect(r("everyone")).toEqual({ visibility: "everyone", gm: "yes", players: "all" });
    expect(r("chosen")).toEqual({ visibility: "chosen", gm: "if-recipient", players: "recipients" });
  });

  it("opens a departed journal's non-private pages to everyone and keeps private pages private (Q12)", () => {
    for (const v of ["gm", "players", "everyone", "chosen"] as const) {
      expect(effectiveReaders(v, { ownerIsGm: false, departed: true })).toEqual({
        visibility: "everyone",
        gm: "yes",
        players: "all",
      });
    }
    expect(effectiveReaders("private", { ownerIsGm: false, departed: true }).visibility).toBe("private");
    expect(effectiveReaders("private", { ownerIsGm: true, departed: true }).visibility).toBe("private");
  });

  it("decides reads for every visibility x viewer x recipient x departed", () => {
    type Row = [Visibility, boolean, "owner" | "gm" | "player", boolean, boolean, boolean];
    // [visibility, ownerIsGm, viewer, isRecipient, departed, expected]
    const rows: Row[] = [
      // player pages, journal present
      ["gm", false, "gm", false, false, true],
      ["gm", false, "player", false, false, false],
      ["private", false, "gm", false, false, false],
      ["private", false, "player", true, false, false],
      ["players", false, "gm", false, false, false],
      ["players", false, "player", false, false, true],
      ["everyone", false, "gm", false, false, true],
      ["everyone", false, "player", false, false, true],
      ["chosen", false, "gm", false, false, false],
      ["chosen", false, "gm", true, false, true],
      ["chosen", false, "player", true, false, true],
      ["chosen", false, "player", false, false, false],
      // player pages, journal departed
      ["gm", false, "player", false, true, true],
      ["players", false, "gm", false, true, true],
      ["chosen", false, "player", false, true, true],
      ["private", false, "gm", false, true, false],
      ["private", false, "player", false, true, false],
      // GM pages (departed is ignored)
      ["private", true, "player", false, false, false],
      ["private", true, "player", false, true, false],
      ["everyone", true, "player", false, false, true],
      ["chosen", true, "player", true, false, true],
      ["chosen", true, "player", false, false, false],
      ["chosen", true, "player", false, true, false],
    ];
    for (const [visibility, ownerIsGm, viewer, isRecipient, departed, expected] of rows) {
      expect(
        canReadPage({ visibility, ownerIsGm, viewer, isRecipient, departed }),
        `${visibility}/${ownerIsGm ? "gm-page" : "player-page"}/${viewer}/${isRecipient}/${departed}`,
      ).toBe(expected);
    }
    for (const v of VISIBILITIES) {
      expect(canReadPage({ visibility: v, ownerIsGm: false, viewer: "owner", isRecipient: false, departed: true })).toBe(true);
    }
  });
});

describe("action table (analysis 3.2, Q3, D2, D5)", () => {
  const base: PageActionInput = { isOwner: true, canRead: true, departed: false, viewerIsGm: false, visibility: "gm" };

  it("lets the owner of a present journal do every page action", () => {
    expect(pageActions(base)).toEqual({ canEditPage: true, canMigrate: true, canAdd: true, canBin: true, canRestore: false });
  });

  it("lets a reader only add", () => {
    const reader = { ...base, isOwner: false, viewerIsGm: true };
    expect(pageActions(reader)).toEqual({ canEditPage: false, canMigrate: false, canAdd: true, canBin: false, canRestore: false });
  });

  it("refuses everything without read access", () => {
    const none = { ...base, isOwner: false, canRead: false };
    expect(pageActions(none)).toEqual({ canEditPage: false, canMigrate: false, canAdd: false, canBin: false, canRestore: false });
  });

  it("freezes a departed journal; the GM may bin its non-private pages (D2, Q12)", () => {
    const owner = { ...base, departed: true };
    expect(canEditPage(owner)).toBe(false);
    expect(canAdd(owner)).toBe(false);
    expect(canBin(owner)).toBe(false);
    const gm = { ...base, isOwner: false, viewerIsGm: true, departed: true, visibility: "players" as const };
    expect(canAdd(gm)).toBe(false);
    expect(canBin(gm)).toBe(true);
    expect(canBin({ ...gm, visibility: "private", canRead: false })).toBe(false);
    expect(canBin({ ...gm, visibility: "private" })).toBe(false);
    const player = { ...gm, viewerIsGm: false };
    expect(canBin(player)).toBe(false);
  });

  it("the GM cannot bin a present player's page it reads", () => {
    expect(canBin({ ...base, isOwner: false, viewerIsGm: true })).toBe(false);
  });

  it("binned pages: no action but restore, and restore only for the binner with access", () => {
    const binned = { ...base, binned: true, isBinner: true };
    expect(pageActions(binned)).toEqual({ canEditPage: false, canMigrate: false, canAdd: false, canBin: false, canRestore: true });
    expect(canRestore({ ...binned, isBinner: false })).toBe(false);
    expect(canRestore({ ...binned, canRead: false })).toBe(false);
    expect(canRestore(base)).toBe(false);
    const gmBinned = { ...base, isOwner: false, viewerIsGm: true, departed: true, visibility: "everyone" as const, binned: true, isBinner: true };
    expect(canRestore(gmBinned)).toBe(true);
  });

  it("entry actions: author edits; owner or author cycles and deletes; owner stars and moves (D5)", () => {
    type Row = [boolean, boolean, boolean, boolean, ReturnType<typeof entryActions>];
    // [isOwner, isAuthor, canRead, departed, expected]
    const rows: Row[] = [
      [true, true, true, false, { canEditEntry: true, canCycle: true, canDeleteEntry: true, canStar: true, canMove: true }],
      [true, false, true, false, { canEditEntry: false, canCycle: true, canDeleteEntry: true, canStar: true, canMove: true }],
      [false, true, true, false, { canEditEntry: true, canCycle: true, canDeleteEntry: true, canStar: false, canMove: false }],
      [false, false, true, false, { canEditEntry: false, canCycle: false, canDeleteEntry: false, canStar: false, canMove: false }],
      [true, true, true, true, { canEditEntry: false, canCycle: false, canDeleteEntry: false, canStar: false, canMove: false }],
      [false, true, true, true, { canEditEntry: false, canCycle: false, canDeleteEntry: false, canStar: false, canMove: false }],
      [false, true, false, false, { canEditEntry: false, canCycle: false, canDeleteEntry: false, canStar: false, canMove: false }],
    ];
    for (const [isOwner, isAuthor, canRead, departed, expected] of rows) {
      const input = { isOwner, isAuthor, canRead, departed };
      expect(entryActions(input)).toEqual(expected);
      expect(canEditEntry(input)).toBe(expected.canEditEntry);
      expect(canCycle(input)).toBe(expected.canCycle);
      expect(canDeleteEntry(input)).toBe(expected.canDeleteEntry);
      expect(canArrangeEntry(input)).toBe(expected.canStar);
    }
  });
});

describe("mentions (Q6, D7)", () => {
  const text = "Met @[Marlow](k57abc) at @[The Ford](loc_2), then @[Marlow](k57abc) again";

  it("formats and parses tokens", () => {
    expect(formatToken("Marlow", "k57abc")).toBe("@[Marlow](k57abc)");
    expect(formatToken("Odd [name]\nhere", "x1")).toBe("@[Odd name here](x1)");
    expect(sanitizeMentionName("  a ]b[ ")).toBe("a b");
    expect(parseTokens(text)).toEqual([
      { type: "text", text: "Met " },
      { type: "mention", id: "k57abc", name: "Marlow" },
      { type: "text", text: " at " },
      { type: "mention", id: "loc_2", name: "The Ford" },
      { type: "text", text: ", then " },
      { type: "mention", id: "k57abc", name: "Marlow" },
      { type: "text", text: " again" },
    ]);
    expect(parseTokens("")).toEqual([]);
    expect(parseTokens("plain @name")).toEqual([{ type: "text", text: "plain @name" }]);
    expect(parseTokens("@[A](x)")).toEqual([{ type: "mention", id: "x", name: "A" }]);
  });

  it("counts, lists and limits mentions", () => {
    expect(countMentions(text)).toBe(3);
    expect(mentionIds(text)).toEqual(["k57abc", "loc_2"]);
    const ten = Array.from({ length: 10 }, (_, i) => formatToken(`N${i}`, `id${i}`)).join(" ");
    expect(withinMentionLimit(ten)).toBe(true);
    expect(withinMentionLimit(`${ten} @[X](y)`)).toBe(false);
  });

  it("reads tokens as their stored names in plain text", () => {
    expect(toPlainText(text)).toBe("Met Marlow at The Ford, then Marlow again");
    expect(toPlainText("no tokens")).toBe("no tokens");
  });

  it("renders a visible entry as a link with its current name and an invisible one as stored plain text", () => {
    const parts = parseTokens(text);
    const visible = { k57abc: { name: "Marlow the Grey", kind: "character" as const, role: "Smuggler" } };
    expect(renderParts(parts, visible)).toEqual([
      { type: "text", text: "Met " },
      { type: "link", id: "k57abc", text: "Marlow the Grey", tip: "Smuggler" },
      { type: "text", text: " at The Ford, then " },
      { type: "link", id: "k57abc", text: "Marlow the Grey", tip: "Smuggler" },
      { type: "text", text: " again" },
    ]);
    const map = new Map([["loc_2", { name: "Ford of Tears", kind: "location" as const }]]);
    expect(renderParts(parseTokens("@[The Ford](loc_2)"), map)).toEqual([
      { type: "link", id: "loc_2", text: "Ford of Tears", tip: "Location" },
    ]);
    expect(renderParts(parseTokens("@[A](a)"), { a: { name: "A", role: " " } })).toEqual([
      { type: "link", id: "a", text: "A", tip: "Character" },
    ]);
    expect(renderParts(parseTokens("@[Secret](constructor)"), {})).toEqual([{ type: "text", text: "Secret" }]);
  });

  it("finds the @query at the caret", () => {
    expect(activeMentionQuery("Met @Mar", 8)).toEqual({ start: 4, query: "Mar" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("Met @Mar of", 11)).toEqual({ start: 4, query: "Mar of" });
    expect(activeMentionQuery("mail a@b", 8)).toBeNull();
    expect(activeMentionQuery("no at", 5)).toBeNull();
    expect(activeMentionQuery("@[Marlow](k5) x", 15)).toBeNull();
  });

  it("inserts a mention over the typed query", () => {
    const r = insertMention("Met @Mar today", 4, 8, { id: "k5", name: "Marlow" });
    expect(r.text).toBe("Met @[Marlow](k5) today");
    expect(r.caret).toBe("Met @[Marlow](k5) ".length);
    const end = insertMention("Met @Ma", 4, 7, { id: "k5", name: "Marlow" });
    expect(end.text).toBe("Met @[Marlow](k5) ");
  });
});

describe("authors and journal names (Q3, Q8, Q12)", () => {
  it("labels authors", () => {
    expect(authorLabel({ isGm: true, characterName: "Ash", accountName: "petar" })).toBe("GM");
    expect(authorLabel({ isGm: false, characterName: "Ash", accountName: "petar" })).toBe("Ash");
    expect(authorLabel({ isGm: false, characterName: " ", accountName: "petar" })).toBe("petar");
    expect(authorLabel({ isGm: false })).toBe("Player");
    expect(authorSuffix("GM")).toBe(" - GM");
  });

  it("marks entries by someone other than the page owner as added", () => {
    expect(isAddedEntry({ authorId: "u2" }, { ownerId: "u1" })).toBe(true);
    expect(isAddedEntry({ authorId: "u1" }, { ownerId: "u1" })).toBe(false);
  });

  it("names journals", () => {
    expect(journalWho({ isGm: true })).toEqual({ whoName: "Game Master", whoSub: "GM journal · private to the GM" });
    expect(journalWho({ isGm: false, characterName: "Ash", className: "Ranger" })).toEqual({
      whoName: "Ash",
      whoSub: "Player journal · Ranger",
    });
    expect(journalWho({ isGm: false, accountName: "petar" })).toEqual({ whoName: "petar", whoSub: "Player journal · Player" });
    expect(journalWho({ isGm: false })).toEqual({ whoName: "Player", whoSub: "Player journal · Player" });
    expect(journalTitle("Game Master")).toBe("Game Master’s Journal");
    expect(pastJournalTitle({ characterName: "Ash" })).toBe("Ash’s journal");
    expect(pastJournalTitle({ accountName: "petar" })).toBe("petar’s journal");
  });
});

describe("summary (B1, B2, B3, B5, B9, D6)", () => {
  const created = Date.UTC(2026, 9, 20, 12);

  it("writes the header line, sub line and threads button", () => {
    expect(headerLine({ pageCount: 4, entryCount: 12 })).toBe("4 pages · 12 entries");
    expect(headerLine({ pageCount: 1, entryCount: 1 })).toBe("1 page · 1 entry");
    expect(headerLine({ pageCount: 0, entryCount: 0 })).toBe("0 pages · 0 entries");
    expect(subLine("GM journal · private to the GM", { pageCount: 4, entryCount: 0 })).toBe(
      "GM journal · private to the GM · 4 pages · 0 entries",
    );
    expect(threadsButtonLabel(3)).toBe("🧵 Open threads · 3");
  });

  it("writes the index count", () => {
    expect(pageCountLabel({ openCount: 2, entryCount: 5 })).toBe("2 open");
    expect(pageCountLabel({ openCount: 0, entryCount: 5 })).toBe("5");
    expect(pageCountLabel({ openCount: 0, entryCount: 0 })).toBe("");
  });

  it("writes the page meta with the creation date or the linked session's date", () => {
    const o = { locale: "en-GB", timeZone: "UTC" };
    expect(pageMeta({ kind: "collection", createdAt: created }, null, o)).toBe("collection · 20 Oct 2026");
    expect(pageMeta({ kind: "future", createdAt: created }, undefined, o)).toBe("future log · 20 Oct 2026");
    expect(pageMeta({ kind: "log", createdAt: created }, { date: "2026-10-24" }, o)).toBe("session log · 24 Oct 2026");
    expect(pageMeta({ kind: "log", createdAt: created }, { date: null }, o)).toBe("session log · No date set");
  });

  it("has the empty lines and the group empty text", () => {
    expect(emptyLine("log")).toBe("A fresh page. What happened at the table?");
    expect(emptyLine("future")).toBe("Plans, festivals, deadlines, things coming due…");
    expect(emptyLine("collection")).toBe("Start the collection…");
    expect(groupEmptyText(true)).toBe("No matches.");
    expect(groupEmptyText(false)).toBe("Nothing here yet.");
  });

  it("matches case-insensitively, mentions by name, never on a blank query", () => {
    expect(matches("Met the Baron", "baron")).toBe(true);
    expect(matches("Met the Baron", "  BARON ")).toBe(true);
    expect(matches("Met the Baron", "duke")).toBe(false);
    expect(matches("Met the Baron", "  ")).toBe(false);
    expect(matches("Saw @[Marlow](k57abc)", "marlow")).toBe(true);
    expect(matches("Saw @[Marlow](k57abc)", "k57")).toBe(false);
    expect(pageMatches({ title: "Loot" }, [{ text: "a gem" }], "")).toBe(true);
    expect(pageMatches({ title: "Loot" }, [{ text: "a gem" }], "GEM")).toBe(true);
    expect(pageMatches({ title: "Loot" }, [{ text: "a gem" }], "loo")).toBe(true);
    expect(pageMatches({ title: "Loot" }, [{ text: "a gem" }], "sword")).toBe(false);
  });

  it("has the tear-out label and the threads copy", () => {
    expect(tearLabel(false)).toBe("Tear out page");
    expect(tearLabel(true)).toBe("Click again to tear out");
    expect(THREADS_COPY).toEqual({
      title: "Open threads",
      intro: "Every unfinished task and every looming Fear, from all pages.",
      empty: "Nothing dangling. Suspicious…",
    });
    expect(threadPageLink("Session 1")).toBe("Session 1 →");
  });
});

describe("limits and bin (Q10, Q11)", () => {
  it("has the caps", () => {
    expect(NOTE_LIMITS).toEqual({
      MAX_PAGES: 200,
      MAX_PAGE_ENTRIES: 300,
      MAX_JOURNAL_ENTRIES: 5000,
      TITLE_MAX: 80,
      TEXT_MAX: 500,
      MAX_MENTIONS: 10,
    });
    expect(BIN_DAYS).toBe(30);
    expect(UNDO_MS).toBe(10_000);
  });

  it("validates titles and entry text", () => {
    expect(isValidTitle("  ")).toBe(false);
    expect(isValidTitle(" a ")).toBe(true);
    expect(isValidTitle("x".repeat(80))).toBe(true);
    expect(isValidTitle("x".repeat(81))).toBe(false);
    expect(isValidEntryText("")).toBe(false);
    expect(isValidEntryText("x".repeat(500))).toBe(true);
    expect(isValidEntryText("x".repeat(501))).toBe(false);
    expect(clampTitle("abc")).toBe("abc");
    expect(clampTitle("x".repeat(100), " (cont.)")).toBe("x".repeat(72) + " (cont.)");
  });

  it("counts bin days", () => {
    const now = Date.UTC(2026, 9, 21);
    expect(binDaysLeft(now, now)).toBe(30);
    expect(binDaysLeft(now - 29.5 * DAY, now)).toBe(1);
    expect(binDaysLeft(now - 31 * DAY, now)).toBe(0);
    expect(binCutoff(now)).toBe(now - 30 * DAY);
    expect(now - 31 * DAY < binCutoff(now)).toBe(true);
    expect(now - 29 * DAY < binCutoff(now)).toBe(false);
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(12)).toBe("12 days left");
  });
});

describe("Markdown export (Q9)", () => {
  it("writes one entry line per state, star and author", () => {
    expect(entryToMarkdown({ kind: "task", state: "open", star: false, text: "Find the map" })).toBe("- • Find the map");
    expect(entryToMarkdown({ kind: "task", state: "struck", star: false, text: "Old" })).toBe("- • ~~Old~~");
    expect(entryToMarkdown({ kind: "hope", state: "open", star: true, text: "An ally", addedBy: "GM" })).toBe(
      "- ★ ✦ An ally - GM",
    );
    expect(entryToMarkdown({ kind: "note", state: "open", star: false, text: "two\nlines" })).toBe("- – two lines");
  });

  it("exports a journal (snapshot)", () => {
    const pages = [
      { id: "p1", kind: "log" as const, title: "Session 2: The Ford", createdAt: Date.UTC(2026, 9, 1, 12), session: { date: "2026-10-24" } },
      { id: "p2", kind: "collection" as const, title: "People we met", createdAt: Date.UTC(2026, 9, 2, 12) },
      { id: "p3", kind: "future" as const, title: "Future log", createdAt: Date.UTC(2026, 9, 3, 12), session: null },
    ];
    const entries = [
      { pageId: "p1", kind: "task" as const, state: "done" as const, star: false, text: "Cross the ford", order: 2 },
      { pageId: "p1", kind: "task" as const, state: "open" as const, star: true, text: "Pay @[Marlow](k57abc)", order: 1 },
      { pageId: "p1", kind: "fear" as const, state: "open" as const, star: false, text: "Ambush at dusk", order: 3, addedBy: "GM" },
      { pageId: "p1", kind: "task" as const, state: "migrated" as const, star: false, text: "Sell the gem", order: 4 },
      { pageId: "p1", kind: "task" as const, state: "scheduled" as const, star: false, text: "Visit the temple", order: 5 },
      { pageId: "p2", kind: "note" as const, state: "done" as const, star: false, text: "@[Marlow](k57abc) lied", order: 1 },
      { pageId: "p2", kind: "event" as const, state: "open" as const, star: false, text: "Feast at the hall", order: 2, addedBy: "Ash" },
      { pageId: "gone", kind: "idea" as const, state: "open" as const, star: false, text: "not exported", order: 1 },
    ];
    const md = journalToMarkdown({ whoName: "Ash", pages, entries, options: { locale: "en-GB", timeZone: "UTC" } });
    expect(md).toMatchInlineSnapshot(`
      "# Ash’s Journal

      ## Session 2: The Ford
      _session log · 24 Oct 2026_

      - ★ • Pay Marlow
      - × Cross the ford
      - ☠ Ambush at dusk - GM
      - > Sell the gem
      - < Visit the temple

      ## People we met
      _collection · 2 Oct 2026_

      - – ~~Marlow lied~~
      - ○ Feast at the hall - Ash

      ## Future log
      _future log · 3 Oct 2026_

      _No entries._
      "
    `);
  });

  it("exports an empty journal as its title", () => {
    expect(journalToMarkdown({ whoName: "Game Master", pages: [], entries: [] })).toBe("# Game Master’s Journal\n");
  });
});
