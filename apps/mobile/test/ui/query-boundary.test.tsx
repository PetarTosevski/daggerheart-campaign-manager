import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import type { ConvexError as ConvexErrorClass } from "convex/values";
import path from "node:path";
import { useEffect } from "react";
import { Text } from "react-native";

import { errorMessage } from "../../../../src/lib/convex-errors";
import { resetMotionTest } from "../theme/mock-reanimated";
import { QueryBoundary } from "../../src/ui/query-boundary";

/**
 * `errorMessage` checks `instanceof ConvexError` against the `convex` the website's `src/lib` resolves. Metro maps every
 * `convex/*` import to one copy (`metro.config.js` singletons); jest does not, so the test builds its errors from that
 * same copy.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConvexError } = require(
  require.resolve("convex/values", { paths: [path.resolve(__dirname, "../../../../src/lib")] }),
) as { ConvexError: typeof ConvexErrorClass };

let failure: unknown = null;
const onMount = jest.fn();

function Subtree() {
  if (failure !== null) throw failure;
  return <Text>Loaded</Text>;
}

function Counted() {
  useEffect(() => {
    onMount();
  }, []);
  return <Subtree />;
}

beforeEach(() => {
  resetMotionTest();
  failure = null;
  onMount.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

test("a ConvexError shows the code's text from the website's errorMessage, not the code", async () => {
  failure = new ConvexError({ code: "FORBIDDEN" });
  const screen = await render(
    <QueryBoundary title="Fear">
      <Subtree />
    </QueryBoundary>,
  );
  expect(await screen.findByRole("header", { name: "Fear" })).toBeTruthy();
  expect(screen.queryByText("Loaded")).toBeNull();
  expect(errorMessage(failure)).not.toBe("Something went wrong. Check your connection and try again.");
  expect(screen.getByText(errorMessage(failure))).toBeTruthy();
  expect(screen.queryByText(/FORBIDDEN/)).toBeNull();
});

test("an error that is not a ConvexError shows the connection message, never the raw server text", async () => {
  failure = new Error("Server Error: internal stack trace");
  const screen = await render(
    <QueryBoundary>
      <Subtree />
    </QueryBoundary>,
  );
  expect(await screen.findByRole("header", { name: "Something went wrong" })).toBeTruthy();
  expect(screen.getByText("Something went wrong. Check your connection and try again.")).toBeTruthy();
  expect(screen.queryByText(/internal stack trace/)).toBeNull();
});

test("Try again mounts the subtree afresh and shows it once the query loads", async () => {
  failure = new ConvexError({ code: "NOT_FOUND", message: "That campaign is gone." });
  const screen = await render(
    <QueryBoundary>
      <Counted />
    </QueryBoundary>,
  );
  expect(await screen.findByText("That campaign is gone.")).toBeTruthy();
  const before = onMount.mock.calls.length;
  failure = null;
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Loaded")).toBeTruthy();
  expect(onMount.mock.calls.length).toBeGreaterThan(before);
});

test("Try again on a query that still fails shows the error again", async () => {
  failure = new ConvexError({ code: "NOT_FOUND", message: "That campaign is gone." });
  const screen = await render(
    <QueryBoundary>
      <Subtree />
    </QueryBoundary>,
  );
  await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByText("That campaign is gone.")).toBeTruthy();
  expect(screen.queryByText("Loaded")).toBeNull();
});
