import { act, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortraitFrameEditor, PortraitLayer } from "@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sections/portrait-frame";
import type { PortraitFrame } from "@/lib/party/portrait-frame";

import type { Id } from "../../convex/_generated/dataModel";

// Plan portrait-frame, PZ1: the sheet's Adjust editor keeps its preview in local state and sends one intent on Save.

type Updater = (store: FakeStore, args: { characterId: string; frame: PortraitFrame | null }) => void;

const convex = vi.hoisted(() => ({
  save: vi.fn<(args: unknown) => Promise<null>>(),
  updater: null as Updater | null,
}));

vi.mock("convex/react", () => ({
  useMutation: () => {
    const fn = (args: unknown) => convex.save(args);
    fn.withOptimisticUpdate = (u: Updater) => {
      convex.updater = u;
      return fn;
    };
    return fn;
  },
}));

/** A tiny OptimisticLocalStore keyed by function name and JSON args. */
class FakeStore {
  data = new Map<string, unknown>();
  private key(ref: unknown, args: unknown) {
    return `${getFunctionName(ref as Parameters<typeof getFunctionName>[0])}|${JSON.stringify(args)}`;
  }
  getQuery(ref: unknown, args: unknown) {
    return this.data.get(this.key(ref, args));
  }
  setQuery(ref: unknown, args: unknown, value: unknown) {
    this.data.set(this.key(ref, args), value);
  }
  seed(name: string, args: unknown, value: unknown) {
    this.data.set(`${name}|${JSON.stringify(args)}`, value);
  }
  read(name: string, args: unknown) {
    return this.data.get(`${name}|${JSON.stringify(args)}`);
  }
}

const characterId = "char1" as Id<"characters">;
const campaignId = "camp1" as Id<"campaigns">;

function editor(saved?: PortraitFrame) {
  const onDone = vi.fn();
  render(
    <PortraitFrameEditor
      campaignId={campaignId}
      characterId={characterId}
      name="Liriel"
      src="/art/liriel.webp"
      saved={saved}
      fallbackPosition="center 20%"
      natural={null}
      onDone={onDone}
    />,
  );
  const preview = screen.getByRole("button", { name: "Move the picture of Liriel" });
  const layer = preview.querySelector<HTMLElement>("[data-testid='portrait-layer']")!;
  return { onDone, preview, layer, zoom: screen.getByRole("slider", { name: "Zoom" }) };
}

beforeEach(() => {
  convex.save.mockReset();
  convex.save.mockResolvedValue(null);
  convex.updater = null;
});

describe("PortraitLayer", () => {
  it("without a frame draws exactly as the arch did: the picture and today's position", () => {
    render(<PortraitLayer role="img" aria-label="Portrait of Liriel" src="/a.webp" frame={undefined} fallbackPosition="center 30%" />);
    const el = screen.getByRole("img", { name: "Portrait of Liriel" });
    expect(el.style.backgroundImage).toBe('url("/a.webp")');
    expect(el.style.backgroundPosition).toBe("center 30%");
    expect(el.style.transform).toBe("");
  });

  it("with a frame scales the picture about the focal point", () => {
    render(<PortraitLayer role="img" aria-label="Portrait" src="/a.webp" frame={{ zoom: 2, x: 40, y: 25 }} fallbackPosition="center 30%" />);
    const el = screen.getByRole("img", { name: "Portrait" });
    expect(el.style.transform).toBe("scale(2)");
    expect(el.style.transformOrigin).toBe("40% 25%");
    expect(el.style.backgroundPosition).toBe("40% 25%");
  });

  it("with no picture ignores the frame", () => {
    render(<PortraitLayer role="img" aria-label="Portrait" src={null} frame={{ zoom: 2, x: 40, y: 25 }} fallbackPosition="center 30%" />);
    const el = screen.getByRole("img", { name: "Portrait" });
    expect(el.style.backgroundImage).toBe("none");
    expect(el.style.transform).toBe("");
  });
});

