import { beforeEach, expect, test } from "@jest/globals";
import { render } from "@testing-library/react-native";

import { resetMotionTest, setReducedMotion, timingCalls } from "../theme/mock-reanimated";
import { RollResult } from "../../src/ui/roll-result";
import { duration } from "../../src/theme/motion";

beforeEach(() => {
  resetMotionTest();
});

test("renders only the dice values it is given", async () => {
  const screen = await render(
    <RollResult
      dice={[
        { value: 9, sides: 12, role: "hope" },
        { value: 4, sides: 12, role: "fear" },
        { value: 2, sides: 6, role: "fear", dropped: true },
      ]}
    />,
  );
  expect(screen.getAllByText(/^\d+$/).map((node) => node.props.children)).toEqual(["9", "4", "2"]);
  expect(screen.queryByText("7")).toBeNull();
  expect(screen.queryByText("1")).toBeNull();
  expect(screen.queryByText("12")).toBeNull();
  expect(screen.getByLabelText("Hope d12: 9")).toBeTruthy();
  expect(screen.getByLabelText("Fear d12: 4")).toBeTruthy();
  expect(screen.getByLabelText("Fear d6: 2, not counted")).toBeTruthy();
  expect(screen.getAllByText("d12")).toHaveLength(2);
  expect(screen.getByText("d6")).toBeTruthy();
});

test("an empty roll renders no die values", async () => {
  const screen = await render(<RollResult dice={[]} />);
  expect(screen.queryByText(/^\d+$/)).toBeNull();
  expect(screen.getByLabelText("Dice")).toBeTruthy();
});

test("reduced motion sets the roll duration to 0", async () => {
  setReducedMotion(true);
  await render(<RollResult dice={[{ value: 8, sides: 12, role: "hope" }]} />);
  const seen = timingCalls().map((call) => call?.duration);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((value) => value === 0)).toBe(true);
});

test("a roll animates with the shared roll duration", async () => {
  await render(<RollResult dice={[{ value: 8, sides: 12, role: "hope" }]} />);
  expect(timingCalls().map((call) => call?.duration)).toContain(duration.roll);
});
