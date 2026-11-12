import { describe, expect, it } from "vitest";

import {
  clampPortraitFrame,
  coverOverflow,
  DEFAULT_PORTRAIT_FRAME,
  dragPortraitFrame,
  nudgePortraitFrame,
  portraitFrameFromPosition,
  portraitFrameOrDefault,
  portraitFrameStyle,
  samePortraitFrame,
} from "@/lib/party/portrait-frame";
import { characterSchemas } from "@/lib/validation/character-schemas";

// Plan portrait-frame, PZ1: the close-up's pure helpers and the sheet field.

describe("portrait frame helpers", () => {
  it("defaults to no zoom, centred, a little above the middle", () => {
    expect(DEFAULT_PORTRAIT_FRAME).toEqual({ zoom: 1, x: 50, y: 30 });
    expect(portraitFrameOrDefault(undefined)).toEqual(DEFAULT_PORTRAIT_FRAME);
    expect(portraitFrameOrDefault(null)).toEqual(DEFAULT_PORTRAIT_FRAME);
    expect(portraitFrameOrDefault({ zoom: 2, x: 10, y: 90 })).toEqual({ zoom: 2, x: 10, y: 90 });
  });

  it("clamps zoom to 1..3 on its 0.05 step and the point to 0..100 at one decimal", () => {
    expect(clampPortraitFrame({ zoom: 0.4, x: -5, y: 140 })).toEqual({ zoom: 1, x: 0, y: 100 });
    expect(clampPortraitFrame({ zoom: 9, x: 50, y: 50 })).toEqual({ zoom: 3, x: 50, y: 50 });
    expect(clampPortraitFrame({ zoom: 1.149, x: 33.333, y: 66.666 })).toEqual({ zoom: 1.15, x: 33.3, y: 66.7 });
    expect(clampPortraitFrame({ zoom: Number.NaN, x: Number.NaN, y: 20 })).toEqual({ zoom: 1, x: 0, y: 20 });
  });

  it("compares frames after clamping", () => {
    expect(samePortraitFrame({ zoom: 1.5, x: 40, y: 20 }, { zoom: 1.501, x: 40.01, y: 20 })).toBe(true);
    expect(samePortraitFrame({ zoom: 1.5, x: 40, y: 20 }, { zoom: 1.55, x: 40, y: 20 })).toBe(false);
  });

  it("reads a CSS background-position as the zoom-1 frame that draws like it", () => {
    expect(portraitFrameFromPosition("center 30%")).toEqual({ zoom: 1, x: 50, y: 30 });
    expect(portraitFrameFromPosition("50% 20%")).toEqual({ zoom: 1, x: 50, y: 20 });
    expect(portraitFrameFromPosition("left top")).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(portraitFrameFromPosition("top")).toEqual({ zoom: 1, x: 50, y: 0 });
    expect(portraitFrameFromPosition("right")).toEqual({ zoom: 1, x: 100, y: 50 });
    expect(portraitFrameFromPosition("bottom right")).toEqual({ zoom: 1, x: 100, y: 100 });
    expect(portraitFrameFromPosition("nonsense")).toEqual({ zoom: 1, x: 50, y: 50 });
  });

  it("measures how far a cover picture sticks out of its box", () => {
    // A 2:1 landscape in a 100x100 box: scaled to 200x100, 100 px over on x.
    expect(coverOverflow({ width: 100, height: 100 }, { width: 400, height: 200 })).toEqual({ width: 100, height: 0 });
    expect(coverOverflow({ width: 100, height: 100 }, null)).toEqual({ width: 0, height: 0 });
    expect(coverOverflow({ width: 0, height: 0 }, { width: 400, height: 200 })).toEqual({ width: 0, height: 0 });
  });

  describe("the drag maths", () => {
    const box = { width: 200, height: 250 };

    it("moves the focal point against the drag so the picture follows the pointer", () => {
      // Zoom 2, no overflow: 1% moves the picture (2 - 1) * 200 / 100 = 2 px; dragging 20 px right moves x 10 left.
      const moved = dragPortraitFrame({ zoom: 2, x: 50, y: 50 }, { dx: 20, dy: -25 }, box);
      expect(moved).toEqual({ zoom: 2, x: 40, y: 60 });
    });

    it("counts the cover overflow too, so a zoom-1 landscape still pans sideways", () => {
      // Zoom 1, 100 px overflow on x: 1% is 1 px; y has no overflow and stays.
      const moved = dragPortraitFrame({ zoom: 1, x: 50, y: 30 }, { dx: 10, dy: 40 }, box, { width: 100, height: 0 });
      expect(moved).toEqual({ zoom: 1, x: 40, y: 30 });
    });

    it("keeps the point where the picture can't move, and clamps at the edges", () => {
      expect(dragPortraitFrame({ zoom: 1, x: 50, y: 30 }, { dx: 50, dy: 50 }, box)).toEqual({ zoom: 1, x: 50, y: 30 });
      expect(dragPortraitFrame({ zoom: 3, x: 5, y: 95 }, { dx: 400, dy: -400 }, box)).toEqual({ zoom: 3, x: 0, y: 100 });
      expect(dragPortraitFrame({ zoom: 2, x: 50, y: 50 }, { dx: 10, dy: 10 }, { width: 0, height: 0 })).toEqual({ zoom: 2, x: 50, y: 50 });
    });
  });

  it("moves with the arrow keys like a short drag (Shift: further), and ignores other keys", () => {
    const f = { zoom: 2, x: 50, y: 50 };
    expect(nudgePortraitFrame(f, "ArrowRight")).toEqual({ zoom: 2, x: 48, y: 50 });
    expect(nudgePortraitFrame(f, "ArrowLeft")).toEqual({ zoom: 2, x: 52, y: 50 });
    expect(nudgePortraitFrame(f, "ArrowDown")).toEqual({ zoom: 2, x: 50, y: 48 });
    expect(nudgePortraitFrame(f, "ArrowUp", true)).toEqual({ zoom: 2, x: 50, y: 60 });
    expect(nudgePortraitFrame({ zoom: 2, x: 1, y: 50 }, "ArrowRight")).toEqual({ zoom: 2, x: 0, y: 50 });
    expect(nudgePortraitFrame(f, "Enter")).toBeNull();
  });

  describe("the style helper", () => {
    it("without a frame gives only today's position", () => {
      expect(portraitFrameStyle(undefined, "center 30%")).toEqual({ backgroundPosition: "center 30%" });
      expect(portraitFrameStyle(null, "50% 15%")).toEqual({ backgroundPosition: "50% 15%" });
    });

    it("with a frame scales the cover picture about the focal point", () => {
      expect(portraitFrameStyle({ zoom: 1.75, x: 40, y: 22.5 }, "center 30%")).toEqual({
        backgroundPosition: "40% 22.5%",
        backgroundSize: "cover",
        transform: "scale(1.75)",
        transformOrigin: "40% 22.5%",
      });
    });

    it("clamps a stray stored value", () => {
      expect(portraitFrameStyle({ zoom: 5, x: 120, y: -3 }, "center")).toMatchObject({ transform: "scale(3)", backgroundPosition: "100% 0%" });
    });
  });
});

