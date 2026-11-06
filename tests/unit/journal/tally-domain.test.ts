// The Journal tally's counting rules (src/lib/domain/journal/tally.ts): Hope lost to a scar is not spent (dcm-z9rz.27),
// adversaries defeated during the session's windows, also in fights started earlier (dcm-z9rz.26).
import { describe, expect, it } from "vitest";

import { defeatsInWindows, hopePaid, type TallyEncounter } from "../../../src/lib/domain/journal/tally";

describe("hopePaid (dcm-z9rz.27)", () => {
  it("counts a plain drop and a declared spend, never below 0", () => {
    expect(hopePaid({ hope: 4, scars: 0 }, { hope: 2, scars: 0 }, 0)).toBe(2);
    expect(hopePaid({ hope: 2, scars: 0 }, { hope: 3, scars: 0 }, 1)).toBe(1);
    expect(hopePaid({ hope: 2, scars: 0 }, { hope: 5, scars: 0 }, 0)).toBe(0);
  });

  it("does not count Hope a scar's closed slot took", () => {
    expect(hopePaid({ hope: 6, scars: 0 }, { hope: 5, scars: 1 }, 0)).toBe(0);
    // Hope below the slots left: the scar took nothing, a spend in the same save still counts.
    expect(hopePaid({ hope: 4, scars: 0 }, { hope: 3, scars: 1 }, 0)).toBe(1);
    // Paid and capped in one save: only the paid part.
    expect(hopePaid({ hope: 6, scars: 0 }, { hope: 3, scars: 1 }, 0)).toBe(2);
    // Light in the Dark's extra slot widens the cap.
    expect(hopePaid({ hope: 7, scars: 0, hopeSlotBonus: 1 }, { hope: 6, scars: 1, hopeSlotBonus: 1 }, 0)).toBe(0);
  });
});

describe("defeatsInWindows (dcm-z9rz.26)", () => {
  const W = { from: 100, to: 200, open: false };
  const inst = (id: string, defeated: boolean, extra: { hp?: number; minionCount?: number; hpMax?: number } = {}) => ({
    id,
    defeated,
    hp: extra.hp ?? 0,
    hpMax: extra.hpMax ?? 5,
    ...(extra.minionCount !== undefined ? { minionCount: extra.minionCount } : {}),
  });

  it("an encounter started in the window counts every defeat", () => {
    const e: TallyEncounter = { startedAt: 120, endedAt: 180, instances: [inst("a", true), inst("b", false), inst("m", false, { minionCount: 4, hpMax: 4, hp: 3 })] };
    expect(defeatsInWindows([e], [], [W])).toBe(1 + 3);
  });

  it("a fight started earlier counts only what fell in the window", () => {
    const e: TallyEncounter = { startedAt: 50, instances: [inst("a", true), inst("b", true), inst("c", true)] };
    const snaps = [
      { instanceId: "a", at: 110, hp: 1, defeated: false }, // alive in the window, defeated now
      { instanceId: "c", at: 150, hp: 1, defeated: false },
      { instanceId: "c", at: 250, hp: 1, defeated: false }, // still alive after the window
    ];
    expect(defeatsInWindows([e], snaps, [W])).toBe(1);
    // The open window ends now: c's later snapshot is not "after" it.
    expect(defeatsInWindows([e], snaps.slice(0, 2), [{ from: 100, to: 300, open: true }])).toBe(2);
  });

  it("leaves out encounters that never ran in a window", () => {
    const before: TallyEncounter = { startedAt: 10, endedAt: 50, instances: [inst("a", true)] };
    const after: TallyEncounter = { startedAt: 300, instances: [inst("b", true)] };
    const never: TallyEncounter = { instances: [inst("c", true)] };
    expect(defeatsInWindows([before, after, never], [], [W])).toBe(0);
  });
});
