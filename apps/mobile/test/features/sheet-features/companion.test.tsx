import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { INITIAL_COMPANION, type CompanionState } from "../../../../../src/lib/frames/extras/companion";
import { api, type Id } from "../../../src/convex";
import { CompanionPanel } from "../../../src/features/sheet/features/extras/panels/companion";
import { fn, renderAsPlayer } from "../../harness";

jest.mock("expo-crypto", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => (require("node:crypto") as typeof import("node:crypto")).randomUUID(),
}));

beforeEach(() => {
  resetMotionTest();
});

const characterId = "char-1" as Id<"characters">;

test("Save sends the edited fields over the saved Stress, never a stale draft (dcm-gdzi.20)", async () => {
  const calls: { state: CompanionState }[] = [];
  const saved: CompanionState = { ...INITIAL_COMPANION, name: "Bramble" };
  const mutations = {
    [fn(api.characterExtras.saveCompanion)]: (args: unknown) => {
      calls.push(args as { state: CompanionState });
      return null;
    },
  };
  const screen = await renderAsPlayer(<CompanionPanel canEdit characterId={characterId} level={1} state={saved} />, { mutations });
  await fireEvent.changeText(screen.getByLabelText("Animal"), "Fox");
  // The Stress pip saves at once, even with an edit open.
  await fireEvent.press(screen.getByLabelText("Companion Stress 1 of 3"));
  expect(calls[0]?.state.stress).toBe(1);
  expect(calls[0]?.state.kind).toBe(INITIAL_COMPANION.kind);

  // The server answers with Stress 1; Save now writes the edit on top of it.
  await screen.rerender(<CompanionPanel canEdit characterId={characterId} level={1} state={{ ...saved, stress: 1 }} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save companion" }));
  expect(calls[1]?.state).toMatchObject({ stress: 1, kind: "Fox", name: "Bramble" });
});
