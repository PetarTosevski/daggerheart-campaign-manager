# TASK-HD4: Uploads stay sharp on a 4K screen

Plan `.omc/plans/sharp-4k.yaml`, wave 1, tracer HD4; bead dcm-ggk3.2. Client only; no server change, no codegen.
Images uploaded before this change stay as they are.

## What changed

- **Portraits** (`src/components/party/portrait.tsx`): the long side goes from 1024 px to 2048 px
  (`PORTRAIT_MAX_SIDE`). The shrink is now the exported `shrinkPortrait`.
- **Codex images** (`src/app/(gm)/campaigns/[campaignId]/codex/gallery.tsx`): the long side goes from 1800 px to
  2560 px (`CODEX_IMAGE_MAX_SIDE`). The shrink is now the exported `shrinkCodexImage`.
- **Quality fallback** (`encodeJpegWithin` in `portrait.tsx`, used by both): encode at JPEG 0.86 as before; if the blob
  is over the server's byte cap, try 0.8, then 0.72, then 0.6 (`JPEG_QUALITIES`). If nothing fits, the smallest try is
  uploaded and the server turns it down with its usual message (this never happens in the measurements below).
- The byte caps used on the client:
  - Codex: `MAX_CODEX_IMAGE_BYTES` imported from `src/lib/codex/schema.ts`, the same constant `convex/codex.ts` checks.
  - Portraits: `MAX_PORTRAIT_BYTES` lives in `convex/characters.ts`, a server module. `portrait.tsx` keeps a local
    `PORTRAIT_MAX_BYTES` with the same value and a comment that points to the server constant.
- Comments that gave the old sizes (1024px, 1800px) now name the constants. No UI text gave a pixel size.

## Server caps (unchanged)

| Upload  | Server cap                                                  | New max size         |
| ------- | ----------------------------------------------------------- | -------------------- |
| Portrait | `MAX_PORTRAIT_BYTES = 3 * 1024 * 1024` (`convex/characters.ts`) | 2048 px long side |
| Codex   | `MAX_CODEX_IMAGE_BYTES = 3 * 1024 * 1024` (`src/lib/codex/schema.ts`, checked in `convex/codex.ts` `attachImage`) | 2560 px long side |

## Evidence: worst-case JPEG sizes

Measured with sharp 0.35.5 (libjpeg-turbo, 4:2:0, as browsers encode) on per-pixel uniform RGB noise, the worst case
for JPEG. "Grain" is the same noise blurred by sigma 0.8, closer to a very noisy photo. MiB = 1,048,576 bytes; the caps
are 3 MiB.

| Size        | Content | q 0.86   | q 0.8    | q 0.72   | q 0.6    |
| ----------- | ------- | -------- | -------- | -------- | -------- |
| 2048 x 1536 | noise   | 2.20     | 1.90     | 1.63     | 1.33     |
| 2048 x 2048 | noise   | 2.93     | 2.54     | 2.18     | 1.78     |
| 2560 x 1920 | noise   | **3.43** | 2.97     | 2.55     | 2.08     |
| 2560 x 1920 | grain   | 2.09     | 1.66     | 1.31     | 1.01     |
| 2560 x 2560 | noise   | **4.58** | **3.97** | **3.40** | 2.78     |
| 2560 x 2560 | grain   | 2.79     | 2.22     | 1.75     | 1.35     |

So a portrait (at most 2048 x 2048) always fits at 0.86. A square Codex image of pure noise needs 0.6, and a
4:3 one needs 0.8. Real photos sit well under these rows. The server caps can stay at 3 MB.

## Tests

- `tests/unit/portrait-upload-size.test.ts`: a 4000 x 3000 source encodes as 2048 x 1536 at 0.86; the quality steps
  0.86 -> 0.8 -> 0.72 until it fits 3 MB; when nothing fits, all four qualities are tried and the smallest is returned;
  a small picture keeps its own size.
- `tests/unit/codex-gallery-upload-size.test.ts`: a 4000 x 3000 source encodes as 2560 x 1920 at 0.86; a 3000 x 4000
  one as 1920 x 2560; with the measured noise sizes it steps to 0.8 and fits `MAX_CODEX_IMAGE_BYTES`.

Commands: `pnpm exec vitest run --maxWorkers=2 tests/unit/portrait-upload-size.test.ts
tests/unit/codex-gallery-upload-size.test.ts` (7 passed), `pnpm lint` (0 errors), `pnpm typecheck` (passes).
