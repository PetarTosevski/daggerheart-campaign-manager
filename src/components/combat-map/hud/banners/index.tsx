import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H1.1 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The party banners hanging from the gold rod, top-left (HANDOFF "Banners"; CmpTokens 'Banners'). */
export const HudBanners: (props: HudPartProps) => ReactNode = () => null;
