import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConvexError } from "convex/values";

import { unreachableMessage, type UnreachableReason } from "@/lib/errors/photoImport";

import type { Id } from "../../convex/_generated/dataModel";
import { validDraft } from "../fixtures/photo-import";

const nameOf = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const mutations = vi.fn<(name: string, args: unknown) => Promise<unknown>>();
let finishRead: (error: Error) => void = () => undefined;
const read = vi.fn(() => new Promise((_, reject) => (finishRead = reject)));

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: (ref: unknown) => (args: unknown) => mutations(nameOf(ref), args),
  useAction: () => read,
}));

const { ImportFlow } = await import("@/components/party/import/flow");

describe("photo import flow", () => {
  beforeEach(() => {
    mutations.mockReset();
    mutations.mockImplementation(async (name) => {
      if (name.endsWith("uploadUrl")) return "https://upload.example/1";
      if (name.endsWith("claim")) return { ok: true };
      return null;
    });
    read.mockClear();
    // jsdom has no image decoding or canvas: the shrink step is stubbed, as is the upload POST.
    vi.stubGlobal("createImageBitmap", async () => ({ width: 100, height: 100, close: () => undefined }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new Blob(["x"], { type: "image/jpeg" })));
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ storageId: "s1" }), { status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("disables Read photos while a read is in flight, so a double click reads once", async () => {
    render(<ImportFlow campaignId={"c1" as Id<"campaigns">} hopeAndFear={false} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Sheet photos"), { target: { files: [new File(["x"], "front.jpg", { type: "image/jpeg" })] } });
    const button = screen.getByRole("button", { name: "Read photos" });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    expect(mutations.mock.calls.filter(([name]) => name.endsWith("uploadUrl"))).toHaveLength(1);

    // Once the read fails the button works again.
    finishRead(new Error("Claude couldn't read the photos."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Read photos" })).toBeEnabled());
    expect(read).toHaveBeenCalledTimes(1);
  });

  // PS2 (dcm-ccnm): when Claude can't be reached the photos stay on the server and Try again reads them again.
  const unreachable = (reason: UnreachableReason) => new ConvexError({ code: "PHOTO_IMPORT_UNREACHABLE", reason, message: unreachableMessage(reason) });
  const pickAndRead = () => {
    fireEvent.change(screen.getByLabelText("Sheet photos"), { target: { files: [new File(["x"], "front.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Read photos" }));
  };
  const uploads = () => mutations.mock.calls.filter(([name]) => name.endsWith("uploadUrl")).length;
  const discards = () => mutations.mock.calls.filter(([name]) => name.endsWith("discard")).length;

  it("shows 'Importer can't be reached' with Try again, which reads the kept photos without uploading them again", async () => {
    read.mockImplementationOnce(() => Promise.reject(unreachable("credits")));
    read.mockImplementationOnce(() => Promise.resolve({ draft: validDraft(), unreadable: [], uncertain: ["name"], unmatched: [], blank: false }));
    render(<ImportFlow campaignId={"c1" as Id<"campaigns">} hopeAndFear={false} onClose={() => undefined} />);
    pickAndRead();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(unreachableMessage("credits")));
    expect(uploads()).toBe(1);
    const discardsBefore = discards();
    expect(screen.queryByRole("button", { name: "Read photos" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("form", { name: "Review the imported character" })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
    expect(uploads()).toBe(1);
    // The kept photos were never discarded on the way.
    expect(discards()).toBe(discardsBefore);
  });

  it("Cancel after an unreachable error discards the kept photos", async () => {
    read.mockImplementationOnce(() => Promise.reject(unreachable("overloaded")));
    const onClose = vi.fn();
    render(<ImportFlow campaignId={"c1" as Id<"campaigns">} hopeAndFear={false} onClose={onClose} />);
    pickAndRead();
    await screen.findByRole("button", { name: "Try again" });
    const discardsBefore = discards();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(discards()).toBe(discardsBefore + 1);
  });
});
