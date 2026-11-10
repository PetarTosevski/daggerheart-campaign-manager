import { expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";

import NotePageRoute from "../../../app/campaign/[campaignId]/notes/[pageId]";
import SessionRoute from "../../../app/campaign/[campaignId]/sessions/[sessionId]";

const mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: RNText } = require("react-native") as { Text: typeof Text };
    return <RNText testID="redirect">{href}</RNText>;
  },
  useLocalSearchParams: () => mockParams,
}));

test("an old session link opens that session in the Journal", async () => {
  Object.assign(mockParams, { campaignId: "c1", sessionId: "s1" });
  const screen = await render(<SessionRoute />);
  expect(screen.getByTestId("redirect").props.children).toBe("/campaign/c1/journal?tab=sessions&s=s1");
});

test("an old notes page link opens that page on the Journal's Notes sub-tab", async () => {
  Object.assign(mockParams, { campaignId: "c1", pageId: "p1" });
  const screen = await render(<NotePageRoute />);
  expect(screen.getByTestId("redirect").props.children).toBe("/campaign/c1/journal?tab=notes&page=p1");
});
