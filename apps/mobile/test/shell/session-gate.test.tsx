import { beforeEach, expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";

import { CampaignGate } from "../../src/shell/campaign-gate";
import { sessionRedirect, signedOutAllowed } from "../../src/shell/session-gate";

const mockAuth = { isAuthenticated: false, isLoading: false };

jest.mock("@convex-dev/auth/react", () => ({
  useConvexAuth: () => mockAuth,
}));

jest.mock("expo-router", () => {
  // jest.mock is hoisted above imports, so the factory cannot reference them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: NativeText } = require("react-native") as typeof import("react-native");
  return {
    Redirect: ({ href }: { href: string }) => <NativeText>{`redirect:${href}`}</NativeText>,
    Slot: () => <NativeText>slot</NativeText>,
  };
});

beforeEach(() => {
  mockAuth.isAuthenticated = false;
  mockAuth.isLoading = false;
});

const signedOut = { isAuthenticated: false, isLoading: false };
const signedIn = { isAuthenticated: true, isLoading: false };

test("signed out, only sign-in and /auth stay; /campaign and everything under it go to sign-in", () => {
  expect(sessionRedirect({ ...signedOut, segments: ["(auth)", "sign-in"] })).toBeNull();
  expect(sessionRedirect({ ...signedOut, segments: ["auth"] })).toBeNull();
  expect(sessionRedirect({ ...signedOut, segments: ["(auth)", "campaign"] })).toBe("/sign-in");
  expect(sessionRedirect({ ...signedOut, segments: ["campaign", "[campaignId]"] })).toBe("/sign-in");
  expect(sessionRedirect({ ...signedOut, segments: ["campaign", "[campaignId]", "(gm)", "packs"] })).toBe("/sign-in");
  expect(sessionRedirect({ ...signedOut, segments: ["campaigns"] })).toBe("/sign-in");
  expect(sessionRedirect({ ...signedOut, segments: [] })).toBe("/sign-in");
  expect(signedOutAllowed(["(auth)", "campaign"])).toBe(false);
});

test("signed in, sign-in, /auth and the root go home and the bare /campaign goes to the campaign list", () => {
  expect(sessionRedirect({ ...signedIn, segments: ["(auth)", "sign-in"] })).toBe("/home");
  expect(sessionRedirect({ ...signedIn, segments: ["auth"] })).toBe("/home");
  expect(sessionRedirect({ ...signedIn, segments: [] })).toBe("/home");
  expect(sessionRedirect({ ...signedIn, segments: ["(auth)", "campaign"] })).toBe("/campaigns");
  expect(sessionRedirect({ ...signedIn, segments: ["campaign", "[campaignId]", "party"] })).toBeNull();
  expect(sessionRedirect({ ...signedIn, segments: ["campaigns"] })).toBeNull();
});

test("nothing redirects while the session is loading", () => {
  expect(sessionRedirect({ isAuthenticated: false, isLoading: true, segments: ["campaign", "[campaignId]"] })).toBeNull();
});

test("the campaign layout redirects a signed-out visitor without mounting the campaign routes", async () => {
  const screen = await render(
    <CampaignGate>
      <Text>campaign screen</Text>
    </CampaignGate>,
  );
  expect(screen.getByText("redirect:/sign-in")).toBeTruthy();
  expect(screen.queryByText("campaign screen")).toBeNull();
});

test("the campaign layout waits while the session loads and renders the routes signed in", async () => {
  mockAuth.isLoading = true;
  const loading = await render(<CampaignGate />);
  expect(loading.getByRole("progressbar", { name: "Checking your session" })).toBeTruthy();
  expect(loading.queryByText("slot")).toBeNull();
  loading.unmount();

  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  const ready = await render(<CampaignGate />);
  expect(ready.getByText("slot")).toBeTruthy();
});
