// Plan glass-buttons GZ (docs/tasks/TASK-GLASS-GZ.md): every action button outside the allowed places is a glass
// button (BrandButton / brandButton / glassButtonClass). This guard scans the class strings in src/**/*.{ts,tsx} and
// fails on the old hand-styled patterns:
//
// - a per-area button class: a class token with a `btn` or `ghost` part (`cm-btn`, `trk-btn-sm`, `cx-ghost`), or one of
//   the other per-area button classes the briefs' inventory listed (`cm-go`, `zbtn`, `adx-primary`, `env-act`, …);
// - the Tailwind ghost button: `border` + `bg-transparent` + `hover:bg-white/5` in one class string.
//
// A file may keep such classes only if it is in ALLOWED below, with the reason. Each entry must still match, so the
// list shrinks as places move to glass. A new hand-styled button: use BrandButton with a role (role map in
// src/components/brand/buttons.tsx) instead of adding the file here.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const SRC = join(ROOT, "src");

/** Path prefixes (a folder) or exact files that may keep their own buttons, with the reason. */
const ALLOWED: Record<string, string> = {
  "src/components/config/prefs/house-rules.tsx": "the Preferences popover's House rules disclosure row (a full-width header toggle, not an action button)",
  // The Combat HUD keeps its own button classes (hud-btn, hud-glass-btn, …) on top of glassButtonClass.
  "src/components/combat-map/hud/": "the Combat HUD (out of scope; its buttons are already the design's)",
  // Rendered inside the HUD with the components' `glass` prop off: they keep the look the HUD tuned.
  "src/components/combat-map/vision/header.tsx": "the HUD dock's Player view (cm-pv-btn, styled by hud/dock/dock.css)",
  "src/components/adversaries/tracker/actions/choices.tsx": "the HUD stat block's Attack / Cancel (trk-btn, glass off)",
  "src/components/adversaries/tracker/actions/feature-use.tsx": "the HUD stat block's Use (trk-btn, glass off)",
  "src/components/adversaries/tracker/actions/result.tsx": "the HUD stat block's result buttons (trk-btn, glass off)",
  // Q3 = a: the character sheet keeps its own buttons (G14 / G15 skipped).
  "src/app/(gm)/campaigns/[campaignId]/party/[characterId]/": "the character sheet (Q3 = a)",
  "src/components/party/dice/": "the sheet's dice box and roll feed (Q3 = a)",
  "src/components/party/extras/": "the sheet's class extras (Q3 = a)",
  "src/components/party/features/": "the sheet's features panel (Q3 = a)",
  // The character wizard keeps its parchment buttons (user 2026-11-09: revert the wizard from glass); steps-5-9 also
  // holds the domain card faces (wz-dk-btn, design scope line).
  "src/app/(gm)/campaigns/[campaignId]/party/new/": "the character wizard's parchment buttons (wz-primary / wz-outline / wz-ghost / wz-close) and card faces",
  // Q5 = a: buttons on paper keep their ink-on-paper look. (The recap, the Lorekeeper answer card, the stat blocks and
  // the custom adversary editor use the shared ink button, brandButton({ ink: true }), so they need no entry.)
  "src/components/notes/": "the Notes paper (Q5 = a; bj-ghost / bj-paper-btn) and its rows (bj-page-btn, bj-jl-btn)",
  // Text that edits in place: a row title, not an action button.
  "src/components/journal/log/index.tsx": "the log line's title that edits in place (jl-title-btn, a row)",
  "src/components/journal/session-head/index.tsx": "the session date that edits in place (js-head-date-btn, text)",
};

/** Per-area button classes from the briefs' inventory that have no `btn` / `ghost` part. */
const INVENTORY = new Set([
  "cm-go",
  "cm-chip",
  "cm-linkbtn",
  "cm-danger",
  "zbtn",
  "lk-act",
  "lk-send",
  "adx-primary",
  "adx-danger",
  "enc-pill-primary",
  "enc-danger",
  "env-act",
  "bj-danger",
  "jp-danger",
  "js-danger",
  "wz-primary",
]);

/** `cm-btn`, `trk-btn-sm`, `cx-ghost`: a `btn` / `ghost` part after a prefix (a bare `ghost` is data: tokens, sprites). */
const BTN_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:btn|ghost)(?:-[a-z0-9]+)*$/;
const CLASS_TOKEN = /^[a-z][a-z0-9-]*$/;
const STRING = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** Comments name classes too (slots.ts docs); drop them. A `//` after a colon (a URL) is not a comment. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

