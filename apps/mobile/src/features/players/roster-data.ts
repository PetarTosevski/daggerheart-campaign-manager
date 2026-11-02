export type RosterSeat = { userId: string; name: string };
export type RosterPlayer = RosterSeat & { email?: string | null };

export type RosterView =
  | { viewer: "gm"; gm: RosterSeat; players: RosterPlayer[] }
  | { viewer: "player"; gm: RosterSeat; players: RosterSeat[] };

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
      const member = seat(player);
      if (!member) continue;
      const email = record(player)?.email;
      listed.push({
        ...member,
        email: typeof email === "string" || email === null ? email : null,
      });
    }
    return { viewer: "gm", gm, players: listed };
  }
  const listed: RosterSeat[] = [];
  for (const player of players) {
    const member = seat(player);
    if (member) listed.push(member);
  }
  return { viewer: "player", gm, players: listed };
}

export type AccessView = {
  joinCode: string | null;
  invites: { _id: string; email: string; createdAt: number }[];
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
    });
  }
  return {
    joinCode: typeof joinCode === "string" || joinCode === null ? joinCode : null,
    invites: listed,
  };
}
