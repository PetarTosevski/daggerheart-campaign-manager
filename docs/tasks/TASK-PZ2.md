# TASK-PZ2: The portrait close-up everywhere on the website

Status: Review (plan `.omc/plans/portrait-frame.yaml`, tracer PZ2; bead dcm-v47a)

The saved close-up (`sheet.portraitFrame`, PZ1) shows wherever the website draws a character's portrait. A character
without a frame draws exactly as before: every site keeps its old style when there is no frame.

## Data

`convex/lib/pcPortrait.ts`: `tokenPortraitValidator` is widened with an optional `frame` (`portraitFrameValidator`) on
the `url` and `asset` variants, and `pcPortrait` returns the sheet's frame with the portrait (no frame: no `frame` key).
The token views (`combatTokensReads.list`) and vision views (`combatVision.playerView`'s PC tokens) carry it through
`tokenViewValidator`. `CharacterPortrait` and the Settings avatars read `sheet.portraitFrame` from the sheet they
already have (`partySummary`, `listByCampaign`).

## Sites

| Site | How it draws the frame |
| --- | --- |
| `CharacterPortrait` (Party card, roster banner, Journal tally) | framed: the portrait clips (`overflow-hidden`) and an inner `absolute inset-0` layer carries the picture with `portraitFrameStyle`; unframed: the old inline background |
| Settings shell avatar, Players roster face | next/image inside the round `.cfg-face` (already clipped): the helper's position as `object-position`, plus its `transform`/`transform-origin` |
| HUD `Portrait` (banners, spotlight disc and its 2 x 2 minis, HUD sheet panel, phone strip, spotlight rows) | next/image inside `.hbn-face` (already clipped) via `framedImageStyle` (token/model.ts) |
| HUD token face | `artOf` carries `frame` on `TokenArt`; `TokenFace`'s img uses `framedImageStyle` inside `.tk-face` (clipped) |
| Classic token (tokens layer) | framed: the button keeps its ring, shadow, badges and the side gradient; a clipped `.cm-pic` holds a `.cm-pic-layer` with the picture via `portraitFrameStyle` (`framedTokenPicture`) |

`framedImageStyle(frame, fallback)` turns the helper's output into `<img>` styles (`object-position` = the helper's
background position, which aligns a cover picture the same way) without editing the helper.

Not changed: `vision/vision-layer.tsx` draws only `others` (non-PC tokens, which never have a frame); PCs in a
player's vision view are drawn by the tokens layer. `spotlight/disc.tsx`, `spotlight/model.ts`, `sheet/panel.tsx`
and `phone/strip.tsx` draw PCs through the HUD `Portrait`, so they needed no change of their own.

## Needed outside this tracer's owns

`convex/lib/combatHud.ts` spells out its own `portraitValidator` for `hudPartyMemberValidator` (the `combatHud.party`
returns). It must get the same optional `frame` on both object variants, or `combatHud.party` fails return validation
for a character with a frame (verified with a probe test). Until then the HUD banners, disc, sheet panel and phone strip
get no frame (and the query throws for a framed PC).

## Checks

`tests/unit/portrait-frame-sites.test.tsx`, `tests/convex/portrait-frame-tokens.test.ts`,
`tests/e2e/portrait-frame-everywhere.spec.ts`. The e2e spec fails on this branch alone at the map step (the tokens
layer shows "Tokens failed to load" from `combatHud.party`) and passes once `convex/lib/combatHud.ts` gets the `frame`
field above (checked with that change applied locally, not committed).
