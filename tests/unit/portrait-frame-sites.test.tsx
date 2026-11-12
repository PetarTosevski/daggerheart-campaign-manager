/**
 * Plan portrait-frame, PZ2: every website site that draws a character's portrait shows the saved close-up through
 * PZ1's style helper inside a clipping frame, and draws exactly as before without one. Sites: `CharacterPortrait` (both
 * sizes: Party card, roster banner, Journal tally), the Settings avatars (shell avatar, Players roster face), the HUD
 * `Portrait` (banners, spotlight disc, sheet panel, phone strip), the HUD token face (`artOf` + `TokenFace`) and the
 * classic token (`framedTokenPicture`).
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { TokenView } from "../../convex/combatTokens";
import type { CharacterView } from "../../convex/lib/validators/characters";
import { Portrait } from "@/components/combat-map/hud/banners/banner";
import { TokenFace } from "@/components/combat-map/hud/token/face";
import { artOf, framedImageStyle, pcTokenFace } from "@/components/combat-map/hud/token/model";
import { framedTokenPicture } from "@/components/combat-map/tokens/tokens-layer";
import { Face } from "@/components/config/sections/players/roster";
import { AvatarFace } from "@/components/config/shell/avatar";
import { CharacterPortrait } from "@/components/party/portrait";

let party: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => (args === "skip" ? undefined : party),
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

const FRAME = { zoom: 2, x: 40, y: 25 };
const URL_ = "https://example.test/ash.jpg";

const sheet = (frame?: typeof FRAME) => ({
  name: "Ash",
  classId: "warrior",
  subclassId: "call-of-the-brave",
  ancestry: { kind: "single" as const, id: "human" },
  portrait: { kind: "upload" as const, storageId: "st" as Id<"_storage"> },
  ...(frame ? { portraitFrame: frame } : {}),
});

const character = (frame?: typeof FRAME) => ({ _id: "c1" as Id<"characters">, sheet: sheet(frame), portraitUrl: URL_ });

const img = (container: HTMLElement) => container.querySelector("img")!;

describe("CharacterPortrait", () => {
  it("square, no frame: the portrait itself carries the picture, as before", () => {
    const { container } = render(<CharacterPortrait character={character() as never} size={76} />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.backgroundImage).toContain(URL_);
    expect(span.style.backgroundPosition).toBe("center 30%");
    expect(span.className).not.toContain("overflow-hidden");
    expect(container.querySelector("[data-testid='character-portrait-layer']")).toBeNull();
  });

  it("square, framed: a clipped inner layer carries the close-up; the frame is not scaled", () => {
    const { container } = render(<CharacterPortrait character={character(FRAME) as never} size={76} />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.backgroundImage).toBe("");
    expect(span.style.transform).toBe("");
    expect(span.className).toContain("overflow-hidden");
    expect(span.className).toContain("border-2");
    const layer = container.querySelector<HTMLElement>("[data-testid='character-portrait-layer']")!;
    expect(layer.style.backgroundImage).toContain(URL_);
    expect(layer.style.backgroundPosition).toBe("40% 25%");
    expect(layer.style.transform).toBe("scale(2)");
    expect(layer.style.transformOrigin).toBe("40% 25%");
  });

  it("banner, no frame and framed", () => {
    const plain = render(<CharacterPortrait character={character() as never} size="banner" />).container.firstElementChild as HTMLElement;
    expect(plain.style.backgroundImage).toContain(URL_);
    expect(plain.querySelector("[data-testid='character-portrait-layer']")).toBeNull();

    const framed = render(<CharacterPortrait character={character(FRAME) as never} size="banner" />).container.firstElementChild as HTMLElement;
    expect(framed.style.backgroundImage).toBe("");
    expect(framed.className).toContain("overflow-hidden");
    const layer = framed.querySelector<HTMLElement>("[data-testid='character-portrait-layer']")!;
    expect(layer.style.transform).toBe("scale(2)");
    expect(layer.style.backgroundPosition).toBe("40% 25%");
  });

  it("a frame with no picture (initial) changes nothing", () => {
    const initial = { _id: "c1" as Id<"characters">, sheet: { ...sheet(FRAME), portrait: undefined, subclassId: "none", ancestry: { kind: "single" as const, id: "none" } } };
    const { container } = render(<CharacterPortrait character={initial as never} size={76} />);
    expect(container.querySelector("[data-testid='character-portrait-layer']")).toBeNull();
    expect(container.textContent).toBe("A");
  });
});

describe("Settings avatars", () => {
  it("the shell avatar: object-position only without a frame, the close-up with one", () => {
    party = [{ ...character(), canEdit: true }];
    const plain = img(render(<AvatarFace campaignId={"k" as Id<"campaigns">} isGm={false} />).container);
    expect(plain.style.objectPosition).toBe("center 30%");
    expect(plain.style.transform).toBe("");

    party = [{ ...character(FRAME), canEdit: true }];
    const framed = img(render(<AvatarFace campaignId={"k" as Id<"campaigns">} isGm={false} />).container);
    expect(framed.style.objectPosition).toBe("40% 25%");
    expect(framed.style.transform).toBe("scale(2)");
    expect(framed.style.transformOrigin).toBe("40% 25%");
    expect(framed.parentElement!.style.transform).toBe("");
  });

  it("the Players roster face", () => {
    const plain = img(render(<Face name="Pat" character={character() as unknown as CharacterView} />).container);
    expect(plain.style.objectPosition).toBe("center 30%");
    expect(plain.style.transform).toBe("");
    const framed = img(render(<Face name="Pat" character={character(FRAME) as unknown as CharacterView} />).container);
    expect(framed.style.objectPosition).toBe("40% 25%");
    expect(framed.style.transform).toBe("scale(2)");
  });
});

describe("HUD Portrait (banners, spotlight disc, sheet panel, phone strip)", () => {
  it("no frame: as before; framed: only the picture scales, the ring does not", () => {
    const plain = render(<Portrait member={{ name: "Ash", mine: true, portrait: { kind: "url", url: URL_ } }} />).container;
    expect(img(plain).style.objectPosition).toBe("center 25%");
    expect(img(plain).style.transform).toBe("");

    const framed = render(<Portrait member={{ name: "Ash", mine: true, portrait: { kind: "url", url: URL_, frame: FRAME } }} />).container;
    expect(img(framed).style.objectPosition).toBe("40% 25%");
    expect(img(framed).style.transform).toBe("scale(2)");
    expect(img(framed).style.objectFit).toBe("cover");
    const ring = framed.querySelector<HTMLElement>(".hbn-face")!;
    expect(ring.style.transform).toBe("");
  });
});

function token(portrait: TokenView["portrait"]): TokenView {
  return {
    _id: "tok" as Id<"combatTokens">,
    kind: "pc",
    characterId: "c1" as Id<"characters">,
    side: "pc",
    x: 1,
    y: 1,
    size: 1,
    face: 0,
    light: "none",
    name: "Ash",
    sub: "",
    portrait,
    canMove: true,
    mine: true,
    stats: { hp: 1, hpMax: 6, stress: 0, stressMax: 6, conditions: [], down: false },
  };
}

describe("map tokens", () => {
  it("artOf carries the frame; framedImageStyle is the helper's output as object-position + scale", () => {
    expect(artOf({ kind: "url", url: URL_ })).toEqual({ src: URL_, position: "center 25%", remote: true });
    expect(artOf({ kind: "url", url: URL_, frame: FRAME })).toEqual({ src: URL_, position: "center 25%", remote: true, frame: FRAME });
    expect(framedImageStyle(undefined, "center 25%")).toEqual({ objectPosition: "center 25%" });
    expect(framedImageStyle(FRAME, "center 25%")).toEqual({ objectPosition: "40% 25%", transform: "scale(2)", transformOrigin: "40% 25%" });
  });

  it("the HUD token face: only the picture scales, never the face circle, ring or chips", () => {
    const plain = render(<TokenFace face={pcTokenFace(token({ kind: "url", url: URL_ }), "gm", 2)} name="Ash" initials="A" size={48} />).container;
    expect(img(plain).style.objectPosition).toBe("center 25%");
    expect(img(plain).style.transform).toBe("");

    const framed = render(<TokenFace face={pcTokenFace(token({ kind: "url", url: URL_, frame: FRAME }), "gm", 2)} name="Ash" initials="A" size={48} />).container;
    expect(img(framed).style.objectPosition).toBe("40% 25%");
    expect(img(framed).style.transform).toBe("scale(2)");
    expect(framed.querySelector<HTMLElement>(".tk-face")!.style.transform).toBe("");
    expect(framed.querySelector<HTMLElement>("[data-testid='hud-token-face']")!.style.transform).toBe("");
  });

  it("the classic token: no frame keeps the button's background; a frame gets a clipped picture layer", () => {
    expect(framedTokenPicture(token({ kind: "url", url: URL_ }))).toBeNull();
    expect(framedTokenPicture(token(null))).toBeNull();
    expect(framedTokenPicture(token({ kind: "url", url: URL_, frame: FRAME }))).toEqual({
      backgroundImage: `url(${URL_})`,
      backgroundPosition: "40% 25%",
      backgroundSize: "cover",
      transform: "scale(2)",
      transformOrigin: "40% 25%",
    });
  });
});
