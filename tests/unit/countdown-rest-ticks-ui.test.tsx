// The GM's rest tick controls on the countdowns page (plan rest-ticks RT2, bead dcm-674k): the shared RestTickControl
// (Off / On, the four amount kinds, Automatic / Reminder) and the payloads it reports, the card's Rest ticks settings
// (one countdowns.setRestTick intent per change, optimistic on listByCampaign, a chase pair's both rows), and the rest
// panel's reminder text. docs/tasks/TASK-RT2.md.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REST_TICK,
  parseFixedTicks,
  RestTickControl,
  RestTickSettings,
  restTickSummary,
  restTickWithKind,
  withRestTick,
} from "../../src/app/(gm)/campaigns/[campaignId]/countdowns/rest-ticks";
import { reminderText } from "../../src/components/party/rest/long-term";
import type { RestTick } from "../../src/lib/domain/countdowns/rest-ticks";
import type { Id } from "../../convex/_generated/dataModel";
import type { CountdownView } from "../../convex/countdowns";

type Store = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };
const calls = vi.hoisted(() => ({
  list: [] as { name: string; args: Record<string, unknown> }[],
  optimistic: [] as ((store: Store, args: Record<string, unknown>) => void)[],
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: Store, args: Record<string, unknown>) => void) => {
        calls.optimistic.push(fn);
        return run;
      },
    });
  },
}));

beforeEach(() => {
  calls.list.length = 0;
  calls.optimistic.length = 0;
});
afterEach(cleanup);

const campaignId = "c1" as Id<"campaigns">;

/** A GM's view of a dashboard countdown, as listByCampaign returns it. */
function view(over: Partial<CountdownView> = {}): CountdownView {
  return {
    _id: "cd1" as Id<"countdowns">,
    _creationTime: 0,
    campaignId,
    name: "Storm",
    consequence: "",
    description: "",
    category: "threat",
    startingValue: 6,
    currentValue: 6,
    status: "active",
    completedAt: null,
    visibility: { mode: "public", hidden: [] },
    mode: "standard",
    armed: false,
    restMode: null,
    onLongRest: null,
    onShortRest: null,
    ...over,
  } as CountdownView;
}

