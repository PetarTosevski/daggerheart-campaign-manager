"use client";

import { rollVolume } from "./settings";

/** The dice-roll sound (public/sounds/dice-roll.wav, chosen by the user 2026-10-18), shared by the 3D and 2D rolls. */
const ROLL_SOUND = "/sounds/dice-roll.wav";

let audio: HTMLAudioElement | null = null;

/**
 * Plays the dice-roll sound from the start at `volume` (0-100; by default the account's dice volume, as the mounted
 * dice settings last read it). Silent at 0, and where audio is unavailable or blocked by the browser.
 */
export function playRollSound(volume: number = rollVolume()): void {
  try {
    if (typeof Audio !== "function") return;
    const level = Math.min(1, Math.max(0, volume / 100));
    if (!(level > 0)) return;
    audio ??= new Audio(ROLL_SOUND);
    audio.volume = level;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay blocked or no audio device: rolls stay silent.
    });
  } catch {
    // No audio on this device: rolls stay silent.
  }
}
