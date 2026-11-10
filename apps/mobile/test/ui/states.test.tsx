import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { resetMotionTest } from "../theme/mock-reanimated";
import { Empty } from "../../src/ui/empty";
import { ErrorState } from "../../src/ui/error-state";
import { Loading } from "../../src/ui/loading";
import { StaleBanner } from "../../src/ui/stale-banner";

beforeEach(() => {
  resetMotionTest();
});

test("loading, empty, error, and stale states render their copy", async () => {
  const onRetry = jest.fn();
  const screen = await render(
    <>
      <Loading label="Loading Fear" />
      <Empty message="Add a character when someone sits down." title="No one at the table" />
      <ErrorState message="The campaign could not load." onRetry={onRetry} title="Something went wrong" />
      <StaleBanner />
    </>,
  );

  expect(screen.getByRole("progressbar", { name: "Loading Fear" })).toBeTruthy();
  expect(screen.getByRole("header", { name: "No one at the table" })).toBeTruthy();
  expect(screen.getByText("Add a character when someone sits down.")).toBeTruthy();
  expect(screen.getByRole("header", { name: "Something went wrong" })).toBeTruthy();
  expect(screen.getByText("The campaign could not load.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Showing the last update.")).toBeTruthy();
});

test("error state without a retry hides the button, and empty state can omit the detail", async () => {
  const screen = await render(
    <>
      <Empty title="No notes" />
      <ErrorState message="Try again later." title="Notes failed" />
      <StaleBanner message="Offline. Showing the last update." />
    </>,
  );
  expect(screen.getByRole("header", { name: "No notes" })).toBeTruthy();
  expect(screen.queryByText("Try again")).toBeNull();
  expect(screen.getByText("Offline. Showing the last update.")).toBeTruthy();
});
