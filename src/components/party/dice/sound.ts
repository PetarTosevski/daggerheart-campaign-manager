"use client";

/** The dice-roll sound (public/sounds/dice-roll.wav, chosen by the user 2026-10-18), shared by the 3D and 2D rolls. */
const ROLL_SOUND = "/sounds/dice-roll.wav";

let audio: HTMLAudioElement | null = null;

/** Plays the dice-roll sound from the start. Silent where audio is unavailable or blocked by the browser. */
export function playRollSound(): void {
  try {
    if (typeof Audio !== "function") return;
    audio ??= new Audio(ROLL_SOUND);
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay blocked or no audio device: rolls stay silent.
    });
  } catch {
    // No audio on this device: rolls stay silent.
  }
}
