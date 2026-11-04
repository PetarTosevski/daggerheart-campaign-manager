"use client";

/**
 * The map's hit flashes (plan combat-actions AA5), drawn in the HUD's map layers for the GM and every player.
 *
 * Plan combat-hud H8.2 (cut-over, GM side): the GM column's "Adversaries" card (the selected adversary's Attack, feature
 * Use buttons, Fear questions, reaction windows and keyword asks), the GM's own-PC hit card and the "Adversary actions"
 * Resolutions card are gone: the HUD's stat block (`hud/statblock`), hit window (`hud/hit`) and "Waiting on you" queue
 * with its Resolutions (`hud/queue`) do that now. The shared model (`model.ts`, `sight.ts`) stays: the HUD reads it.
 */
export { HitFlashLayer } from "./flash";
