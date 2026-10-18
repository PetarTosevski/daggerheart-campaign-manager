// The 3D dice seam (D5 T1; T1b fills it). The dice box calls `play3d` after
// the server answered, so the animation always lands on the server's values.
//
// Contract for T1b:
// - Keep this signature. Reach three and cannon-es only through dynamic
//   `import()` inside this folder, so the sheet and dashboard chunks never
//   contain them (CL8).
// - Resolve `true` once the dice have settled on `dice` (and play the sound
//   only when `sound` is set); resolve `false` when 3D can't run (no WebGL,
//   an import failure): the caller then shows the 2D result and its sound.
// - The caller already skips `play3d` when the per-device toggle is off or the
//   device asks for reduced motion (settings.ts `canAnimate3d`).
//
// ```ts
// const shown = canAnimate3d(settings) && (await play3d(container, { dice: roll.dice, sound: settings.sound }));
// if (!shown && settings.sound) playRollSound();
// ```

import type { RolledDie } from "@/lib/domain/duality";

export type Play3dRequest = { dice: readonly RolledDie[]; sound: boolean };

/** Animates the roll in 3D inside `container`; T1 has no 3D yet, so it always answers `false` (2D). */
export async function play3d(container: HTMLElement, request: Play3dRequest): Promise<boolean> {
  void container;
  void request;
  return false;
}
