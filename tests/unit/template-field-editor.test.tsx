import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TemplateFieldEditor } from "@/components/sheet-templates/template-field-editor";
import type { TemplateEditorData } from "@/lib/data/sheet-templates";

vi.mock("@/app/(app)/characters/templates/field-actions", () => ({
  saveTemplateFieldsAction: vi.fn(),
  publishTemplateVersionAction: vi.fn(),
  reviseTemplateVersionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// pdf.js is browser-only; stub it so the overlay canvas mounts without a worker.
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

function makeData(overrides: Partial<TemplateEditorData> = {}): TemplateEditorData {
  return {
    campaign: { id: "11111111-1111-4111-8111-111111111111", name: "Demo" },
    template: { id: "22222222-2222-4222-8222-222222222222", name: "Guardian sheet" },
    version: {
      id: "33333333-3333-4333-8333-333333333333",
      template_id: "22222222-2222-4222-8222-222222222222",
      version_number: 1,
      page_count: 2,
      status: "active",
      layout_status: "draft",
      published_at: null,
    },
    fields: [],
    signedUrl: "blob:test",
    ...overrides,
  };
}

describe("TemplateFieldEditor", () => {
  it("renders a draft editor with the add-field toolbar and save control", () => {
    render(<TemplateFieldEditor data={makeData()} />);
    expect(screen.getByText("Add field")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save layout" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
  });

  it("adds a field and opens the inspector", async () => {
    const user = userEvent.setup();
    render(<TemplateFieldEditor data={makeData()} />);

    await user.click(screen.getByRole("button", { name: "Text" }));

    // Inspector opens for the new field with a generated key.
    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getByDisplayValue("text_field")).toBeInTheDocument();
  });

  it("shows a published version as read-only with a revision action", () => {
    render(
      <TemplateFieldEditor
        data={makeData({
          version: {
            id: "33333333-3333-4333-8333-333333333333",
            template_id: "22222222-2222-4222-8222-222222222222",
            version_number: 1,
            page_count: 2,
            status: "active",
            layout_status: "published",
            published_at: "2026-07-25T00:00:00.000Z",
          },
        })}
      />,
    );

    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create draft revision/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Add field")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save layout" }),
    ).not.toBeInTheDocument();
  });
});
