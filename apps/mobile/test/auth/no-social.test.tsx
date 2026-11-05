import { beforeEach, expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Platform } from "react-native";

import SignInScreen from "../../app/(auth)/sign-in";

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: jest.fn(() => Promise.resolve({ signingIn: false })) }),
}));

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_SOCIAL_SIGN_IN;
});

function expectNoSocialButtons(screen: Awaited<ReturnType<typeof render>>) {
  expect(screen.queryByText(/google/i)).toBeNull();
  expect(screen.queryByText(/apple/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
}

test("no Google or Apple button on iOS when social sign-in is off", async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => "ios" });
  try {
    expectNoSocialButtons(await render(<SignInScreen />));
  } finally {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
  }
});

test("no Google or Apple button on Android when social sign-in is off", async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => "android" });
  try {
    expectNoSocialButtons(await render(<SignInScreen />));
  } finally {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
  }
});
