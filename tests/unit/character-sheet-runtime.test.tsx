import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterSheetRuntime } from "@/components/character-sheet/character-sheet-runtime";
import type { CharacterSheetRuntimeData, RuntimeField } from "@/lib/data/character-sheet";

const saveMock = vi.fn();

vi.mock("@/app/(app)/characters/[characterId]/sheet-actions", () => ({
  saveCharacterSheetValueAction: (...args: unknown[]) => saveMock(...args),
  pinCharacterSheetVersionAction: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 600, height: 800 }),
          render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        }),
    }),
  }),
}));

function field(overrides: Partial<RuntimeField> = {}): RuntimeField {
  return {
    id: cryptoId(),
    field_key: "strength",
    label: "Strength",
    field_type: "text",
    page_number: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    configuration: {},
    is_required: false,
    ...overrides,
  };
}

let counter = 0;
function cryptoId() {
  counter += 1;
  return `00000000-0000-4000-8000-00000000000${counter}`;
}

type Ready = Extract<CharacterSheetRuntimeData, { state: "ready" }>;

function makeReady(fields: RuntimeField[], values: Ready["values"] = {}): Ready {
  return {
    state: "ready",
    characterId: "11111111-1111-4111-8111-111111111111",
    characterName: "Kodak",
    templateName: "Guardian sheet",
    version: { id: "22222222-2222-4222-8222-222222222222", version_number: 1, page_count: 2 },
    signedUrl: "blob:test",
    fields,
    values,
  };
}

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue({
    status: "saved",
    value: "18",
    updatedAt: "2026-07-26T00:00:01.000Z",
  });
});

describe("CharacterSheetRuntime", () => {
  it("hydrates controls by field type", async () => {
    const textField = field({ field_key: "strength", label: "Strength", field_type: "text" });
    const checkboxField = field({ field_key: "shielded", label: "Shielded", field_type: "checkbox", y: 0.2 });
    const computedField = field({ field_key: "total", label: "Total", field_type: "computed", y: 0.3 });
    const data = makeReady([textField, checkboxField, computedField], {
      [textField.id]: { value: "16", updated_at: "2026-07-26T00:00:00.000Z" },
    });

    render(<CharacterSheetRuntime data={data} />);

    // Controls appear once the (mocked) page has rendered and a size is known.
    expect(await screen.findByLabelText("Strength")).toHaveValue("16");
    expect(screen.getByLabelText("Shielded")).toBeInTheDocument();
    // Computed field renders read-only (no editable control with that label).
    expect(screen.queryByRole("textbox", { name: "Total" })).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("autosaves an edited value and shows Saved", async () => {
    const textField = field({ field_key: "strength", label: "Strength", field_type: "text" });
    const data = makeReady([textField]);
    const user = userEvent.setup();
    render(<CharacterSheetRuntime data={data} />);

    const input = await screen.findByLabelText("Strength");
    await user.type(input, "18");

    await waitFor(
      () => expect(saveMock).toHaveBeenCalled(),
      { timeout: 3000 },
    );
    const call = saveMock.mock.calls.at(-1)?.[0];
    expect(call.templateFieldId).toBe(textField.id);
    expect(call.value).toBe("18");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("surfaces a failed save without losing input", async () => {
    saveMock.mockResolvedValue({ status: "error", message: "Save failed." });
    const textField = field({ field_key: "strength", label: "Strength", field_type: "text" });
    const data = makeReady([textField]);
    const user = userEvent.setup();
    render(<CharacterSheetRuntime data={data} />);

    const input = await screen.findByLabelText("Strength");
    await user.type(input, "9");

    expect(await screen.findByText("Save failed", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(input).toHaveValue("9");
  });
});
