import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { Id } from "../../../convex";

type Targets = {
  targetTokenId: Id<"combatTokens"> | null;
  setTargetTokenId: (id: Id<"combatTokens"> | null) => void;
};

const Ctx = createContext<Targets>({ targetTokenId: null, setTargetTokenId: () => {} });

export function PlayTargetsProvider({ children }: { children: ReactNode }) {
  const [targetTokenId, setTargetTokenId] = useState<Id<"combatTokens"> | null>(null);
  const value = useMemo(() => ({ targetTokenId, setTargetTokenId }), [targetTokenId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayTargets(): Targets {
  return useContext(Ctx);
}