/** Renders a control that keeps its value, like the create forms, and records each reported setting. */
function Harness({ initial, live, onReport }: { initial: RestTick | null; live: boolean; onReport: (s: RestTick | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <RestTickControl
      rest="short"
      value={value}
      live={live}
      onChange={(s) => {
        onReport(s);
        setValue(s);
      }}
    />
  );
}

describe("pure helpers", () => {
  it("switching kind keeps the number or the die it had, and starts a die on d6", () => {
    const fixed3: RestTick = { amount: { kind: "fixed", n: 3 }, mode: "remind" };
    expect(restTickWithKind(fixed3, "die")).toEqual({ amount: { kind: "die", sides: 6 }, mode: "remind" });
    expect(restTickWithKind(fixed3, "pcs")).toEqual({ amount: { kind: "pcs" }, mode: "remind" });
    expect(restTickWithKind(fixed3, "fixed")).toEqual(fixed3);
    const d8: RestTick = { amount: { kind: "die", sides: 8 }, mode: "auto" };
    expect(restTickWithKind(d8, "diePlusPcs")).toEqual({ amount: { kind: "diePlusPcs", sides: 8 }, mode: "auto" });
    expect(restTickWithKind(d8, "fixed")).toEqual({ amount: { kind: "fixed", n: 1 }, mode: "auto" });
  });

  it("the number field accepts whole numbers 1..20 only", () => {
    expect(parseFixedTicks("1")).toBe(1);
    expect(parseFixedTicks(" 20 ")).toBe(20);
    for (const bad of ["", "0", "21", "1.5", "-2", "x"]) expect(parseFixedTicks(bad)).toBeNull();
  });

  it("summaries name the amount and the mode", () => {
    expect(restTickSummary(null)).toBe("Off");
    expect(restTickSummary(DEFAULT_REST_TICK)).toBe("Fixed 1, Automatic");
    expect(restTickSummary({ amount: { kind: "diePlusPcs", sides: 6 }, mode: "remind" })).toBe("d6 + PCs who rested, Reminder");
  });

  it("withRestTick sets the field; on long-term the old clients' armed / restMode follow the long-rest setting", () => {
    const remind: RestTick = { amount: { kind: "pcs" }, mode: "remind" };
    expect(withRestTick(view(), "short", remind).onShortRest).toEqual(remind);
    expect(withRestTick(view(), "long", remind)).toMatchObject({ onLongRest: remind, armed: false, restMode: null });
    const lt = view({ mode: "longTerm", armed: true, restMode: "auto", onLongRest: DEFAULT_REST_TICK });
    expect(withRestTick(lt, "long", remind)).toMatchObject({ onLongRest: remind, armed: true, restMode: "remind" });
    expect(withRestTick(lt, "long", null)).toMatchObject({ onLongRest: null, armed: false, restMode: "auto" });
  });

  it("reminder text: amount and roll, or the amount alone for a fixed setting", () => {
    expect(reminderText({ name: "Storm", amount: 4, rollText: "1d6 2 + 2 PCs" })).toBe("Tick Storm? 4 (1d6 2 + 2 PCs)");
    expect(reminderText({ name: "Invasion", amount: 1, rollText: null })).toBe("Tick Invasion? 1");
  });
});

describe("RestTickControl", () => {
  it("Off shows only the switch; On reports the default setting", () => {
    const reports: (RestTick | null)[] = [];
    render(<Harness initial={null} live onReport={(s) => reports.push(s)} />);
    const group = screen.getByRole("group", { name: "On short rest" });
    expect(within(group).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).queryByLabelText("Ticks")).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "On" }));
    expect(reports).toEqual([DEFAULT_REST_TICK]);
    expect(within(group).getByLabelText("Ticks")).toHaveValue("fixed");
    expect(within(group).getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports each kind, the number, the die and the mode", () => {
    const reports: (RestTick | null)[] = [];
    render(<Harness initial={DEFAULT_REST_TICK} live onReport={(s) => reports.push(s)} />);
    const group = screen.getByRole("group", { name: "On short rest" });
    fireEvent.change(within(group).getByLabelText(/Number/), { target: { value: "5" } });
    fireEvent.change(within(group).getByLabelText(/Number/), { target: { value: "25" } }); // out of range: not reported
    fireEvent.change(within(group).getByLabelText("Ticks"), { target: { value: "pcs" } });
    expect(within(group).queryByLabelText("Die")).toBeNull();
    fireEvent.change(within(group).getByLabelText("Ticks"), { target: { value: "diePlusPcs" } });
    fireEvent.change(within(group).getByLabelText("Die"), { target: { value: "20" } });
    fireEvent.change(within(group).getByLabelText("Ticks"), { target: { value: "die" } });
    fireEvent.click(within(group).getByRole("button", { name: "Reminder" }));
    fireEvent.click(within(group).getByRole("button", { name: "Off" }));
    expect(reports).toEqual([
      { amount: { kind: "fixed", n: 5 }, mode: "auto" },
      { amount: { kind: "pcs" }, mode: "auto" },
      { amount: { kind: "diePlusPcs", sides: 6 }, mode: "auto" },
      { amount: { kind: "diePlusPcs", sides: 20 }, mode: "auto" },
      { amount: { kind: "die", sides: 20 }, mode: "auto" },
      { amount: { kind: "die", sides: 20 }, mode: "remind" },
      null,
    ]);
  });

  it("on the card (not live) the number is sent once, when the field is left or Enter is pressed", () => {
    const reports: (RestTick | null)[] = [];
    render(<Harness initial={DEFAULT_REST_TICK} live={false} onReport={(s) => reports.push(s)} />);
    const field = screen.getByLabelText(/Number/);
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.change(field, { target: { value: "12" } });
    expect(reports).toEqual([]);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(reports).toEqual([{ amount: { kind: "fixed", n: 12 }, mode: "auto" }]);
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);
    expect(reports).toHaveLength(1);
    expect(field).toHaveValue(12);
  });

  it("disabled: every control is off", () => {
    render(<RestTickControl rest="long" value={DEFAULT_REST_TICK} onChange={() => {}} live disabled />);
    const group = screen.getByRole("group", { name: "On long rest" });
    for (const b of within(group).getAllByRole("button")) expect(b).toBeDisabled();
    expect(within(group).getByLabelText("Ticks")).toBeDisabled();
  });
});

describe("RestTickSettings on a card", () => {
  it("sends one setRestTick per change and patches the countdown and its chase partner optimistically", () => {
    const party = view({ _id: "p" as Id<"countdowns">, chase: { partnerId: "r" as Id<"countdowns">, side: "party", party: "pursuing" } } as Partial<CountdownView>);
    const rivals = view({ _id: "r" as Id<"countdowns">, chase: { partnerId: "p" as Id<"countdowns">, side: "rivals", party: "pursuing" } } as Partial<CountdownView>);
    const other = view({ _id: "o" as Id<"countdowns"> });
    render(<RestTickSettings countdown={party} campaignId={campaignId} name="Chase: The thief" />);
    expect(screen.getByTestId("rest-tick-summary")).toHaveTextContent("Long rest: Off · Short rest: Off");
    fireEvent.click(screen.getByRole("button", { name: "Rest ticks of Chase: The thief" }));
    fireEvent.click(within(screen.getByRole("group", { name: "On long rest" })).getByRole("button", { name: "On" }));
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0].name).toBe("countdowns:setRestTick");
    expect(calls.list[0].args).toMatchObject({ campaignId, countdownId: "p", rest: "long", setting: DEFAULT_REST_TICK });
    expect(typeof calls.list[0].args.idempotencyKey).toBe("string");

    let written: CountdownView[] = [];
    const store: Store = { getQuery: () => [party, rivals, other], setQuery: (_r, _a, value) => (written = value as CountdownView[]) };
    calls.optimistic[0](store, calls.list[0].args);
    expect(written.map((c) => c.onLongRest)).toEqual([DEFAULT_REST_TICK, DEFAULT_REST_TICK, null]);
  });
});
