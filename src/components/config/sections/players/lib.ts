// Pure helpers for Campaign settings, Players (tracer U3) and the Players dialog that imports this folder.
import { CLASSES } from "@/lib/srd/classes";

/** A join code as people read it: `ABCD-EFGH`. */
export const formatJoinCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** The join link for `code` on `origin` (the page's own origin). */
export const joinUrl = (origin: string, code: string) => `${origin}/join/${code}`;

/** The character slice the row's line needs (a `charactersReads.listByCampaign` view has it). */
export type PlayedCharacter = {
  ownerId: string;
  status: string;
  corrupt?: true;
  sheet: { name: string; classId: string };
};

const className = (classId: string) => CLASSES.find((c) => c.id === classId)?.name ?? classId;

/**
 * The row's second line (design `.pl .row-t span`): 'plays Moss · Druid', several characters joined with ', ', retired
 * and dead ones left out. Null when the member plays nothing yet.
 */
export function playsLine(userId: string, characters: readonly PlayedCharacter[] | undefined): string | null {
  const own = (characters ?? []).filter((c) => c.ownerId === userId && c.corrupt !== true && c.status !== "retired" && c.status !== "dead");
  if (own.length === 0) return null;
  return `plays ${own.map((c) => `${c.sheet.name || "Unnamed"} · ${className(c.sheet.classId)}`).join(", ")}`;
}

/** What the viewer may do to a member's row (Q7 a): the creator manages co-GMs and removes anyone; a co-GM removes players. */
export function rowActions(viewerIsCreator: boolean, member: { coGm: boolean }): { toggleCoGm: boolean; remove: boolean } {
  return { toggleCoGm: viewerIsCreator, remove: viewerIsCreator || !member.coGm };
}
