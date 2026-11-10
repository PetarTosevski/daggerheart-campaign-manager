# Phone client

Status as of 5 November 2026. Work is paused here. This is the handoff for review.
The per-slice notes stay in `docs/tasks/TASK-PH-*.md`. Those notes describe how each
slice was built. This file describes the app as it stands on `phone/A1-on-master`.

## What it is

`apps/mobile` (`@dualityheart/mobile`) is the iOS and Android client for the same
app as the website. It uses the website's Convex deployment and the same campaign
roles. A player sees the player view. A GM sees the GM view. The device does not
change permissions. Hidden information stays enforced by `permissionFor`.

The Next.js site and `convex/` stay at the repository root. Do not move the site
into `apps/web`. Do not run `eas integrations:convex:connect`. That command creates
a second Convex project.

Sign-in is email and password, the same accounts as the website. Google and Apple
buttons stay off unless `EXPO_PUBLIC_SOCIAL_SIGN_IN=true`. Those values are not
committed. Apple Sign In in an iOS binary still needs the Apple identity work that
already lives in `convex/auth.ts`, plus Apple and Google credentials that are not
in this change. Do not submit a store build until those credentials exist.

Journal is not on the phone. The website's journal tab is unfinished.

## How to run it

From `apps/mobile`, with `EXPO_PUBLIC_CONVEX_URL` set to the same deployment the
website uses:

```bash
pnpm exec expo start --dev-client
```

The development bundle id is `com.dualityheart.mobile.dev` and the scheme is
`dualityheart-dev`. Preview builds use `com.dualityheart.mobile.preview` and
`dualityheart-preview`; production uses `com.dualityheart.mobile` and `dualityheart`
(`apps/mobile/app.config.ts`, `APP_VARIANT`). Sign in with Apple accepts the dev
build's bundle id only on a local deployment or where `ALLOW_DEV_APPLE_SIGN_IN=true`
is set (`npx convex env set`, the cloud dev deployment only, never production); the
store and preview ids work everywhere (`convex/lib/appleIdentity.ts`). Store config is `apps/mobile/eas.json`. This branch has not been
submitted to TestFlight or the Play internal track.

`pnpm --filter @dualityheart/mobile run check` runs ESLint, `tsc --noEmit`, and
Jest. The full iOS and Android Metro export (`export:check`) is local only. It is
not part of the Ubuntu CI job.

## What is on this branch

The branch is `phone/A1-on-master`, replayed onto current `master`. It contains
the Expo app and the small shared changes that app needs (Apple and native
redirect handling in Convex auth, the workspace and CI wiring, and the phone
tests).

Screens, in the bottom bar and the More menu:

- Sign-in, home, settings, join, and new campaign.
- Campaign dashboard, party and character sheet, combat map, and sessions.
- World, Characters and Locations, notes, Lorekeeper, and the campaign tome.
- GM only: adversaries, sprite packs, combat tools, and combat and world editing.

Dice on the phone play the numbers the server returned. The phone does not roll
locally and then submit that roll.

## Combat map, checked on a simulator

Checked on the iPhone 17 simulator against the live site, signed in as a player
on a Witherwild campaign:

- The map fills the width of the phone. Fit frames the battlefield, not the empty
  fog margin around it. The zoom read about 260%.
- Party banners and GM Fear sit on top. Fear matched the table (9).
- Pinch and drag work. Zoom controls sit under the map.
- Sprite maps draw the website's pictures from `https://dualityheart.com/sprite-packs/`.
  A frozen clearing showed grass, trees, rocks, and the lake, instead of the
  earlier green and magenta stand-in.

A second campaign, where the same account is GM, had no live map. The screen said
to generate or upload one on the website. This pause adds buttons on that empty
GM screen (`New Small map`, `New Medium map`, `New Large map`, and Make live for a
saved map). Those buttons call `combatMaps.create` and `combatMaps.setLive`. They
were not tried on the simulator. A player with no live map still only sees "The GM
has not shown a map yet" and does not call `combatMaps.list`.

Move, cards, and attacks stay hidden until `combatVision.playerView` is `ok` for
that map. That means the signed-in person has a character on that battle. The
player campaign used for the check had no such character, so the action button
never appeared. That is the server view, not a missing control.

## Combat map: paint budget and device checks (PX14)

The combat map is behind a flag (`apps/mobile/src/features/combat-map/flag.ts`): on in development builds, off in
a release build unless `EXPO_PUBLIC_PHONE_COMBAT_MAP=1` (`=0` turns it off in development too). With the flag off
the screen says the map is on the website.

How it paints now:

- The base map is painted once per change of what the painter reads (`paintKey`: terrain, areas, objects, cells,
  style), at 48 px a square with the long side capped at 2048 px, without the fog margin. It stays a Skia image; no
  pixels are copied into JavaScript. Token moves, the name, `updatedAt` and GM fog marks do not repaint it.
- Sprite files are decoded once and kept by URL (up to 160) across paints. Sprite origins follow
  `EXPO_PUBLIC_SITE_URL`.
- Object shadows use an offscreen layer the size of the surface plus the shadow's reach, not three surfaces wide.
- A player's fog is a small image (the map plus two squares at 12 px a square), rebuilt only when the vision text
  or the stored explored area changes. Past it, the screen background is the unseen fog colour.
