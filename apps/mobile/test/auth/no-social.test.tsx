import fs from "node:fs";
import path from "node:path";

import { expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Platform } from "react-native";

import SignInScreen from "../../app/(auth)/sign-in";

const mockSignIn = jest.fn((_provider: string, _params?: Record<string, unknown>) =>
  Promise.resolve({ signingIn: false }),
);

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn }),
}));

const appRoot = path.resolve(__dirname, "../..");
const sourceRoots = [
  path.join(appRoot, "app"),
  path.join(appRoot, "src/auth"),
  path.join(appRoot, "src/features/auth"),
  path.join(appRoot, "src/features/account"),
];

function listSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSources(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

test("sign-in source has no social provider", () => {
  const source = sourceRoots.flatMap(listSources).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  expect(source).not.toMatch(/google/i);
  expect(source).not.toMatch(/apple/i);
  expect(source).not.toMatch(/signIn\(\s*["'](?!password["'])/);
});

function expectNoSocialButtons(screen: Awaited<ReturnType<typeof render>>) {
  expect(screen.queryByText(/google/i)).toBeNull();
  expect(screen.queryByText(/apple/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
}

test("no Google or Apple button on iOS", async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => "ios" });
  try {
    expectNoSocialButtons(await render(<SignInScreen />));
  } finally {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
  }
});

test("no Google or Apple button on Android", async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => "android" });
  try {
    expectNoSocialButtons(await render(<SignInScreen />));
  } finally {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
  }
});
