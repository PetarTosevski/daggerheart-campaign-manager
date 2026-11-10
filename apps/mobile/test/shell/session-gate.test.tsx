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

test("signed out, a join link goes to sign-in with the link as next; other paths do not ride along", () => {
  const join = { ...signedOut, segments: ["join", "[code]"] };
  expect(sessionRedirect({ ...join, pathname: "/join/ABC123" })).toBe("/sign-in?next=%2Fjoin%2FABC123");
  expect(sessionRedirect({ ...join, pathname: "/join/ABC123/" })).toBe("/sign-in?next=%2Fjoin%2FABC123%2F");
  expect(sessionRedirect({ ...signedOut, segments: ["join"], pathname: "/join" })).toBe("/sign-in");
  expect(sessionRedirect({ ...signedOut, segments: ["campaigns"], pathname: "/campaigns" })).toBe("/sign-in");
  expect(sessionRedirect({ ...signedOut, segments: ["(auth)", "sign-in"], pathname: "/sign-in" })).toBeNull();
});

test("signed in, sign-in goes to next when it is a path in this app, home otherwise", () => {
  const signIn = { ...signedIn, segments: ["(auth)", "sign-in"] };
  expect(sessionRedirect({ ...signIn, next: "/join/ABC123" })).toBe("/join/ABC123");
  expect(sessionRedirect({ ...signIn, next: "/campaign/c1/party" })).toBe("/campaign/c1/party");
  expect(sessionRedirect({ ...signIn, next: null })).toBe("/home");
  expect(sessionRedirect({ ...signIn, next: "" })).toBe("/home");
  expect(sessionRedirect({ ...signIn, next: "https://evil.example/join/x" })).toBe("/home");
  expect(sessionRedirect({ ...signIn, next: "//evil.example/join/x" })).toBe("/home");
  expect(sessionRedirect({ ...signIn, next: "/\\evil.example" })).toBe("/home");
  expect(sessionRedirect({ ...signIn, next: "javascript:alert(1)" })).toBe("/home");
  expect(sessionRedirect({ ...signIn, next: "/sign-in?next=/join/x" })).toBe("/home");
  expect(sessionRedirect({ ...signIn, next: "/auth" })).toBe("/home");
  expect(sessionRedirect({ ...signedIn, segments: ["auth"], next: "/join/ABC123" })).toBe("/join/ABC123");
});

test("signed in, a join link stays put", () => {
  expect(sessionRedirect({ ...signedIn, segments: ["join", "[code]"], pathname: "/join/ABC123" })).toBeNull();
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
