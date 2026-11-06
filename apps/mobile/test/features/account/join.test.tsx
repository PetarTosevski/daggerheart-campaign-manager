import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { JoinByCodeScreen } from "../../../src/features/account/join-by-code";
import { JoinByLinkScreen } from "../../../src/features/account/join-by-link";
import { renderAsPlayer } from "../../harness";

const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

beforeEach(() => {
  resetMotionTest();
  mockReplace.mockReset();
  mockBack.mockReset();
});

test("join by code opens the campaign on success", async () => {
  const screen = await renderAsPlayer(<JoinByCodeScreen />, {
    mutations: {
      "members:joinByCode": () => ({ ok: true as const, campaignId: "campaign-9" }),
    },
  });
  await fireEvent.changeText(screen.getByLabelText("Join code"), "k7qm-3xrp");
  const join = screen.getByRole("button", { name: "Join" });
  await waitFor(() => {
    expect(join.props.accessibilityState?.disabled).not.toBe(true);
  });
  await fireEvent.press(join);
  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith("/campaign/campaign-9");
  });
});

test("join by link shows the code and joins on confirm", async () => {
  const screen = await renderAsPlayer(<JoinByLinkScreen code="abcd-efgh" />, {
    mutations: {
      "members:joinByCode": (args) => {
        expect(args).toEqual({ code: "abcd-efgh" });
        return { ok: true as const, campaignId: "campaign-link" };
      },
    },
  });
  expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Join campaign" }));
  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith("/campaign/campaign-link");
  });
});
