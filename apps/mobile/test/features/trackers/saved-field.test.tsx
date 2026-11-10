import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { SavedField } from "../../../src/features/trackers/card";

beforeEach(() => {
  resetMotionTest();
});

function field(value: string, saved: string[]) {
  return <SavedField label="Hunt name" onSave={(next) => saved.push(next)} value={value} />;
}

test("saves the trimmed text when editing ends", async () => {
  const saved: string[] = [];
  const screen = await render(field("The Bell", saved));
  const input = screen.getByLabelText("Hunt name");
  await fireEvent(input, "focus");
  await fireEvent.changeText(input, "  The Drowned Bell  ");
  await fireEvent(input, "endEditing", { nativeEvent: { text: "  The Drowned Bell  " } });
  expect(saved).toEqual(["The Drowned Bell"]);
  expect(screen.getByLabelText("Hunt name").props.value).toBe("The Drowned Bell");
});

test("text that only differs by spaces is not saved", async () => {
  const saved: string[] = [];
  const screen = await render(field("The Bell", saved));
  const input = screen.getByLabelText("Hunt name");
  await fireEvent(input, "focus");
  await fireEvent.changeText(input, "The Bell  ");
  await fireEvent(input, "endEditing", { nativeEvent: { text: "The Bell  " } });
  expect(saved).toEqual([]);
  expect(screen.getByLabelText("Hunt name").props.value).toBe("The Bell");
});

test("a remote edit does not replace what the user is typing, and shows once editing ends", async () => {
  const saved: string[] = [];
  const screen = await render(field("The Bell", saved));
  const input = screen.getByLabelText("Hunt name");
  await fireEvent(input, "focus");
  await fireEvent.changeText(input, "The Drow");

  await screen.rerender(field("Renamed elsewhere", saved));
  expect(screen.getByLabelText("Hunt name").props.value).toBe("The Drow");

  await fireEvent(screen.getByLabelText("Hunt name"), "endEditing", { nativeEvent: { text: "The Drow" } });
  expect(saved).toEqual(["The Drow"]);
});

test("a field that is not being edited follows the stored value", async () => {
  const saved: string[] = [];
  const screen = await render(field("The Bell", saved));
  await screen.rerender(field("Renamed elsewhere", saved));
  expect(screen.getByLabelText("Hunt name").props.value).toBe("Renamed elsewhere");
  expect(saved).toEqual([]);
});
