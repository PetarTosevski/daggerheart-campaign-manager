import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { PasswordForm, RESEND_COOLDOWN_SECONDS } from "../../src/features/auth/password-form";

const mockSignIn = jest.fn((_provider: string, _params?: Record<string, unknown>) =>
  Promise.resolve({ signingIn: false }),
);

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn }),
}));

beforeEach(() => {
  mockSignIn.mockReset();
  mockSignIn.mockResolvedValue({ signingIn: false });
});

test("reset sends a code, then sets the new password", async () => {
  const screen = await render(<PasswordForm />);
  await fireEvent.press(screen.getByRole("button", { name: "Forgot password?" }));
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
  expect(await screen.findByText(/If ana@x.com has an account/)).toBeTruthy();
  expect(mockSignIn).toHaveBeenCalledWith("password", { flow: "reset", email: "ana@x.com" });
  expect(screen.queryByText(/does not have an account/)).toBeNull();

  await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
  await fireEvent.changeText(screen.getByLabelText("New password"), "brand-new-pass");
  mockSignIn.mockResolvedValueOnce({ signingIn: true });
  await fireEvent.press(screen.getByRole("button", { name: "Set password" }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenLastCalledWith("password", {
      flow: "reset-verification",
      email: "ana@x.com",
      code: "123456",
      newPassword: "brand-new-pass",
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

test("resend during reset asks for another code after the cooldown", async () => {
  jest.useFakeTimers();
  try {
    const screen = await render(<PasswordForm />);
    await fireEvent.press(screen.getByRole("button", { name: "Forgot password?" }));
    await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("button", { name: `Resend code in ${RESEND_COOLDOWN_SECONDS}s` })).toBeDisabled();
    for (let second = 0; second < RESEND_COOLDOWN_SECONDS; second += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
    }
    mockSignIn.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Resend code" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockSignIn).toHaveBeenCalledWith("password", { flow: "reset", email: "ana@x.com" });
    expect(screen.getByText("We sent a new code.")).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});
