import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H4.3 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** "Just now" bottom-left on the player view; Resolutions with Undo under the queue on the GM view. */
export const HudFeed: (props: HudPartProps) => ReactNode = () => null;
