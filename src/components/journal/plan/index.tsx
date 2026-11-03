"use client";

import type { PlanAsideProps, PlanViewProps } from "../slots";

/** Plan view slot (JP1, contract: ../slots.ts). J1 stubs: render nothing until JP1 lands. */

/** Centre: planned scenes (a Combat scene mounts `SceneEncounter` from ./encounter) and the GM prep note. */
export const PlanView: (props: PlanViewProps) => React.ReactNode = () => null;

/** Right column: `BattlePointsPanel` from ./battle-points for the playing Combat scene, else the first one. */
export const PlanAside: (props: PlanAsideProps) => React.ReactNode = () => null;
