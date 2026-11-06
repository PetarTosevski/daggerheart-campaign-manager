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

const prefs = {
  dice3d: true,
  diceSound: false,
  diceVolume: 60,
  reduceMotion: false,
  textSize: "medium" as const,
  spotlightPing: true,
  legacyImported: true,
};

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
  const prefChanges: unknown[] = [];
  const deletes: unknown[] = [];
  return {
    deletes,
    updates,
    restores,
    resets,
    prefChanges,
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
      "preferences:set": (args: unknown) => {
        prefChanges.push(args);
        return null;
      },
    },
  };
}

async function renderReady(
  role: "player" | "gm",
  extra?: { updatesThrow?: boolean; isOwner?: boolean; deleteThrows?: boolean },
): Promise<RenderedScreen & ReturnType<typeof recorded>> {
  const book = recorded();
  const render = role === "player" ? renderAsPlayer : renderAsGm;
  const mutations: Record<string, (args: unknown) => unknown> = {
    ...book.mutations,
    "accountSelfDelete:deleteMyAccount": (args: unknown) => {
      book.deletes.push(args);
      if (extra?.deleteThrows) throw new ConvexError({ code: "OWNER_ACCOUNT_UNDELETABLE", message: "The app owner's account can't be deleted." });
      return null;
    },
  };
  const screen = await render(<SettingsScreen />, {
    queries: { "settings:get": ready, "users:viewer": viewer, "preferences:get": prefs, "appAdmin:me": { isOwner: extra?.isOwner ?? false } },
    mutations: extra?.updatesThrow
      ? {
          ...mutations,
          "settings:update": () => {
            throw new ConvexError({ code: "INVALID", message: "Accent refused" });
          },
        }
      : mutations,
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
  expect(screen.client.subscribed).toEqual(["settings:get", "users:viewer", "preferences:get", "appAdmin:me"]);
  expect(screen.client.called).toEqual([]);
});

test("a GM sees the same settings controls", async () => {
  const screen = await renderReady("gm");
  expect(screen.getByRole("header", { name: "Settings" })).toBeTruthy();
  expect(screen.getByLabelText("Table name")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["settings:get", "users:viewer", "preferences:get", "appAdmin:me"]);
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

test("a name field follows edits made elsewhere and never writes back the value it showed at focus", async () => {
  const live = { ...ready };
  const updates: unknown[] = [];
  const screen = await renderAsPlayer(<SettingsScreen />, {
    queries: { "settings:get": () => live, "users:viewer": viewer, "preferences:get": prefs },
    mutations: {
      "settings:update": (args: unknown) => {
        updates.push(args);
        return null;
      },
    },
  });
  // Not focused: a change on the website shows at once.
  live.tableName = "From the web";
  await screen.rerender(<SettingsScreen />);
  expect(screen.getByLabelText("Table name").props.value).toBe("From the web");

  // Focused with no edit while another change lands: blur saves nothing.
  await fireEvent(screen.getByLabelText("Table name"), "focus");
  live.tableName = "Newer web edit";
  await screen.rerender(<SettingsScreen />);
  await fireEvent(screen.getByLabelText("Table name"), "blur");
  expect(updates).toEqual([]);
  expect(screen.getByLabelText("Table name").props.value).toBe("Newer web edit");

  // A real edit saves that one field, trimmed.
  await fireEvent(screen.getByLabelText("Your name"), "focus");
  await fireEvent.changeText(screen.getByLabelText("Your name"), "  Bea ");
  await fireEvent(screen.getByLabelText("Your name"), "blur");
  await waitFor(() => expect(updates).toEqual([{ gmName: "Bea" }]));
});

test("preferences save one field per tap", async () => {
  const screen = await renderReady("player");
  expect(screen.getByRole("switch", { name: "3D dice" }).props.accessibilityState).toEqual({
    checked: true,
    disabled: false,
  });
  await fireEvent.press(screen.getByRole("switch", { name: "3D dice" }));
  await fireEvent.press(screen.getByRole("switch", { name: "Dice sound" }));
  await fireEvent.press(screen.getByRole("button", { name: "Louder" }));
  await fireEvent.press(screen.getByRole("radio", { name: "Large" }));
  await fireEvent.press(screen.getByRole("radio", { name: "Medium" }));
  await fireEvent.press(screen.getByRole("switch", { name: "Ping me when I get the spotlight" }));
  await waitFor(() =>
    expect(screen.prefChanges).toEqual([
      { change: { key: "dice3d", value: false } },
      { change: { key: "diceSound", value: true } },
      { change: { key: "diceVolume", value: 70 } },
      { change: { key: "textSize", value: "large" } },
      { change: { key: "spotlightPing", value: false } },
    ]),
  );
  expect(screen.client.called).not.toContain("settings:update");
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
      queries: { "settings:get": ready, "users:viewer": viewer, "preferences:get": prefs },
      mutations: {
        "preferences:set": () => {
          throw new Error("offline write");
        },
        "settings:update": () => {
          throw new Error("offline write");
        },
        "settings:restore": () => {
          throw new Error("offline write");
        },
      },
    },
  );
  expect(screen.getByText("You're offline. Showing the last update.")).toBeTruthy();
  const restore = screen.getByRole("button", { name: "Restore from pasted backup" });
  expect(restore.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(restore);
  await fireEvent.press(screen.getByRole("radio", { name: "Violet" }));
  await fireEvent.press(screen.getByRole("switch", { name: "3D dice" }));
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

test("Delete account asks first, then deletes, signs out and returns to sign-in", async () => {
  const screen = await renderReady("player");
  await fireEvent.press(screen.getByRole("button", { name: "Delete account…" }));
  expect(screen.getByText(/erased after 30 days/)).toBeTruthy();
  expect(screen.deletes).toEqual([]);
  await fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/sign-in"));
  expect(screen.deletes).toEqual([{}]);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});

test("a refused Delete account stays signed in and shows the server's reason", async () => {
  const screen = await renderReady("gm", { deleteThrows: true });
  await fireEvent.press(screen.getByRole("button", { name: "Delete account…" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
  expect(await screen.findByText("The app owner's account can't be deleted.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete my account" })).toBeTruthy();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test("the app owner never sees Delete account", async () => {
  const screen = await renderReady("gm", { isOwner: true });
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete account…" })).toBeNull();
});
