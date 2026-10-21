/**
 * The rip's paper-tear sound (board Notes.dc.html l.172-191, B8): filtered, crackly noise synthesised with Web Audio,
 * no audio file. Call it only from the user's click (browsers allow audio after a gesture) and never under reduced
 * motion (the caller checks). Any failure is silent: the sound is decoration.
 */

type AudioContextCtor = typeof AudioContext;

let shared: AudioContext | null = null;

export function playTear(): void {
  try {
    const AC: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!AC) return;
    const ctx = shared ?? (shared = new AC());
    if (ctx.state === "suspended") void ctx.resume();
    const dur = 1.05;
    const sr = ctx.sampleRate;
    const n = Math.floor(dur * sr);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let grain = 0;
    let next = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (i >= next) {
        grain = Math.random() < 0.18 ? 1 : 0.15 + Math.random() * 0.55;
        next = i + Math.floor(sr * (0.002 + Math.random() * 0.007));
      }
      const env = Math.min(1, t / 0.025) * (t < 0.12 ? 0.55 : t < 0.75 ? 0.75 + 0.25 * Math.sin(t * 9) : Math.max(0, 1 - (t - 0.75) / 0.3));
      const w = Math.random() * 2 - 1;
      lp = lp * 0.55 + w * 0.45;
      d[i] = (w * 0.6 + lp * 0.4) * grain * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 700;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(2600, ctx.currentTime);
    bp.frequency.linearRampToValueAtTime(1500, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start();
  } catch {
    // No sound; the tear still happens.
  }
}
