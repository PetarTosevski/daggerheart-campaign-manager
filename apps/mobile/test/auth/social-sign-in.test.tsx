import fs from "node:fs";
import path from "node:path";

import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";

import SignInScreen from "../../app/(auth)/sign-in";
import { googleRedirectTo, oauthCode } from "../../src/auth/google";

type Started = { signingIn: boolean; redirect?: URL };
type BrowserSession = { type: "success"; url: string } | { type: "cancel" | "dismiss" };

const mockSignIn = jest.fn((_provider: string, _params?: Record<string, unknown>): Promise<Started> =>
  Promise.resolve({ signingIn: false }),
);
const mockOpenAuthSession = jest.fn(
  (_url: string, _redirect?: string, _options?: Record<string, unknown>): Promise<BrowserSession> =>
    Promise.resolve({ type: "cancel" }),
);
const mockAppleSignIn = jest.fn((_options?: Record<string, unknown>) =>
  Promise.resolve({
    identityToken: "header.payload.sig",
    fullName: {
      givenName: "Ada",
      familyName: "Lovelace",
      namePrefix: null,
      middleName: null,
      nameSuffix: null,
      nickname: null,
    },
    email: "ada@example.com",
    user: "apple-user",
    authorizationCode: "code",
    realUserStatus: 1,
    state: null,
  }),
);

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn }),
}));

jest.mock("expo-constants", () => ({
  expoConfig: { scheme: "dualityheart" },
}));

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (url: string, redirectUrl?: string, options?: Record<string, unknown>) =>
    mockOpenAuthSession(url, redirectUrl, options),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "raw-nonce",
  digestStringAsync: () => Promise.resolve("hashed-nonce"),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));

jest.mock("expo-apple-authentication", () => {
  // jest.mock is hoisted above imports, so the factory cannot reference them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native") as typeof import("react-native");
  return {
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) =>
      React.createElement(
        Pressable,
        { accessibilityRole: "button", accessibilityLabel: "Sign in with Apple", onPress },
        React.createElement(Text, null, "Sign in with Apple"),
      ),
    AppleAuthenticationButtonType: { SIGN_IN: 0 },
    AppleAuthenticationButtonStyle: { BLACK: 2 },
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    signInAsync: (options?: Record<string, unknown>) => mockAppleSignIn(options),
  };
});

beforeEach(() => {
  process.env.EXPO_PUBLIC_SOCIAL_SIGN_IN = "true";
  process.env.EXPO_PUBLIC_SITE_URL = "https://dualityheart.com/";
  mockSignIn.mockReset();
  mockOpenAuthSession.mockReset();
  mockAppleSignIn.mockReset();
  mockSignIn.mockResolvedValue({ signingIn: false });
  mockOpenAuthSession.mockResolvedValue({ type: "cancel" });
  mockAppleSignIn.mockResolvedValue({
    identityToken: "header.payload.sig",
    fullName: {
      givenName: "Ada",
      familyName: "Lovelace",
      namePrefix: null,
      middleName: null,
      nameSuffix: null,
      nickname: null,
    },
    email: "ada@example.com",
    user: "apple-user",
    authorizationCode: "code",
    realUserStatus: 1,
    state: null,
  });
});

function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

test("the redirect is the site's https return address, never a custom scheme", () => {
  expect(googleRedirectTo("https://dualityheart.com")).toBe("https://dualityheart.com/auth");
  expect(googleRedirectTo("https://dev.dualityheart.com/")).toBe("https://dev.dualityheart.com/auth");
  for (const site of ["dualityheart://", "http://dualityheart.com", "https://user@dualityheart.com", "not a url"]) {
    expect(() => googleRedirectTo(site)).toThrow(/Unsupported site URL/);
  }
});

test("only a return to the expected https address yields a code", () => {
  const redirectTo = "https://dualityheart.com/auth";
  expect(oauthCode("https://dualityheart.com/auth?code=abc", redirectTo)).toBe("abc");
  for (const url of [
    "dualityheart://auth?code=abc",
    "https://evil.test/auth?code=abc",
    "https://dualityheart.com/other?code=abc",
    "https://dualityheart.com/auth",
    "https://dualityheart.com/auth?code=",
    "garbage",
  ]) {
    expect(oauthCode(url, redirectTo)).toBeNull();
  }
});

test("a Google return through a custom scheme is ignored", async () => {
  setPlatform("ios");
  mockSignIn.mockResolvedValueOnce({
    signingIn: false,
    redirect: new URL("https://auth.example/api/auth/signin/google?code=verifier"),
  });
  mockOpenAuthSession.mockResolvedValueOnce({ type: "success", url: "dualityheart://auth?code=stolen" });
  const screen = await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Sign in with Google" }));
  await waitFor(() => expect(mockOpenAuthSession).toHaveBeenCalledTimes(1));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
});

test("iOS shows Google and Apple together", async () => {
  setPlatform("ios");
  const screen = await render(<SignInScreen />);
  expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign in with Apple" })).toBeTruthy();
});

test("Android shows Google only", async () => {
  setPlatform("android");
  const screen = await render(<SignInScreen />);
  expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
});

test("Google opens the system auth session and then exchanges the code", async () => {
  setPlatform("ios");
  mockSignIn.mockResolvedValueOnce({
    signingIn: false,
    redirect: new URL("https://auth.example/api/auth/signin/google?code=verifier"),
  });
  mockOpenAuthSession.mockResolvedValueOnce({ type: "success", url: "https://dualityheart.com/auth?code=oauth-code" });
  mockSignIn.mockResolvedValueOnce({ signingIn: true });
  const screen = await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Sign in with Google" }));
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(2));
  expect(mockSignIn).toHaveBeenNthCalledWith(1, "google", { redirectTo: "https://dualityheart.com/auth" });
  expect(mockOpenAuthSession).toHaveBeenCalledWith(
    "https://auth.example/api/auth/signin/google?code=verifier",
    "https://dualityheart.com/auth",
    { preferEphemeralSession: false, preferUniversalLinks: true },
  );
  expect(mockSignIn).toHaveBeenNthCalledWith(2, "google", { code: "oauth-code" });
  expect(mockAppleSignIn).not.toHaveBeenCalled();
});

test("Apple uses the native button and sends the raw nonce with the identity token", async () => {
  setPlatform("ios");
  mockSignIn.mockResolvedValueOnce({ signingIn: true });
  const screen = await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Sign in with Apple" }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenCalledWith("apple-native", {
      identityToken: "header.payload.sig",
      nonce: "raw-nonce",
      name: "Ada Lovelace",
    }),
  );
  expect(mockAppleSignIn).toHaveBeenCalledWith({
    requestedScopes: [0, 1],
    nonce: "hashed-nonce",
  });
  expect(mockOpenAuthSession).not.toHaveBeenCalled();
  expect(mockSignIn).not.toHaveBeenCalledWith("apple", expect.anything());
});

test("the sign-in sources do not open a webview or Apple's browser provider", () => {
  const appRoot = path.resolve(__dirname, "../..");
  const files = [
    path.join(appRoot, "app/auth.tsx"),
    ...listSources(path.join(appRoot, "src/auth")),
    ...listSources(path.join(appRoot, "src/features/auth")),
  ];
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  expect(source).toContain("openAuthSessionAsync");
  expect(source).toContain("AppleAuthenticationButton");
  expect(source).toContain('signIn("apple-native"');
  expect(source).not.toContain("openBrowserAsync");
  expect(source).not.toContain("WebView");
  expect(source).not.toMatch(/signIn\(\s*["']apple["']/);
});

function listSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}
