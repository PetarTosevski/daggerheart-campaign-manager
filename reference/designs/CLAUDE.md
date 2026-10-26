# Daggerheart Campaign Manager

A GM-facing campaign manager for the Daggerheart TTRPG, built as boards on a claude.ai **Design canvas** artifact.
Every screen is one self-contained `.dc.html` file in `project/`. There is no build step: edit the files, test locally, then the files are uploaded back to the artifact.

## Layout
- `project/*.dc.html` — one file per board (screen). `project/canvas.json` — board positions/sizes on the canvas.
- `project/support.js` — the canvas runtime (React + the dc template engine). Identical to what the canvas serves. Do not edit.
- `tools/` — one-off Python/JS patch scripts used to generate or modify boards (reference only; most are already applied).
  `gen_frames.py` / `gen_custom.py` regenerate the 10 Hub*/Tome* frame dashboards from `CampaignHub.dc.html`.
- `tests/smoke.js` — loads every board headless and flags errors/blank pages.
- `tracker/issues.jsonl` — exported beads issues (open bugs + feature notes). Import with `bd import` or just read it.

## Boards
- Title & setup: `TitleMenu`, `Chronicle` (load campaign), `FrameSelect` (pick campaign frame or Custom), `Witherwild`/`FiveBanners`/… (frame intros), `Tome*` (frame lore books).
- Campaign (shared nav: Dashboard, Party, World, Characters & Locations, Adversaries, Sessions, Notes):
  - `CampaignHub` + `Hub*` dashboards (one per frame), `HubCustom`.
  - `Party` — roster, character creation wizard, full character sheets, level-up, dice roller (3D dice), Hope & class features, photo import.
  - `World` — per-frame maps: pan/zoom, tokens, route measuring, terrain painting.
  - `Codex` — Characters & Locations with images (IndexedDB), allegiance/region, player view.
  - `Adversaries` — SRD stat block browser (paginated; see open bug dh-kws).
  - `Sessions` — Prep / Play / Wrap-up, live session start/end (syncs to Party sheets).
  - `Notes` — bullet journals per GM/player with optional PIN.

## The .dc.html format (important)
- Structure: `<x-dc><helmet>…styles/links…</helmet> …template… <script type="text/x-dc" data-dc-script>…</script></x-dc>`.
- Template holes: `{{ expr }}`. Loops: `<sc-for list="{{ items }}" as="it" hint-placeholder-count="N">`. Conditionals: `<sc-if value="{{ flag }}" hint-placeholder-val="{{ false }}">`. Always keep the `hint-*` attributes.
- Logic: `class Component extends DCLogic { renderVals() { return { …values and handlers… } } }`. State via `this.state` / `this.setState`. Module-level `const`s above the class are fine.
- NEVER write `{{` or `}}` inside the script (put a space: `} }`). The template engine scans the whole file. After edits, check the script has no new `{{`/`}}` (three pre-existing ones are inside JSON data constants and the `data-props` attribute — those are fine).
- Inputs: uncontrolled `defaultValue="{{ x }}"` or controlled `value="{{ x }}" onChange="{{ fn }}"`. Booleans as `true`/`null` (null removes the attribute).
- Boards render in separate iframes on the canvas; they share `localStorage` (same origin) and sync via the `storage` event.
- Assets/images live on the artifact as `/_blob/<id>` URLs; they won't load locally (backgrounds look blank in tests — that's expected).
- External scripts only from cdn.jsdelivr.net / cdnjs / unpkg with pinned versions (3D dice uses three@0.160.0 + cannon-es@0.20.0 via dynamic import).

## Data (all in localStorage, per campaign key `<key>` from `dh.active`)
- `dh.active` `{key, hub, name, blob}` — current campaign. `dh.settings` — app settings. `dh.custom`, `dh.custom.tome` — custom frame.
- `dh.<key>.party` — characters `[{cls, clsName, hpMax, stressMax, hp, stress, hope, armor, scars, hfx, cf, f:{…sheet fields…}}]`.
  `cf` = class-feature state (rally, prayer, unst, focus, favor, hexes, sessNote…).
- `dh.<key>.fear` (GM Fear 0–12), `dh.<key>.sessions`, `dh.<key>.live` (running session `{id,n,at}`), `dh.sessions.intent`, `dh.sessions.open`.
- `dh.<key>.map` (tokens, terrain grid 128×98, options), `dh.<key>.mapFocus`, `dh.<key>.codex`, `dh.<key>.codexFocus`.
- `dh.<key>.journal[.pc-slug]`, `dh.<key>.journalWho`, `dh.<key>.journalPins`. `dh.dice3d`, `dh.dice3d.sound`.
- Images: IndexedDB `dh-images` / store `img`.

## Testing locally
```
cd project && python3 -m http.server 8765      # serve the boards
node tests/smoke.js                            # every board: errors / blank check
```
Open `http://127.0.0.1:8765/Party.dc.html` etc. in a browser to click around. Seed state with `localStorage.setItem(...)` in devtools.

## Open work (see tracker/issues.jsonl)
- dh-kws (P0): Adversaries board blank in the canvas (fine locally). Now paginated; next suspects: 280 KB inline data → move to a separate file; canvas DOM limits.
- dh-ned (P1): live encounter tracker on Adversaries (conditions, Hex/Focus/Marked effects on adversaries, Fear spending).
- Photo import on Party: verify `claude.use('sample')` is reachable from board iframes on claude.ai; map background/connections/advancements.
- dh-6zq: shared storage for player images/notes. dh-cgl: remove test unlock buttons and the seeded "Test Bard". dh-pd8: custom mechanics on non-Witherwild dashboards.

## Rules for changes
- Keep edits surgical; these files are large (Party ≈ 600 KB). Use targeted search/replace, not rewrites.
- Re-run `tests/smoke.js` after changes. Mention anything you couldn't verify.
