// Config AF1: feature switches take effect in the client. `useFeature(key)` reads `features.mine` (loading = on);
// 3D dice off forces 3D off whatever Preferences say and hides the 3D toggles; Phone layout off keeps the tablet HUD at
// phone width; Lorekeeper internet search off hides the composer's toggle. docs/tasks/TASK-CONFIG-AF1.md.
import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FEATURE_KEYS, type FeatureKey } from "@/lib/admin/features";
import { WEB_TOGGLE_GROUP_LABEL } from "@/lib/lorekeeper/copy";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const store = new Map<string, unknown>();

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => store.get(functionName(ref)),
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

const { featureFlagOn, useFeature } = await import("@/lib/use-feature");
const { useDiceSettings } = await import("@/components/party/dice/settings");
const { BoardDiceToggles, DiceSettingsToggles } = await import("@/components/party/dice/parts");
const { usePhoneHud } = await import("@/components/combat-map/hud/phone/media");
const { Composer } = await import("@/components/lorekeeper/composer/composer");

const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Record<FeatureKey, boolean>;
/** `features.mine` answering with `off` switched off. */
function mine(...off: FeatureKey[]) {
  const flags = allOn();
  for (const key of off) flags[key] = false;
  store.set("features:mine", flags);
}
const PREFS = { dice3d: true, diceSound: false, diceVolume: 60 };

function phoneWidth(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

beforeEach(() => store.clear());
afterEach(() => vi.unstubAllGlobals());

describe("useFeature", () => {
  it("is on while features.mine loads, so nothing flickers off for everyone", () => {
    for (const key of FEATURE_KEYS) expect(renderHook(() => useFeature(key)).result.current).toBe(true);
  });

  it("follows the caller's flags once loaded", () => {
    mine("dice3d", "lorekeeperWeb");
    expect(renderHook(() => useFeature("dice3d")).result.current).toBe(false);
    expect(renderHook(() => useFeature("lorekeeperWeb")).result.current).toBe(false);
    expect(renderHook(() => useFeature("phoneLayout")).result.current).toBe(true);
  });

  it("falls back to on for anything that is not a flags object", () => {
    for (const value of [undefined, null, "x", 3, {}, { dice3d: "no" }]) expect(featureFlagOn(value, "dice3d")).toBe(true);
    expect(featureFlagOn({ dice3d: false }, "dice3d")).toBe(false);
  });
});

describe("3D dice switch", () => {
  it("off forces 3D off whatever Preferences say, and keeps sound and volume", () => {
    store.set("preferences:get", PREFS);
    mine("dice3d");
    const [settings] = renderHook(() => useDiceSettings()).result.current;
    expect(settings).toEqual({ threeD: false, sound: false, volume: 60 });
  });

  it("off forces 3D off while Preferences load too", () => {
    mine("dice3d");
    expect(renderHook(() => useDiceSettings()).result.current[0].threeD).toBe(false);
  });

  it("on leaves Preferences in charge", () => {
    store.set("preferences:get", PREFS);
    mine();
    expect(renderHook(() => useDiceSettings()).result.current[0]).toEqual({ threeD: true, sound: false, volume: 60 });
  });

  it("off hides the 3D toggles and keeps the sound toggle", () => {
    store.set("preferences:get", PREFS);
    mine("dice3d");
    render(
      <>
        <DiceSettingsToggles />
        <BoardDiceToggles />
      </>,
    );
    expect(screen.queryByRole("checkbox", { name: /3D dice/ })).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: /Dice sound/ })).toHaveLength(2);
  });

  it("on shows the 3D toggles", () => {
    store.set("preferences:get", PREFS);
    mine();
    render(<DiceSettingsToggles />);
    expect(screen.getByRole("checkbox", { name: /3D dice/ })).toBeTruthy();
  });
});

describe("Phone layout switch", () => {
  it("on: the phone HUD at phone width", () => {
    phoneWidth(true);
    mine();
    expect(renderHook(() => usePhoneHud()).result.current).toBe(true);
  });

  it("off: the tablet HUD at phone width", () => {
    phoneWidth(true);
    mine("phoneLayout");
    expect(renderHook(() => usePhoneHud()).result.current).toBe(false);
  });

  it("wider than a phone it is the tablet / desktop HUD either way", () => {
    phoneWidth(false);
    mine();
    expect(renderHook(() => usePhoneHud()).result.current).toBe(false);
  });
});

describe("Lorekeeper internet search switch", () => {
  const props = {
    disabled: null,
    streaming: false,
    sending: false,
    onAsk: async () => true,
    webSearch: true,
    onWebSearch: () => {},
    visibility: null,
    notice: null,
    onNewConversation: () => {},
  };

  it("on (and allowed by the campaign) shows the toggle", () => {
    mine();
    render(<Composer {...props} />);
    expect(screen.getByRole("group", { name: WEB_TOGGLE_GROUP_LABEL })).toBeTruthy();
  });

  it("off hides the toggle even where the campaign allows the internet", () => {
    mine("lorekeeperWeb");
    render(<Composer {...props} webAllowed />);
    expect(screen.queryByRole("group", { name: WEB_TOGGLE_GROUP_LABEL })).toBeNull();
  });

  it("the campaign's own Off still hides it with the switch on", () => {
    mine();
    render(<Composer {...props} webAllowed={false} />);
    expect(screen.queryByRole("group", { name: WEB_TOGGLE_GROUP_LABEL })).toBeNull();
  });
});

describe("inert switches (N2 a)", () => {
  it("Journal and Share links gate nothing in the client: dice, HUD and composer ignore them", () => {
    store.set("preferences:get", PREFS);
    phoneWidth(true);
    mine("journal", "shareLinks");
    expect(renderHook(() => useDiceSettings()).result.current[0].threeD).toBe(true);
    expect(renderHook(() => usePhoneHud()).result.current).toBe(true);
    render(<Composer disabled={null} streaming={false} sending={false} onAsk={async () => true} webSearch onWebSearch={() => {}} visibility={null} notice={null} onNewConversation={() => {}} />);
    expect(screen.getByRole("group", { name: WEB_TOGGLE_GROUP_LABEL })).toBeTruthy();
  });
});
