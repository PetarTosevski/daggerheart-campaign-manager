# TASK-CONFIG-U6d: Ping me when I get the spotlight

Plan `.omc/plans/config.yaml`, tracer U6d (bead dcm-jh6d.23), user answer Q14 a. Client only; no Convex change.

## What it does

`SpotlightPing` (`src/components/config/spotlight-ping.tsx`), mounted once per campaign page by `ConfigMounts` (S1).
When the spotlight moves to a PC the viewer owns and the account's `spotlightPing` is on:

- a soft chime (`public/sounds/spotlight-ping.wav`, two sine notes A5 then E6 with a short decay, 1.2 s, generated for
  this tracer) at the dice volume (`diceVolume / 100`). No chime while `diceSound` is off or the volume is 0; the toast
  still shows.
- the toast "You have the spotlight" (`role="status"`, bottom centre). It hides after 5 s (`PING_TOAST_MS`) or as soon as
  the spotlight moves on. It fades in with `motion-safe:` (tw-animate-css); with the account's Reduce motion on, it has
  no animation. That covers both the device setting and the account setting until U6b's `[data-reduce-motion]` lands.

## Rules

- **Reads:** `preferences.get`, `combatSpotlight.state` (the subscription the HUD's spotlight parts share, deduplicated
  by Convex), and `charactersReads.get` (its `mine`) for one PC. The last one runs only after the spotlight has just
  moved to a PC, and only until the owner is known. No new server function.
- **When:** a change is the holder plus its `since`. First load never pings, even when your PC already holds the
  spotlight. A repeat of the same position (an idempotent `handTo`) doesn't ping. Getting the spotlight back after
  someone else held it does. The GM, "the whole party" (holder null) and other players' PCs never ping.
- **GM and co-GM:** no subscriptions and no ping. Only the GM moves the spotlight, so the GM's own takes and hands are
  never announced to them.
- **Pref off:** the spotlight query is skipped. Turning the pref back on counts as a first load.
- **Rule 13:** no effect writes state from render data. The change is derived during render with React's
  "adjust state when a prop changes" pattern. One effect plays the sound, guarded by a ref so StrictMode or a volume
  change doesn't replay it. One timer clears the toast from its callback. Nothing writes to the server.

## Tests

`tests/unit/spotlight-ping.test.tsx` mocks `convex/react` with a holder sequence and stubs `Audio`. It covers: no ping
on first load; chime at 0.4 for volume 40 plus the toast, with no replay on a re-render and the toast hidden after 5 s;
GM, party and another player's PC ignored; a ping again after the GM held it; dice sound off gives the toast without the
chime; pref off and GM skip the queries; waiting for the character query; Reduce motion turns the fade off.

## Not done

- No e2e spec: none is in this tracer's owns. SX's `live-config.spec.ts` can cover it in two browsers.
- No browser notification while the tab is hidden (that's Q14 b, not chosen).

## Out of owns

None.

## Questions

None. Q14 a as answered. N1-N11 don't touch this tracer.
