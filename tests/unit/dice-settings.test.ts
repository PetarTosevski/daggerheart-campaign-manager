// Plan config U6a: the dice settings come from the account. useDiceSettings reads preferences.get (loading: today's
// defaults, 3D off when the device or the account's Reduce motion asks for less motion), writes one preferences.set
// per changed field with an optimistic update, never touches localStorage; playRollSound plays at the account's volume
// (silent at 0).
import { act, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREFERENCE_DEFAULTS } from "@/lib/config/preferences";
import { REDUCE_MOTION_ATTR } from "@/lib/use-reduced-motion";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const store = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
const calls: { name: string; args: Record<string, unknown> }[] = [];

const keyOf = (ref: unknown, args: unknown) => `${functionName(ref)}:${JSON.stringify(args)}`;
function write(key: string, value: unknown) {
  store.set(key, value);
  version++;
  for (const l of listeners) l();
}
function useVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    useVersion();
    return store.get(keyOf(ref, args));
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    let update: ((s: unknown, args: Record<string, unknown>) => void) | null = null;
    const fake = { getQuery: (q: unknown, a: unknown) => store.get(keyOf(q, a)), setQuery: (q: unknown, a: unknown, value: unknown) => write(keyOf(q, a), value) };
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      update?.(fake, args);
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (s: unknown, args: Record<string, unknown>) => void) => {
        update = fn;
        return run;
      },
    });
  },
}));

const { canAnimate3d, rollVolume, useDiceSettings } = await import("@/components/party/dice/settings");
const { playRollSound } = await import("@/components/party/dice/sound");

const GET = `preferences:get:${JSON.stringify({})}`;
let reducedMotion = false;

/** A fake HTMLAudioElement that records its volume and plays. */
const played: number[] = [];
class FakeAudio {
  volume = 1;
  currentTime = 0;
  constructor(public src: string) {}
  play() {
    played.push(this.volume);
    return Promise.resolve();
  }
}

beforeEach(() => {
  store.clear();
  calls.length = 0;
  played.length = 0;
  reducedMotion = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reducedMotion,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(REDUCE_MOTION_ATTR);
});

describe("useDiceSettings", () => {
  it("uses today's defaults while the account loads: 3D on, sound off, volume 60", () => {
    const { result } = renderHook(() => useDiceSettings());
    expect(result.current[0]).toEqual({ threeD: true, sound: false, volume: 60 });
  });

  it("turns 3D off by default while loading when the device asks for reduced motion", () => {
    reducedMotion = true;
    const { result } = renderHook(() => useDiceSettings());
    expect(result.current[0].threeD).toBe(false);
    expect(canAnimate3d({ threeD: true, sound: false, volume: 60 })).toBe(false);
  });

  it("turns 3D off when the account's Reduce motion is on, even when the device doesn't ask (U6b)", () => {
    document.documentElement.setAttribute(REDUCE_MOTION_ATTR, "");
    const { result } = renderHook(() => useDiceSettings());
    expect(result.current[0].threeD).toBe(false);
    expect(canAnimate3d({ threeD: true, sound: false, volume: 60 })).toBe(false);
    document.documentElement.removeAttribute(REDUCE_MOTION_ATTR);
    expect(canAnimate3d({ threeD: true, sound: false, volume: 60 })).toBe(true);
  });

  it("reads the account's values", () => {
    store.set(GET, { ...PREFERENCE_DEFAULTS, dice3d: false, diceSound: true, diceVolume: 35, legacyImported: true });
    const { result } = renderHook(() => useDiceSettings());
    expect(result.current[0]).toEqual({ threeD: false, sound: true, volume: 35 });
    expect(canAnimate3d(result.current[0])).toBe(false);
    expect(rollVolume()).toBe(35);
  });

  it("saves one preferences.set per changed field, optimistically", () => {
    store.set(GET, { ...PREFERENCE_DEFAULTS, legacyImported: false });
    const { result } = renderHook(() => useDiceSettings());
    act(() => result.current[1]({ threeD: false, sound: true }));
    expect(calls).toEqual([
      { name: "preferences:set", args: { change: { key: "dice3d", value: false } } },
      { name: "preferences:set", args: { change: { key: "diceSound", value: true } } },
    ]);
    expect(result.current[0]).toEqual({ threeD: false, sound: true, volume: 60 });
    act(() => result.current[1]({ volume: 140 }));
    expect(calls.at(-1)).toEqual({ name: "preferences:set", args: { change: { key: "diceVolume", value: 100 } } });
  });

  it("never reads or writes localStorage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    store.set(GET, { ...PREFERENCE_DEFAULTS, legacyImported: false });
    const { result } = renderHook(() => useDiceSettings());
    act(() => result.current[1]({ sound: true }));
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("playRollSound", () => {
  it("plays at the given volume and stays silent at 0", () => {
    playRollSound(50);
    playRollSound(0);
    playRollSound(100);
    expect(played).toEqual([0.5, 1]);
  });

  it("defaults to the account's volume as the mounted dice settings read it", () => {
    store.set(GET, { ...PREFERENCE_DEFAULTS, diceVolume: 20, legacyImported: false });
    renderHook(() => useDiceSettings());
    playRollSound();
    expect(played).toEqual([0.2]);
  });
});
