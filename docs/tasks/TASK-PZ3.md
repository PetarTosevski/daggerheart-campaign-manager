# TASK-PZ3: The close-up in the phone app

Status: Review (plan `.omc/plans/portrait-frame.yaml`, tracer PZ3; bead dcm-v47a)

The phone app's party card and character sheet (Identity) show a character's saved portrait close-up
(`sheet.portraitFrame`, set on the website, PZ1). **Display only: the phone does not edit the frame**; there is no
Adjust control in the app.

## What was built

- `apps/mobile/src/features/party/portrait.tsx`: `PortraitControl` takes `portraitFrame`. The pure
  `portraitImageFrame(frame)` turns it into expo-image props with PZ1's `clampPortraitFrame`: `contentFit="cover"`,
  `contentPosition={{ left: "x%", top: "y%" }}` (aligns like CSS `background-position`) and
  `transform: [{ scale: zoom }]` with `transformOrigin: "x% y%"` (percent transform origin, React Native 0.74+; the
  app is on 0.88). The round 56 px mark (`overflow: hidden`) clips; only the picture scales.
- Without a frame `portraitImageFrame` is null and the picture renders exactly as before (cover, centred, rounded).
- `features/party/card.tsx` and `features/sheet/identity.tsx` pass `sheet.portraitFrame` (already on
  `charactersReads.get` / `listByCampaign`, so no query changed).

## Decisions not in the plan

- A framed picture drops its own `borderRadius`: scaled about an off-centre point its rounded corners would cut into
  the mark's circle. The mark's clipping keeps the shape round.
- No frame keeps today's centred cover (not the website's "center 30%" default), as the plan asks for no change.

## Checks

- `apps/mobile/test/party/portrait-frame.test.tsx`: with and without a frame, and out-of-range values clamped.
- `pnpm --filter @dualityheart/mobile run check`. Not run on a device.
