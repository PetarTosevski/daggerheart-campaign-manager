"use client";

/** A short rattle for a 2D roll, made with Web Audio (no asset). Silent where audio is unavailable. */
export function playRollSound(): void {
  try {
    const Ctx = window.AudioContext;
    if (typeof Ctx !== "function") return;
    const audio = new Ctx();
    const start = audio.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "triangle";
      osc.frequency.value = 520 + i * 90;
      const at = start + i * 0.06;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.06);
    }
    window.setTimeout(() => void audio.close(), 500);
  } catch {
    // No audio on this device: rolls stay silent.
  }
}
