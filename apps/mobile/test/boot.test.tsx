import { expect, test } from "@jest/globals";
import { render } from "@testing-library/react-native";

import SignedOutScreen from "../app/index";

test("renders the signed-out screen", async () => {
  const screen = await render(<SignedOutScreen />);
  expect(screen.getByRole("header", { name: "Signed out" })).toBeTruthy();
});