/**
 * A class on a glass button is a layout modifier, not a hand-styled button: a string beside `gb`, a template that
 * calls brandButton / glassButtonClass, or a prop of the nearest `<BrandButton` tag.
 */
function onGlass(source: string, index: number, text: string, tokens: string[]): boolean {
  if (tokens.includes("gb") || /\b(?:brandButton|glassButtonClass|hudButtonClass)\(/.test(text)) return true;
  const tag = source.lastIndexOf("<", index);
  return tag >= 0 && source.startsWith("<BrandButton", tag) && !source.slice(tag, index).includes(">");
}

/** The hand-styled button classes in one file's source. */
function handStyled(raw: string): string[] {
  const source = stripComments(raw);
  const hits = new Set<string>();
  for (const m of source.matchAll(STRING)) {
    const text = m[1] ?? m[2] ?? m[3];
    const tokens = text.split(/\s+/).filter(Boolean);
    if (onGlass(source, m.index, text, tokens)) continue;
    for (const t of tokens) if (CLASS_TOKEN.test(t) && (BTN_PART.test(t) || INVENTORY.has(t))) hits.add(t);
    if (tokens.includes("border") && tokens.includes("bg-transparent") && tokens.some((t) => /^hover:bg-white\/(?:5|\[0\.05\])$/.test(t)))
      hits.add("border bg-transparent hover:bg-white/5");
  }
  return [...hits];
}

const allowedFor = (file: string) => Object.keys(ALLOWED).find((key) => (key.endsWith("/") ? file.startsWith(key) : file === key));

describe("button guard: no new hand-styled buttons", () => {
  const files = sources(SRC).map((path) => ({ file: relative(ROOT, path).split("\\").join("/"), hits: handStyled(readFileSync(path, "utf8")) }));

  it("finds the patterns it guards against", () => {
    expect(handStyled(`<button className="cm-btn cm-sm">`)).toEqual(["cm-btn"]);
    expect(handStyled(`const c = "trk-btn-parch";`)).toEqual(["trk-btn-parch"]);
    expect(handStyled(`<button className={"cx-ghost"} />`)).toEqual(["cx-ghost"]);
    expect(handStyled(`<button className="zbtn">`)).toEqual(["zbtn"]);
    expect(handStyled(`const BTN = "min-h-10 rounded border border-[#33444a] bg-transparent hover:bg-white/5";`)).toEqual([
      "border bg-transparent hover:bg-white/5",
    ]);
    expect(handStyled(`<button className="gb gb-confirm gb-wrap w-full">`)).toEqual([]);
    expect(handStyled(`<p className="trk-act-note">`)).toEqual([]);
    expect(handStyled(`<BrandButton variant="tool" className="cfg-acct-btn" />`)).toEqual([]);
    expect(handStyled(`<BrandButton variant="confirm" ink />`)).toEqual([]);
    expect(handStyled(`const c = "inkb inkb-main";`)).toEqual([]);
    expect(handStyled('className={`${brandButton({ variant: "tool" })} cfg-acct-btn`}')).toEqual([]);
    expect(handStyled('// the old `jr-ghost` class\nconst kind = "ghost";')).toEqual([]);
  });

  it("every hand-styled button class is in an allowed place", () => {
    const offenders = files.filter((f) => f.hits.length > 0 && !allowedFor(f.file)).map((f) => `${f.file}: ${f.hits.join(", ")}`);
    expect(offenders, "Use BrandButton / brandButton with a role instead (src/components/brand/buttons.tsx)").toEqual([]);
  });

  it("every allowed place still has a hand-styled button (drop the entry once it moves to glass)", () => {
    const stale = Object.keys(ALLOWED).filter((key) => !files.some((f) => f.hits.length > 0 && allowedFor(f.file) === key));
    expect(stale).toEqual([]);
  });

  it("the shadcn Button is gone (src/components/ui/button.tsx)", () => {
    expect(files.some((f) => f.file === "src/components/ui/button.tsx")).toBe(false);
    expect(files.filter((f) => readFileSync(join(ROOT, f.file), "utf8").includes("@/components/ui/button")).map((f) => f.file)).toEqual([]);
  });
});
