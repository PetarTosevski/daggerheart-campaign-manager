import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H1.2 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The GM's Fear as a purple banner, top-right; − / + on the GM view only (CmpTokens 'Fear banner'). */
export const HudFear: (props: HudPartProps) => ReactNode = () => null;
