// Plan glass-buttons G0 (docs/tasks/TASK-GLASS-G0.md): brandButton keeps its signature and draws the arcane glass
// button (src/components/brand/glass-button.css); the legacy variants map to roles, the sizes to the glass sizes, and
// every labelled button may wrap. The viewer helpers give portalled content the campaign's data-viewer, and Modal's
// close ✕ is a round cancel icon button.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BrandButton, brandButton, brandRole, type BrandSize, type BrandVariant } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { ViewerProvider, ViewerScope, useViewer, viewerFor } from "@/components/brand/viewer";

const classes = (s: string) => s.split(" ").filter(Boolean);

describe("brandButton: legacy variant -> glass role", () => {
  const table: [BrandVariant | undefined, string][] = [
    [undefined, "gb-neutral"],
    ["primary", "gb-confirm"],
    ["solid", "gb-confirm"],
    ["outline", "gb-neutral"],
    ["pill", "gb-neutral"],
    ["danger", "gb-danger"],
    ["dangerSolid", "gb-danger"],
  ];
  it.each(table)("%s -> %s", (variant, role) => {
    const c = classes(brandButton({ variant }));
    expect(c).toContain("gb");
    expect(c).toContain(role);
    expect(c.filter((x) => /^gb-(confirm|cancel|neutral|tool|danger|allow|deny|normal|advantage|disadvantage)$/.test(x))).toHaveLength(1);
  });

  it("names the explicit roles as they are", () => {
    for (const role of ["confirm", "cancel", "neutral", "tool", "danger", "allow", "deny", "normal", "advantage", "disadvantage"] as const) {
      expect(brandRole(role)).toBe(role);
      expect(classes(brandButton({ variant: role }))).toContain(`gb-${role}`);
    }
  });
});

describe("brandButton: sizes", () => {
  const sizeClass = (variant: BrandVariant | undefined, size: BrandSize | undefined) =>
    classes(brandButton({ variant, size })).filter((x) => x === "gb-sm" || x === "gb-lg");

  it("sm -> gb-sm, md -> 44 px (no class), lg and xl -> gb-lg", () => {
    expect(sizeClass("outline", "sm")).toEqual(["gb-sm"]);
    expect(sizeClass("outline", "md")).toEqual([]);
    expect(sizeClass("outline", undefined)).toEqual([]);
    expect(sizeClass("solid", "lg")).toEqual(["gb-lg"]);
    expect(sizeClass("pill", "xl")).toEqual(["gb-lg"]);
  });

  it("primary (the headline button) is large unless the call site asks for small", () => {
    expect(sizeClass("primary", undefined)).toEqual(["gb-lg"]);
    expect(sizeClass("primary", "md")).toEqual(["gb-lg"]);
    expect(sizeClass("primary", "xl")).toEqual(["gb-lg"]);
    expect(sizeClass("primary", "sm")).toEqual(["gb-sm"]);
  });
});

describe("brandButton: shape and call-site classes", () => {
  it("lets labelled buttons wrap; icon buttons are 44 x 44 and may be round", () => {
    expect(classes(brandButton({ variant: "confirm" }))).toContain("gb-wrap");
    const icon = classes(brandButton({ variant: "cancel", icon: true, round: true }));
    expect(icon).toEqual(expect.arrayContaining(["gb", "gb-cancel", "gb-icon", "gb-round"]));
    expect(icon).not.toContain("gb-wrap");
  });

  it("keeps the call site's className (both the className and class keys)", () => {
    expect(classes(brandButton({ variant: "solid", size: "lg", className: "w-full" }))).toContain("w-full");
    expect(classes(brandButton({ variant: "solid", class: "self-start" }))).toContain("self-start");
  });

  it("BrandButton renders a type=button glass button with the call site's layout class", () => {
    render(
      <BrandButton variant="primary" className="ml-auto">
        Choose this Frame
      </BrandButton>,
    );
    const button = screen.getByRole("button", { name: "Choose this Frame" });
    expect(button).toHaveAttribute("type", "button");
    expect(classes(button.className)).toEqual(expect.arrayContaining(["gb", "gb-confirm", "gb-lg", "gb-wrap", "ml-auto"]));
  });
});

describe("viewer", () => {
  it("maps a campaign role to a viewer: the GM is gm, everyone else player", () => {
    expect(viewerFor("gm")).toBe("gm");
    expect(viewerFor("player")).toBe("player");
  });

  function Probe() {
    return <span data-testid="probe">{useViewer() ?? "none"}</span>;
  }

  it("is null outside a campaign and ViewerScope adds no attribute there", () => {
    render(
      <ViewerScope>
        <Probe />
      </ViewerScope>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
    expect(screen.getByTestId("probe").parentElement).not.toHaveAttribute("data-viewer");
  });

  it("ViewerScope gives portalled content the campaign's viewer, with no box of its own", () => {
    render(
      <ViewerProvider viewer="gm">
        <ViewerScope>
          <Probe />
        </ViewerScope>
      </ViewerProvider>,
    );
    const scope = screen.getByTestId("probe").parentElement!;
    expect(scope).toHaveAttribute("data-viewer", "gm");
    expect(scope).toHaveClass("contents");
    expect(screen.getByTestId("probe")).toHaveTextContent("gm");
  });
});

describe("Modal", () => {
  it("closes with a round cancel icon button", () => {
    // jsdom has no showModal.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Players">
        <p>Body</p>
      </Modal>,
    );
    const close = screen.getByRole("button", { name: "Close players", hidden: true });
    expect(classes(close.className)).toEqual(expect.arrayContaining(["gb", "gb-cancel", "gb-icon", "gb-round"]));
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
