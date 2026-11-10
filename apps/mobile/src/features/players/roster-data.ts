export type RosterSeat = { userId: string; name: string };
/** A member: a seat, whether they are a co-GM (config G1) and when they joined. */
export type RosterMember = RosterSeat & { coGm: boolean; joinedAt: number };
export type RosterPlayer = RosterMember & { email?: string | null };

export type RosterView =
  | { viewer: "gm"; gm: RosterSeat; players: RosterPlayer[] }
  | { viewer: "player"; gm: RosterSeat; players: RosterMember[] };

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function seat(value: unknown): RosterSeat | null {
  const row = record(value);
  if (!row || typeof row.userId !== "string") return null;
  const name = typeof row.name === "string" ? row.name : "Player";
  return { userId: row.userId, name };
}

function member(value: unknown): RosterMember | null {
  const base = seat(value);
  if (!base) return null;
  const row = record(value);
  return { ...base, coGm: row?.coGm === true, joinedAt: typeof row?.joinedAt === "number" ? row.joinedAt : 0 };
}

/** Parses `members.roster` for the players screen. */
export function readRoster(value: unknown): RosterView | null | undefined {
  if (value === undefined) return undefined;
  const row = record(value);
  if (!row || (row.viewer !== "gm" && row.viewer !== "player")) return null;
  const gm = seat(row.gm);
  if (!gm) return null;
  const players = Array.isArray(row.players) ? row.players : [];
  if (row.viewer === "gm") {
    const listed: RosterPlayer[] = [];
    for (const player of players) {
      const row = member(player);
      if (!row) continue;
      const email = record(player)?.email;
      listed.push({
        ...row,
        email: typeof email === "string" || email === null ? email : null,
      });
    }
    return { viewer: "gm", gm, players: listed };
  }
  const listed: RosterMember[] = [];
  for (const player of players) {
    const row = member(player);
    if (row) listed.push(row);
  }
  return { viewer: "player", gm, players: listed };
}

export type AccessView = {
  joinCode: string | null;
  invites: { _id: string; email: string; createdAt: number; asCoGm: boolean }[];
};

export function readAccess(value: unknown): AccessView | null | undefined {
  if (value === undefined) return undefined;
  const row = record(value);
  if (!row) return null;
  const joinCode = row.joinCode;
  const invites = Array.isArray(row.invites) ? row.invites : [];
  const listed: AccessView["invites"] = [];
  for (const invite of invites) {
    const item = record(invite);
    if (!item || typeof item._id !== "string" || typeof item.email !== "string") continue;
    listed.push({
      _id: item._id,
      email: item.email,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
      asCoGm: item.asCoGm === true,
    });
  }
  return {
    joinCode: typeof joinCode === "string" || joinCode === null ? joinCode : null,
    invites: listed,
  };
}
