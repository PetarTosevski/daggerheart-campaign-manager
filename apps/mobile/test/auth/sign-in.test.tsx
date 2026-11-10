import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import { PasswordForm } from "../../src/features/auth/password-form";

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

async function renderForm() {
  return render(<PasswordForm />);
}

test("the form scrolls clear of the keyboard and keeps taps on its buttons", async () => {
  const screen = await renderForm();
  const scroll = screen.getByTestId("sign-in-scroll");
  expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
  expect(screen.getByRole("header").props.children).toBe("Sign in with email");
});

test("signs in with email and password", async () => {
  mockSignIn.mockResolvedValueOnce({ signingIn: true });
  const screen = await renderForm();
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough-1");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenCalledWith("password", {
      flow: "signIn",
      email: "ana@x.com",
      password: "long-enough-1",
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByLabelText("6-digit code")).toBeNull();
});

test("an unverified sign-in continues to the emailed code", async () => {
  const screen = await renderForm();
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough-1");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByLabelText("6-digit code")).toBeTruthy();
  expect(screen.getByText("Enter the 6-digit code we emailed to ana@x.com.")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
  mockSignIn.mockResolvedValueOnce({ signingIn: true });
  await fireEvent.press(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenLastCalledWith("password", {
      flow: "email-verification",
      email: "ana@x.com",
      code: "123456",
    }),
  );
});

test("create account sends the sign-up, then the emailed code", async () => {
  const screen = await renderForm();
  await fireEvent.press(screen.getByRole("button", { name: "New here? Create an account" }));
  await fireEvent.changeText(screen.getByLabelText("Name"), "Ana");
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough-1");
  expect(screen.getByText("At least 8 characters.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByText("Enter the 6-digit code we emailed to ana@x.com.")).toBeTruthy();
  expect(mockSignIn).toHaveBeenCalledWith("password", {
    flow: "signUp",
    email: "ana@x.com",
    password: "long-enough-1",
    name: "Ana",
  });
  await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
  mockSignIn.mockResolvedValueOnce({ signingIn: true });
  await fireEvent.press(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenLastCalledWith("password", {
      flow: "email-verification",
      email: "ana@x.com",
      code: "123456",
    }),
  );
});

test("a taken email stays on the account form", async () => {
  mockSignIn.mockRejectedValueOnce(new ConvexError({ code: "EMAIL_TAKEN" }));
  const screen = await renderForm();
  await fireEvent.press(screen.getByRole("button", { name: "New here? Create an account" }));
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough-1");
  await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This email already has an account", {
    exact: false,
  });
  expect(screen.queryByLabelText("6-digit code")).toBeNull();
});

test("a wrong password says so, and a rate limit says to wait", async () => {
  const screen = await renderForm();
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "nope");
  mockSignIn.mockRejectedValueOnce(new Error("Server Error"));
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.", { exact: false });
  mockSignIn.mockRejectedValueOnce(new ConvexError({ code: "RATE_LIMITED" }));
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Wait a few minutes", { exact: false }),
  );
});

test("a wrong code says to request a new one", async () => {
  const screen = await renderForm();
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough-1");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByLabelText("6-digit code");
  mockSignIn.mockRejectedValueOnce(new ConvexError({ code: "CODE_INVALID" }));
  await fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
  await fireEvent.press(screen.getByRole("button", { name: "Verify email" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("wrong or has expired", { exact: false });
  expect(alert).toHaveTextContent("Request a new", { exact: false });
});
