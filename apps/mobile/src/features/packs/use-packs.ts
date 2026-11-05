import { useMutation } from "convex/react";

import { api } from "../../convex";
import type { Id } from "../../convex";

/** Pack and sprite mutations (website parity without optimistic local store updates on phone). */
export function usePackMutations(_campaignId: Id<"campaigns">) {
  return {
    renamePack: useMutation(api.spritePacks.renamePack),
    setPackExtends: useMutation(api.spritePacks.setPackExtends),
    deletePack: useMutation(api.spritePacks.deletePack),
    updateSprite: useMutation(api.spritePacks.updateSprite),
    removeSprite: useMutation(api.spritePacks.removeSprite),
    reorderSprite: useMutation(api.spritePacks.reorderSprite),
  };
}
