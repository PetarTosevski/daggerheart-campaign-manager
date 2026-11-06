import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";

/**
 * Whether the signed-in caller is the app owner, for the admin page's cosmetic gate (CF22: the server is the gate;
 * every admin function refuses a non-owner with FORBIDDEN, AD0). `undefined` while loading, `null` when signed out.
 */
export type AppOwnerState = { isOwner: boolean };

export function useAppOwner(): AppOwnerState | null | undefined {
  return useQuery(api.appAdmin.me);
}
