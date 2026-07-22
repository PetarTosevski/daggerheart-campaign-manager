import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PdfTemplateViewer } from "@/components/sheet-templates/pdf-template-viewer";

// Mock the heavy PDF runtime. The component dynamically imports it; jsdom has no
// canvas 2d context, so renderPage bails after load and we assert on the
// navigation/zoom UI behavior.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        }),
    }),
  }),
}));

describe("PdfTemplateViewer", () => {
  it("renders navigation and zoom once the document is ready", async () => {
    render(
      <PdfTemplateViewer signedUrl="https://example.test/a.pdf" pageCount={3} />,
    );

    await waitFor(() =>
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument(),
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
  });

  it("navigates pages within bounds", async () => {
    const user = userEvent.setup();
    render(
      <PdfTemplateViewer signedUrl="https://example.test/a.pdf" pageCount={3} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("adjusts zoom within bounds", async () => {
    const user = userEvent.setup();
    render(
      <PdfTemplateViewer signedUrl="https://example.test/a.pdf" pageCount={1} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Page 1 of 1")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