describe("sheet.portraitFrame", () => {
  const { portraitFrameSchema, characterSheetSchema } = characterSchemas();

  it("is zoom 1..3 and a point 0..100", () => {
    expect(portraitFrameSchema.safeParse({ zoom: 1, x: 0, y: 100 }).success).toBe(true);
    expect(portraitFrameSchema.safeParse({ zoom: 3, x: 50, y: 30 }).success).toBe(true);
    expect(portraitFrameSchema.safeParse({ zoom: 0.95, x: 50, y: 30 }).success).toBe(false);
    expect(portraitFrameSchema.safeParse({ zoom: 3.05, x: 50, y: 30 }).success).toBe(false);
    expect(portraitFrameSchema.safeParse({ zoom: 2, x: -1, y: 30 }).success).toBe(false);
    expect(portraitFrameSchema.safeParse({ zoom: 2, x: 50, y: 101 }).success).toBe(false);
  });

  it("is optional on the current sheet", () => {
    expect(characterSheetSchema.shape.portraitFrame.safeParse(undefined).success).toBe(true);
    expect(characterSheetSchema.shape.portraitFrame.safeParse({ zoom: 2, x: 40, y: 20 }).success).toBe(true);
    expect(characterSheetSchema.shape.portraitFrame.safeParse({ zoom: 4, x: 40, y: 20 }).success).toBe(false);
  });
});