describe("PortraitFrameEditor", () => {
  it("starts from the arch's own position when no frame is saved, and sends nothing while editing", () => {
    const { layer, zoom, preview } = editor();
    expect(layer.style.transform).toBe("scale(1)");
    expect(layer.style.backgroundPosition).toBe("50% 20%");
    expect((zoom as HTMLInputElement).value).toBe("1");

    fireEvent.change(zoom, { target: { value: "2.5" } });
    expect(layer.style.transform).toBe("scale(2.5)");
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    fireEvent.keyDown(preview, { key: "ArrowUp", shiftKey: true });
    expect(layer.style.backgroundPosition).toBe("48% 30%");
    expect(convex.save).not.toHaveBeenCalled();
  });

  it("starts from the saved frame", () => {
    const { layer, zoom } = editor({ zoom: 1.75, x: 30, y: 40 });
    expect(layer.style.transform).toBe("scale(1.75)");
    expect(layer.style.transformOrigin).toBe("30% 40%");
    expect(zoom).toHaveAttribute("aria-valuetext", "1.75x");
  });

  it("drags the picture with the pointer", () => {
    const { layer, preview, zoom } = editor();
    fireEvent.change(zoom, { target: { value: "2" } });
    preview.getBoundingClientRect = () => ({ width: 200, height: 250, x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 250, toJSON: () => ({}) });
    fireEvent.pointerDown(preview, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(preview, { pointerId: 1, clientX: 120, clientY: 75 });
    // Zoom 2 in a 200 x 250 box: 20 px right is 10% left, 25 px up is 10% down.
    expect(layer.style.backgroundPosition).toBe("40% 30%");
    fireEvent.pointerUp(preview, { pointerId: 1 });
    fireEvent.pointerMove(preview, { pointerId: 1, clientX: 180, clientY: 75 });
    expect(layer.style.backgroundPosition).toBe("40% 30%");
  });

  it("Save sends one intent with the frame, then closes", async () => {
    const { zoom, preview, onDone } = editor();
    fireEvent.change(zoom, { target: { value: "2" } });
    fireEvent.keyDown(preview, { key: "ArrowLeft" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(convex.save).toHaveBeenCalledTimes(1);
    expect(convex.save).toHaveBeenCalledWith({ characterId, frame: { zoom: 2, x: 52, y: 20 } });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Reset then Save clears the frame (null)", async () => {
    editor({ zoom: 2.5, x: 10, y: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(convex.save).toHaveBeenCalledWith({ characterId, frame: null });
  });

  it("Cancel closes without sending", () => {
    const { onDone, zoom } = editor();
    fireEvent.change(zoom, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(convex.save).not.toHaveBeenCalled();
  });

  it("a refused save shows the error and keeps the editor open", async () => {
    convex.save.mockRejectedValueOnce(new Error("nope"));
    const { onDone, zoom } = editor();
    fireEvent.change(zoom, { target: { value: "2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("the optimistic update puts the frame on the sheet, the roster and the dashboard at once", () => {
    editor();
    const store = new FakeStore();
    const sheet = { name: "Liriel", portraitFrame: { zoom: 3, x: 1, y: 1 } };
    store.seed("charactersReads:get", { characterId }, { _id: characterId, sheet });
    store.seed("charactersReads:listByCampaign", { campaignId }, [{ _id: characterId, sheet }, { _id: "other", sheet: { name: "Bo" } }]);
    store.seed("charactersReads:partySummary", { campaignId }, [{ _id: characterId, sheet }]);

    convex.updater!(store, { characterId, frame: { zoom: 2, x: 40, y: 25 } });
    expect((store.read("charactersReads:get", { characterId }) as { sheet: unknown }).sheet).toEqual({ name: "Liriel", portraitFrame: { zoom: 2, x: 40, y: 25 } });
    const list = store.read("charactersReads:listByCampaign", { campaignId }) as { sheet: unknown }[];
    expect(list[0]!.sheet).toEqual({ name: "Liriel", portraitFrame: { zoom: 2, x: 40, y: 25 } });
    expect(list[1]!.sheet).toEqual({ name: "Bo" });

    convex.updater!(store, { characterId, frame: null });
    expect((store.read("charactersReads:partySummary", { campaignId }) as { sheet: unknown }[])[0]!.sheet).toEqual({ name: "Liriel" });
    // The stored objects are replaced, never changed in place.
    expect(sheet.portraitFrame).toEqual({ zoom: 3, x: 1, y: 1 });
  });

  it("the optimistic update does nothing for queries the client does not hold", () => {
    editor();
    const store = new FakeStore();
    convex.updater!(store, { characterId, frame: { zoom: 2, x: 40, y: 25 } });
    expect(store.data.size).toBe(0);
  });
});
