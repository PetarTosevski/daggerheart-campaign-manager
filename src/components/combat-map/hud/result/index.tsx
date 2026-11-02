import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H4.1 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The result panel of a card or attack (Main 'Card result'); players see Hit / Miss / Defeated, never adversary numbers. */
export const HudResult: (props: HudPartProps) => ReactNode = () => null;
