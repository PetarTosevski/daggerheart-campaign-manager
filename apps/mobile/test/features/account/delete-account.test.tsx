import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { DeleteAccount } from "../../../src/features/settings/delete-account";
import { OfflineFrame } from "../../../src/shell/offline";

const NOTICE = "Your account will be deleted.";

beforeEach(() => {
  resetMotionTest();
});

test("delete asks first; Cancel sends nothing, confirming calls the server and then leaves", async () => {
  const request = jest.fn(() => Promise.resolve(null));
  const onDeleted = jest.fn();
  const screen = await render(<DeleteAccount notice={NOTICE} onDeleted={onDeleted} request={request} />);

  await fireEvent.press(screen.getByRole("button", { name: "Delete account…" }));
  expect(screen.getByText(NOTICE)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText(NOTICE)).toBeNull();
  expect(request).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole("button", { name: "Delete account…" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledTimes(1);
});

test("a refused delete stays signed in and shows an alert", async () => {
  const onDeleted = jest.fn();
  const screen = await render(
    <DeleteAccount notice={NOTICE} onDeleted={onDeleted} request={() => Promise.reject(new Error("no"))} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Delete account…" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
  expect(await screen.findByText("Something went wrong. Check your connection and try again.")).toBeTruthy();
  expect(onDeleted).not.toHaveBeenCalled();
});

test("offline the delete button is disabled", async () => {
  const request = jest.fn(() => Promise.resolve(null));
  const screen = await render(
    <OfflineFrame offline>
      <DeleteAccount notice={NOTICE} onDeleted={() => undefined} request={request} />
    </OfflineFrame>,
  );
  const button = screen.getByRole("button", { name: "Delete account…" });
  expect(button.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(button);
  expect(screen.queryByText(NOTICE)).toBeNull();
});
