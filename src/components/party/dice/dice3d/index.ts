// The 3D dice seam (D5 T1; T1b fills it). The dice box calls `play3d` after
// the server answered, so the animation always lands on the server's values.
//
// Contract:
// - Keep this signature. three and cannon-es are reached only through the
//   dynamic `import("./scene")` below, so the sheet and dashboard chunks never
//   contain them (CL8; analyze numbers in docs/tasks/TASK-D5-T1b.md).
// - Resolves `true` once the dice have settled on `dice` (the sound plays only
//   when `sound` is set); resolves `false` when 3D can't run (reduced motion,
//   no WebGL, an import or render failure): the caller then shows the 2D result
//   and its sound. It never throws.
// - The caller already skips `play3d` when the per-device toggle is off or the
//   device asks for reduced motion (settings.ts `canAnimate3d`); reduced motion
//   is checked again here so no caller can animate against it (CL14).
//
// ```ts
// const shown = canAnimate3d(settings) && (await play3d(container, { dice: roll.dice, sound: settings.sound }));
// if (!shown && settings.sound) playRollSound();
// ```

import type { RolledDie } from "@/lib/domain/duality";

export type Play3dRequest = { dice: readonly RolledDie[]; sound: boolean };

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Probes for WebGL before downloading three, then releases the probe's context. */
function hasWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Animates the roll in 3D inside `container`, landing on the server's values; `false` means "show it in 2D". */
export async function play3d(container: HTMLElement, request: Play3dRequest): Promise<boolean> {
  if (request.dice.length === 0 || reducedMotion() || !hasWebGl()) return false;
  try {
    const { playScene } = await import("./scene");
    return await playScene(container, request);
  } catch {
    return false;
  }
}
