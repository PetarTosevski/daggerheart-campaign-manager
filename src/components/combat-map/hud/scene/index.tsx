import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders only the toolbar the shell hands it; H1.2 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** Props of the scene region: the page state plus the HUD toolbar the shell builds (Map tools, the classic switch). */
export type HudSceneProps = HudPartProps & { toolbar: ReactNode };

/** The title (map name, Live · session), Dice and Sheet at x = 690, the GM toolbar and the day / time disc beside the Fear banner (Main, GMDesktop). Until H1.2 lands it shows only the toolbar. */
export const HudScene = ({ toolbar }: HudSceneProps): ReactNode => <div className="hud-toolbar">{toolbar}</div>;
