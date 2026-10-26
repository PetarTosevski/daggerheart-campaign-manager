import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { campaignRoleOf } from "./permissions";

/**
 * Departure of a journal (D1, Q12), computed at read time and never stored. A player journal is departed when its
 * owner has no campaign role any more (`members.removePlayer` / `leave` delete the membership and the invites), or
 * when its character is missing, belongs to another campaign or account now, or is `dead` or `retired`. `away`
 * (benched, X6, or a Castle High death move) and `active` are not departures. The GM's journal never departs. A rejoin
 * (`joinByCode`) or a status set back to `active` restores the previous visibility by itself, because nothing is
 * written. No write.
 *
 * Cost: the membership lookup, then the character (two reads for a member); for someone who is not a member, the
 * users row and the invite lookup instead (three reads when they are not invited, four only for a pending invitee
 * whose journal has a character). The campaign's GM costs nothing.
 */
export async function departed(ctx: QueryCtx, campaign: Doc<"campaigns">, journal: Doc<"journals">): Promise<boolean> {
  if (journal.userId === campaign.ownerId) return false;
  if ((await campaignRoleOf(ctx, journal.userId, campaign)) === null) return true;
  if (journal.characterId === undefined) return false;
  const character = await ctx.db.get("characters", journal.characterId);
  return characterGone(character, campaign, journal);
}

/** Whether a journal's character no longer carries it: missing, moved, given to another account, dead or retired. */
export function characterGone(character: Doc<"characters"> | null, campaign: Doc<"campaigns">, journal: Doc<"journals">): boolean {
  return (
    character === null ||
    character.campaignId !== campaign._id ||
    character.ownerId !== journal.userId ||
    character.status === "dead" ||
    character.status === "retired"
  );
}