- Pan and pinch use the world map's `useMapGesture` (per-frame deltas, pinch about the fingers) writing Reanimated
  shared values; the Skia group transform and the token layer follow them. A drag or pinch re-renders nothing; the
  zoom label updates when the drag ends.
- `paintStats` (`combat-map/paint-stats.ts`) counts base paints, fog builds and sprite decodes and keeps the last
  paint times. `test/features/combat-view/paint-budget.test.tsx` checks 300 gesture frames make no paint and no
  React commit, and 20 live updates with the same paint inputs make no paint.

Check on a real iPhone and a mid-range Android phone (not done; no simulator in the agent run):

- [ ] A Large sprite map paints in under about a second after its pictures are cached, and a second visit or a token
      move does not repaint (read `paintStats.lastBaseMs` and `paintStats.base` from the debugger).
- [ ] Panning and pinching a Large map holds 60 fps (Perf Monitor), with the dock open and closed.
- [ ] Pinch zoom keeps the square under the fingers there, has no jitter and does not run away; two-finger drag
      pans; Fit frames the battlefield.
- [ ] Token initials stay readable at full zoom (the token layer is scaled by a transform).
- [ ] A player sees fog on a generated map and on an uploaded image map; the image lines up with the tokens'
      squares; explored areas stay after the character walks away and come back after reopening the app.
- [ ] The GM sees every token (adversaries included) and no fog.
- [ ] The dim-light badge shows in dim light with Darkness on Book and not on Manual.
- [ ] The dock scrolls when panels are open and the map keeps at least 240 pt.
- [ ] Zoom buttons and target chips are easy to hit (44 pt).
- [ ] Android: no blank map on a GPU with a 4096 px texture limit.
- [ ] Painter speed on large maps: a 30 x 20 Classic map and a 30 x 20 Sprites map each paint (first open, then
      after a terrain edit) without a visible freeze; note `paintStats.lastBaseMs` for both. Jest does not measure
      this: the screen tests replace the shared terrain painters with no-ops
      (`test/features/combat-view/map-mocks.tsx`) so big maps stay fast there.

## Combat play and GM tools: device checks (PX15)

Covered by jest with the Convex fixtures; still to try on a phone against a real deployment:

- [ ] A self card (no target) plays with one tap; an area card plays without picking targets.
- [ ] Exhausted cards show greyed out and cannot be played.
- [ ] An out-of-range attack (Out of range: Ask) waits for the GM's answer; with Refuse it is refused.
- [ ] Line of sight on Book blocks a target behind a wall; on Manual the attack goes through.
- [ ] A secondary weapon and a tier-2 weapon attack with their own range and damage.
- [ ] The Minion picker spreads extra damage over Minions; with Minions on "GM picks" the player waits for the GM.
- [ ] Rousing Strike shows the ally card and the chosen ally gets the effect.
- [ ] A GM adversary attack picks a target and the result reaches that player's phone.
- [ ] The GM's fog brush paints with one finger; a two-finger pinch zooms and paints nothing.
- [ ] View as PC shows the map as that character sees it, and back.
- [ ] Doors open and close from the GM tools and block sight when closed.
- [ ] Per-PC reveal shows an area to one character only.
- [ ] In the editor, dragging an object moves it (and a drag off every object pans).

## Builds and store identity: device checks (PX16)

- [ ] The status bar text is light on the dark background, with the system in light mode too (iOS and Android).
- [ ] A preview build installs beside the store app, with its own name "Duality Heart (preview)" and icon label.
- [ ] A development build is named "Duality Heart (dev)" and installs beside both.
- [ ] The Vercel build log of the website shows no `expo`, `react-native` or `@shopify/react-native-skia` packages
      installed (the install is filtered to the web workspace).

## Polish and account: device checks (PXL)

- [ ] The splash stays up until the fonts load; no text flashes in the system font.
- [ ] Sign-in: the form sits inside the safe area, scrolls clear of the keyboard on a small phone, and the buttons
      stay tappable with the keyboard up.
- [ ] Offline (airplane mode in a campaign): the banner reads "You're offline. Showing the last update." and writes
      are off.
- [ ] Dates read day then month ("Sun 2 Nov") in the Journal and the campaign list, whatever the phone's region.
- [ ] Load Campaign lists archived campaigns under "Archived": Open for every member, Restore for the creator.
- [ ] Players: the creator makes a member co-GM and back, invites by email as Player or Co-GM; a co-GM can remove
      players but not other co-GMs.

## Not done

- The app is portrait only (`orientation: "portrait"` in `apps/mobile/app.config.ts`).
  Letting the combat map turn sideways was discussed and not built. The installed
  development app was compiled portrait-only, so a later change also needs a new
  dev-client build before the simulator can rotate.
- Painting a sprite map still runs on the JavaScript thread. PX14 cut the shadow
  layer and the fog margin and paints only when the layout changes; a change to
  one object still repaints the whole map (the website repaints only the changed
  rectangle). Check the time on a device (list above).
- The website's phone combat HUD is not ported. There is no spotlight, and no
  Hand / Attack / Dice / Feed sheet. The phone uses the party strip, Fear, the
  zoom dock, and the existing play and GM panels.
- Store submit, push notifications, and offline Hope, Fear, and log writes are out.
- Rotation, the paint freeze, and a pass of the empty GM map buttons on a device
  are the open follow-ups.
