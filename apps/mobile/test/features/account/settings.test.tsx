import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { NOT_A_BACKUP, settingsBackupText } from "../../../../../src/lib/validation/settings-backup";
import { SettingsScreen } from "../../../src/features/settings";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer, type RenderedScreen } from "../../harness";

const mockSignOut = jest.fn(() => Promise.resolve());
const mockReplace = jest.fn();

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: mockSignOut }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const ready = {
  tableName: "Thursday",
  gmName: "Ada",
  accent: "#e3b45a",
  expansions: { hopeAndFear: true },
  defaultMapStyle: "sprites" as const,
};

const viewer = { email: "ada@example.com", name: "Ada" };

beforeEach(() => {
  resetMotionTest();
  mockSignOut.mockReset();
  mockSignOut.mockImplementation(() => Promise.resolve());
  mockReplace.mockReset();
});

function recorded() {
  const updates: unknown[] = [];
  const restores: unknown[] = [];
  const resets: unknown[] = [];
  return {
    updates,
    restores,
    resets,
    mutations: {
      "settings:update": (args: unknown) => {
        updates.push(args);
        return null;
      },
      "settings:restore": (args: unknown) => {
        restores.push(args);
        return null;
      },
      "settings:reset": (args: unknown) => {
        resets.push(args);
        return null;
      },
    },
  };
}

async function renderReady(
  role: "player" | "gm",
  extra?: { updatesThrow?: boolean },
): Promise<RenderedScreen & ReturnType<typeof recorded>> {
  const book = recorded();
  const render = role === "player" ? renderAsPlayer : renderAsGm;
  const screen = await render(<SettingsScreen />, {
    queries: { "settings:get": ready, "users:viewer": viewer },
    mutations: extra?.updatesThrow
      ? {
          ...book.mutations,
          "settings:update": () => {
            throw new ConvexError({ code: "INVALID", message: "Accent refused" });
          },
        }
      : book.mutations,
  });
  return Object.assign(screen, book);
}

test("settings stay on Loading until settings.get answers", async () => {
  const screen = await renderAsPlayer(<SettingsScreen />);
  expect(screen.getByRole("progressbar", { name: "Loading settings" })).toBeTruthy();
  expect(screen.queryByLabelText("Table name")).toBeNull();
  expect(screen.client.subscribed).toEqual(["settings:get", "users:viewer"]);
  expect(screen.client.called).toEqual([]);
});

