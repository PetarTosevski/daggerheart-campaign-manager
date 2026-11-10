import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { resetMotionTest, setReducedMotion, timingCalls } from "../theme/mock-reanimated";
import { Button, type ButtonSize, type ButtonVariant } from "../../src/ui/button";
import { duration } from "../../src/theme/motion";

beforeEach(() => {
  resetMotionTest();
});

const variants: ButtonVariant[] = ["primary", "solid", "outline", "pill", "danger", "dangerSolid"];
const sizes: ButtonSize[] = ["md", "lg"];

test("every button is at least 44 points tall", async () => {
  const screen = await render(
    <>
      {variants.flatMap((variant) =>
        sizes.map((size) => (
          <Button key={`${variant}-${size}`} onPress={() => undefined} size={size} variant={variant}>
            {`${variant} ${size}`}
          </Button>
        )),
      )}
    </>,
  );
  for (const variant of variants) {
    for (const size of sizes) {
      const button = screen.getByRole("button", { name: `${variant} ${size}` });
      const style = StyleSheet.flatten(button.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  }
  const primary = StyleSheet.flatten(screen.getByRole("button", { name: "primary md" }).props.style);
  expect(primary.backgroundColor).toBe("#e3b45a");
});

test("press calls onPress and a disabled button does not", async () => {
  const onPress = jest.fn();
  const screen = await render(
    <>
      <Button onPress={onPress}>Resume</Button>
      <Button disabled onPress={onPress}>
        Wait
      </Button>
    </>,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Resume" }));
  await fireEvent.press(screen.getByRole("button", { name: "Wait" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("reduced motion sets the press duration to 0", async () => {
  setReducedMotion(true);
  const screen = await render(<Button onPress={() => undefined}>Resume</Button>);
  await fireEvent(screen.getByRole("button", { name: "Resume" }), "pressIn");
  expect(timingCalls().map((call) => call?.duration)).toEqual([0]);
});

test("a press uses the shared press duration", async () => {
  const screen = await render(<Button onPress={() => undefined}>Resume</Button>);
  await fireEvent(screen.getByRole("button", { name: "Resume" }), "pressIn");
  expect(timingCalls().map((call) => call?.duration)).toEqual([duration.press]);
});
