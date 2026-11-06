import { describe, expect, it } from "vitest";

import { pickMarker } from "../../../src/lib/world/hex-tokens";

// dcm-kggd (WH2): a hex marker covers its whole hex, so clicking it must still select the hex (Travel here).
describe("marker click routing", () => {
  it("on a hex-grid map a marker click selects its hex and the marker together", () => {
    expect(pickMarker(7, true)).toEqual({ hex: true, token: 7 });
  });

  it("on a hex-grid map the party's marker selects the party's hex only", () => {
    expect(pickMarker("party", true)).toEqual({ hex: true, token: null });
  });

  it("without a grid a marker click selects only the marker, as before", () => {
    expect(pickMarker(7, false)).toEqual({ hex: false, token: 7 });
  });

  it("without a grid a click on the party changes nothing", () => {
    expect(pickMarker("party", false)).toBeNull();
  });
});