test("a player sees the website settings controls and no GM function", async () => {
  const screen = await renderReady("player");
  expect(screen.getByRole("header", { name: "Settings" })).toBeTruthy();
  expect(screen.getByLabelText("Table name")).toBeTruthy();
  expect(screen.getByLabelText("Your name")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Gold" }).props.accessibilityState).toEqual({
    disabled: false,
    selected: true,
  });
  expect(screen.getByRole("switch", { name: "Hope & Fear" }).props.accessibilityState).toEqual({
    checked: true,
    disabled: false,
  });
  expect(screen.getByRole("button", { name: "Use each frame’s default" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Style of new maps" }).props.accessibilityState.checked).toBe(true);
  expect(screen.getByText("ada@example.com")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["settings:get", "users:viewer"]);
  expect(screen.client.called).toEqual([]);
});

test("a GM sees the same settings controls", async () => {
  const screen = await renderReady("gm");
  expect(screen.getByRole("header", { name: "Settings" })).toBeTruthy();
  expect(screen.getByLabelText("Table name")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["settings:get", "users:viewer"]);
});

test("an unset Hope & Fear expansion tells the player each frame keeps its default", async () => {
  const screen = await renderAsPlayer(<SettingsScreen />, {
    queries: {
      "settings:get": { ...ready, expansions: {} },
      "users:viewer": viewer,
    },
  });
  expect(screen.getByText("Not set yet: each frame uses its own default.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use each frame’s default" })).toBeNull();
  expect(screen.getByRole("switch", { name: "Hope & Fear" }).props.accessibilityState.checked).toBe(false);
});

test("blurring a changed table name sends that field only", async () => {
  const screen = await renderReady("player");
  const input = screen.getByLabelText("Table name");
  await fireEvent(input, "blur");
  expect(screen.updates).toEqual([]);

  await fireEvent.changeText(input, "  Thursday  ");
  await fireEvent(input, "blur");
  expect(screen.updates).toEqual([]);

  await fireEvent.changeText(input, "Friday Night");
  await fireEvent(input, "blur");
  await waitFor(() => expect(screen.updates).toEqual([{ tableName: "Friday Night" }]));
  expect(screen.client.called).toEqual(["settings:update"]);
});

test("a GM accent tap sends the swatch, and a refused save shows the error", async () => {
  const saved = await renderReady("gm");
  await fireEvent.press(saved.getByRole("radio", { name: "Violet" }));
  await waitFor(() => expect(saved.updates).toEqual([{ accent: "#8f78d8" }]));

  const refused = await renderReady("player", { updatesThrow: true });
  await fireEvent.press(refused.getByRole("radio", { name: "Violet" }));
  expect(await refused.findByRole("alert", { name: "Accent refused" })).toBeTruthy();
});

test("Hope & Fear and the map style send one field each", async () => {
  const screen = await renderReady("player");
  await fireEvent.press(screen.getByRole("switch", { name: "Hope & Fear" }));
  await fireEvent.press(screen.getByRole("button", { name: "Use each frame’s default" }));
  await fireEvent.press(screen.getByRole("switch", { name: "Style of new maps" }));
  await waitFor(() =>
    expect(screen.updates).toEqual([
      { expansions: { hopeAndFear: false } },
      { expansions: { hopeAndFear: null } },
      { defaultMapStyle: "classic" },
    ]),
  );
});

test("show backup fills the field, and a paste that is not a backup is refused locally", async () => {
  const screen = await renderReady("gm");
  await fireEvent.press(screen.getByRole("button", { name: "Show backup" }));
  expect(screen.getByLabelText("Backup data").props.value).toBe(settingsBackupText(ready));
  expect(screen.getByText(/Backup shown below and selected/)).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText("Backup data"), "nope");
  await fireEvent.press(screen.getByRole("button", { name: "Restore from pasted backup" }));
  expect(screen.getByText(NOT_A_BACKUP)).toBeTruthy();
  expect(screen.restores).toEqual([]);
  expect(screen.client.called).not.toContain("settings:restore");
});

test("a pasted backup and a confirmed reset call restore and reset", async () => {
  const screen = await renderReady("player");
  const text = settingsBackupText(ready);
  await fireEvent.changeText(screen.getByLabelText("Backup data"), text);
  await fireEvent.press(screen.getByRole("button", { name: "Restore from pasted backup" }));
  await waitFor(() => expect(screen.restores).toEqual([{ text }]));
  expect(screen.getByText("Settings restored from the backup.")).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "Reset settings…" }));
  expect(screen.getByLabelText("Confirm reset")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Confirm reset")).toBeNull();
  expect(screen.resets).toEqual([]);

  await fireEvent.press(screen.getByRole("button", { name: "Reset settings…" }));
  await fireEvent.press(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(screen.resets).toEqual([{}]));
  expect(screen.getByText("Settings reset to their defaults.")).toBeTruthy();
});

test("offline keeps the backup visible and does not send writes", async () => {
  const screen = await renderAsGm(
    <OfflineFrame offline>
      <SettingsScreen />
    </OfflineFrame>,
    {
      queries: { "settings:get": ready, "users:viewer": viewer },
      mutations: {
        "settings:update": () => {
          throw new Error("offline write");
        },
        "settings:restore": () => {
          throw new Error("offline write");
        },
      },
    },
  );
  expect(screen.getByText("Showing the last update.")).toBeTruthy();
  const restore = screen.getByRole("button", { name: "Restore from pasted backup" });
  expect(restore.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(restore);
  await fireEvent.press(screen.getByRole("radio", { name: "Violet" }));
  expect(screen.client.called).toEqual([]);

  await fireEvent.press(screen.getByRole("button", { name: "Show backup" }));
  expect(screen.getByLabelText("Backup data").props.value).toBe(settingsBackupText(ready));
});

test("sign out ends the session and returns to the sign-in screen", async () => {
  const screen = await renderReady("gm");
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  expect(mockReplace).toHaveBeenCalledWith("/sign-in");
});
