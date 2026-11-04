/**
 * Whether the signed-in caller is the app owner, for the admin page's cosmetic gate (CF22: the server is the gate;
 * every admin function refuses a non-owner with FORBIDDEN, AD0). `undefined` while loading.
 *
 * ---- AD0 STUB: swap at merge -----------------------------------------------------------------------------------
 * AD0 adds `convex/appAdmin.ts` with `appAdmin.me` (a `maybeUserQuery` returning `{ isOwner }` for the caller). Until
 * it merges there is no such query, so this stub says "not the owner" for everyone: the page shows 'Not allowed' and
 * no admin content renders. When AD0 is merged (and `convex/_generated` regenerated), replace the body with:
 *
 *   import { useQuery } from "convex/react";
 *   import { api } from "../../../../convex/_generated/api";
 *   export function useAppOwner(): AppOwnerState | null | undefined {
 *     return useQuery(api.appAdmin.me);
 *   }
 *
 * (`null` is accepted too, in case `me` answers a signed-out caller with null.) Nothing else in the shell changes.
 * -----------------------------------------------------------------------------------------------------------------
 */
export type AppOwnerState = { isOwner: boolean };

const NOT_OWNER: AppOwnerState = { isOwner: false };

export function useAppOwner(): AppOwnerState | null | undefined {
  return NOT_OWNER;
}
