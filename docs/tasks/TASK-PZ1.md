# TASK-PZ1: Portrait close-up on the character sheet

Status: Review (plan `.omc/plans/portrait-frame.yaml`, tracer PZ1; bead dcm-v47a)

User 2026-11-12: "for the character portraits, let me zoom in if i want a close up shot of my character on the
portrait". An editor of the character presses **Adjust** on the sheet's portrait arch, sets a zoom (1x to 3x) and drags
the picture; Save stores it on the character and everyone sees that close-up. Works for uploads and built-in art
(default or chosen).

## What was built

- **Field** `sheet.portraitFrame?: { zoom, x, y }` (`src/lib/validation/character-schemas.ts`, Convex
  `portraitFrameValidator` in `convex/lib/validators/characters.ts`): zoom 1..3, x and y the focal point in percent of
  the picture, 0..100. Optional and widened (no `schemaVersion` bump); absent = today's framing. It also comes back on
  the dashboard's `charactersReads.partySummary` cards.
- **Mutation** `characters.setPortraitFrame({ characterId, frame: { zoom, x, y } | null })` (`userMutation`, returns
  null): allowed for whoever edits the character (`editable`, the same check as `attachPortrait`: owner and GM); others
  get `FORBIDDEN` (party member) or `NOT_FOUND` (outsider). Out-of-range values are `INVALID`; valid ones are rounded to
  the steps (zoom 0.05, position 0.1). `null` clears the frame. `attachPortrait` (a new upload) and `updateSheet` with a
  different `portrait` (another chosen art) clear it too.
- **Helper** `src/lib/party/portrait-frame.ts` (pure, import-free): the type, the default, the clamp, the drag maths and
  the style helper (below).
- **Sheet**: the arch (`Portrait()` in `sections/identity.tsx`) clips; its picture layer (`PortraitLayer`,
  `sections/portrait-frame.tsx`) gets its style from `portraitFrameStyle`. Editors see Adjust beside the upload button
  when the arch shows a picture. The editor (native `<dialog>` via `Modal`) has an arch-shaped preview (drag with pointer
  or touch, arrow keys move it, Shift for bigger steps), a labelled zoom slider, Reset, Cancel and Save. The preview is
  local state set when the dialog opens; Save sends one `setPortraitFrame` with an optimistic update on
  `charactersReads.get`, `listByCampaign` and `partySummary`. Saving the arch's own zoom-1 framing (Reset, then Save)
  sends `null`.

## Helper API (for PZ2 and PZ3)

```ts
type PortraitFrame = { zoom: number; x: number; y: number };
DEFAULT_PORTRAIT_FRAME                       // { zoom: 1, x: 50, y: 30 }
PORTRAIT_ZOOM_MIN, PORTRAIT_ZOOM_MAX, PORTRAIT_ZOOM_STEP   // 1, 3, 0.05
clampPortraitFrame(frame): PortraitFrame
portraitFrameOrDefault(frame | null | undefined): PortraitFrame
portraitFrameFromPosition(cssPosition): PortraitFrame       // zoom-1 frame drawing like "center 30%"
samePortraitFrame(a, b): boolean
coverOverflow(box, naturalSize | null): { width, height }
dragPortraitFrame(frame, { dx, dy }, box, overflow?): PortraitFrame
nudgePortraitFrame(frame, key, large?): PortraitFrame | null
portraitFrameStyle(frame | null | undefined, fallbackPosition): PortraitFrameStyle
```

**Website sites (PZ2):** keep the clipping element (`overflow: hidden`, the shape, rings, badges) and put the picture
on an inner layer that fills it (`position: absolute; inset: 0`, `background-size: cover`). Spread
`portraitFrameStyle(sheet.portraitFrame, <the position the site uses today>)` into that layer's `style` next to
`backgroundImage`. Without a frame the helper returns only `{ backgroundPosition: fallbackPosition }`, so the site
draws exactly as before. Never scale the clipping element itself. `PortraitLayer` in
`sections/portrait-frame.tsx` is the sheet's version of this.

**Phone (PZ3):** no CSS; use the numbers. `clampPortraitFrame(sheet.portraitFrame)` gives `zoom`, and `x`/`y` as
percent: scale the picture by `zoom` about the point (`x/100 * width`, `y/100 * height`) inside the clipped shape, with
the cover picture aligned at `x%`/`y%` the way CSS `background-position` aligns it. Display only.

## Decisions not in the plan

- The editor opens on the arch's current framing when no frame is saved (`portraitFrameFromPosition` of the art's own
  position), so nothing jumps; Reset goes back to it, and saving it clears the frame (`null`).
- Drag direction: the picture follows the pointer (drag right shows more of the picture's left, so x goes down); arrow
  keys move it the same way, 2% per press (10% with Shift).
- The drag maths uses the picture's natural size (loaded when the editor opens) so a zoom-1 picture that overflows the
  arch (a landscape) can still be panned.
- Out-of-range values are refused (`INVALID`), not clamped; in-range values are rounded to the steps.
- The Adjust button shows only when the arch shows a picture (not on the empty silhouette).
- The arch's action buttons are 44 px tall at 1100 px and below and on coarse pointers (tablet touch targets).

## Checks

- `tests/unit/portrait-frame.test.ts`, `tests/unit/portrait-frame-editor.test.tsx`, `tests/convex/portrait-frame.test.ts`,
  the `setPortraitFrame` entry in `tests/convex/authz/characters.entries.ts`, `tests/e2e/portrait-frame.spec.ts`.
