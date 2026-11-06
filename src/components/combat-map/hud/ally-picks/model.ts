/**
 * Per-ally picks in the HUD (plan finish-hud-lk FH-AP; board CmpPicking 'After the roll': "Rousing Strike · each ally picks
 * their own", "2 of 3 chose", "waiting…"). Pure: what `allyPicksReads.open` sends, turned into the cards a screen shows.
 * The server decides who may answer (`mine`) and who made the use (`actor`); nothing here grants access.
 */

export type PickOption = { id: string; label: string };

export type PickChooser = {
  stepId: string;
  chooserId: string;
  characterId?: string;
  name: string;
  label: string;
  options: readonly PickOption[];
  answered: boolean;
  mine: boolean;
  /** The actor's own pick (Rousing Strike's "you"): the review can't untick it (CU2). */
  self?: boolean;
};

export type PickRow = {
  requestId: string;
  name: string;
  actorName: string;
  actor: boolean;
  createdAt: number;
  /** The actor still reviews the computed allies before the picks go out (CU2, user 2026-11-06). */
  review?: boolean;
  choosers: readonly PickChooser[];
};

/** One pick the caller answers now (their character's; any outstanding one for the GM). */
export type MyPick<R extends PickRow = PickRow> = { row: R; chooser: PickChooser; key: string };

export const pickKey = (requestId: string, c: Pick<PickChooser, "stepId" | "chooserId">) => `${requestId}:${c.stepId}:${c.chooserId}`;

/** The picks waiting on the caller, oldest use first, in the use's chooser order. */
export function myPicks<R extends PickRow>(rows: readonly R[]): MyPick<R>[] {
  return rows.flatMap((row) => row.choosers.filter((c) => c.mine && !c.answered).map((chooser) => ({ row, chooser, key: pickKey(row.requestId, chooser) })));
}

/** The caller's own uses still waiting on someone ("Rousing Strike · 1 of 2 chose · waiting…"). */
export function waitingRows<R extends PickRow>(rows: readonly R[]): R[] {
  return rows.filter((row) => row.actor && row.review !== true && row.choosers.some((c) => !c.answered));
}

/**
 * The caller's uses whose ally list they review before the picks go out (plan rule-switches CU2, bead dcm-bxp.99.32.46,
 * user 2026-11-06: "the acting player can deselect allies from the computed list (can't see/hear)"). The GM gets every
 * one (a player who is away, or the GM playing for the PC).
 */
export function reviewRows<R extends PickRow>(rows: readonly R[]): R[] {
  return rows.filter((row) => row.actor && row.review === true);
}

/** The choosers the review can untick: everyone but the actor's own pick, each once. */
export function reviewAllies(row: Pick<PickRow, "choosers">): PickChooser[] {
  const seen = new Set<string>();
  return row.choosers.filter((c) => c.self !== true && !seen.has(c.chooserId) && (seen.add(c.chooserId), true));
}

/** The read after the review was sent (the optimistic update): the unticked choosers go, the picks are out. */
export function withSent<R extends PickRow>(rows: readonly R[], requestId: string, drop: readonly string[]): R[] {
  const dropped = new Set(drop);
  return rows.map((row) => (row.requestId !== requestId ? row : ({ ...row, review: false, choosers: row.choosers.filter((c) => !dropped.has(c.chooserId)) } as R)));
}

/** "2 of 3 chose" (the board's count line). */
export function choseLine(row: Pick<PickRow, "choosers">): string {
  return `${row.choosers.filter((c) => c.answered).length} of ${row.choosers.length} chose`;
}

/** Who the use still waits on: "Bryn, Moss" (each name once). */
export function waitingOn(row: Pick<PickRow, "choosers">): string {
  return [...new Set(row.choosers.filter((c) => !c.answered).map((c) => c.name))].join(", ");
}

/** The pick card's sub line: "Brannoc's Rousing Strike · your pick" (the GM's: "Bryn's pick"). */
export function pickSub(p: MyPick<PickRow>, gm: boolean): string {
  return `${p.row.actorName}’s ${p.row.name} · ${gm ? `${p.chooser.name}’s pick` : "your pick"}`;
}

/** The read after one pick was sent (the optimistic update): that chooser answered, nobody can answer it again. */
export function withAnswered<R extends PickRow>(rows: readonly R[], requestId: string, stepId: string, chooserId: string): R[] {
  return rows.map((row) =>
    row.requestId !== requestId ? row : ({ ...row, choosers: row.choosers.map((c) => (c.stepId === stepId && c.chooserId === chooserId ? { ...c, answered: true, mine: false } : c)) } as R),
  );
}
