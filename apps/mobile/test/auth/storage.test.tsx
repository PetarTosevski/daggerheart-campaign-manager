import fs from "node:fs";
import path from "node:path";

import { beforeEach, expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Text } from "react-native";

import { AppAuthProvider } from "../../src/auth/provider";
import { secureTokenStorage } from "../../src/auth/secure-store";

const mockStorage = { current: undefined as unknown };

jest.mock("expo-crypto", () => ({
  getRandomValues: jest.fn((typedArray: Uint8Array) => typedArray),
  randomUUID: jest.fn(() => "11111111-1111-4111-8111-111111111111"),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock("expo/virtual/env", () => ({
  env: { EXPO_PUBLIC_CONVEX_URL: "https://test.convex.cloud" },
}));

jest.mock("convex/react", () => ({
  ConvexReactClient: jest.fn(),
}));

jest.mock("@convex-dev/auth/react", () => {
  // jest.mock is hoisted above imports, so the factory cannot reference them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  return {
    ConvexAuthProvider: ({
      storage,
      children,
    }: {
      storage?: unknown;
      children: import("react").ReactNode;
    }) => {
      mockStorage.current = storage;
      return React.createElement(React.Fragment, null, children);
    },
  };
});

const authDir = path.resolve(__dirname, "../../src/auth");

beforeEach(() => {
  mockStorage.current = undefined;
  jest.mocked(SecureStore.getItemAsync).mockClear();
  jest.mocked(SecureStore.setItemAsync).mockClear();
  jest.mocked(SecureStore.deleteItemAsync).mockClear();
});

test("stores tokens with expo-secure-store and does not log them", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);
  const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await secureTokenStorage.setItem("session", "super-secret-token");
    await expect(secureTokenStorage.getItem("session")).resolves.toBeNull();
    await secureTokenStorage.removeItem("session");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("session", "super-secret-token");
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith("session");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("session");
    const output = [...log.mock.calls, ...debug.mock.calls, ...info.mock.calls].flat().join(" ");
    expect(output).not.toContain("super-secret-token");
  } finally {
    log.mockRestore();
    debug.mockRestore();
    info.mockRestore();
  }
});

test("ConvexAuthProvider receives the secure-store storage", async () => {
  const screen = await render(
    <AppAuthProvider>
      <Text>child</Text>
    </AppAuthProvider>,
  );
  expect(screen.getByText("child")).toBeTruthy();
  expect(mockStorage.current).toBe(secureTokenStorage);
});

test("auth storage source does not use AsyncStorage", () => {
  const files = fs.readdirSync(authDir).filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"));
  const source = files.map((name) => fs.readFileSync(path.join(authDir, name), "utf8")).join("\n");
  expect(source).not.toMatch(/AsyncStorage/);
  expect(source).not.toMatch(/console\./);
  expect(source).toMatch(/expo-secure-store/);
  expect(source).toMatch(/expo-crypto/);
});
