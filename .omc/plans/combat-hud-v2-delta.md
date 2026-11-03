# Combat HUD v2: what the updated design changes (2026-11-03)

Source: the user's Combat HUD canvas (claude.ai artifact `Jis5dC5ZwBodq8nFKo8byK`, version `1793709425-34ad`), saved
over the old export in `reference/designs/combat-hud/` (HANDOFF.md, canvas.json, 8 of the 12 boards; `preview/` was
regenerated from the boards with the same blob → `../assets/*.jpg` mapping as before; `assets/` is untouched: the binary
blobs can't be read through the artifact tools, and the HANDOFF's asset table is unchanged, so the old copies stay
valid). `git diff reference/designs/combat-hud` shows every change.

The user's brief for this version: "Here is the new design that should handle all of these issues" — the GM's
top-middle controls are two stacked cards that repeat each other ("Forest Camp" twice, "Areas" twice) and cover much
of the map, and the spotlight panel under them covers mid-map tokens.

Why there are two cards today: the HUD's title + GM toolbar (`hud/scene`, `.hud-scene`) and, under it, the classic
map toolbar that `MapBoard` still renders (`map-view/map-board.tsx` `.cm-toolbar`: map name, LIVE, Areas, Names, zoom,
Fit), which `hud/shell.css` floats at top 128 / left 690. Then the GM spotlight panel (`hud/spotlight`, moved under the
toolbar in fee75325). The new design removes all three: one scene pill, one bottom dock, one spotlight disc.

Plan: wave 10 in `.omc/plans/combat-hud.yaml`, briefs in `.omc/plans/combat-hud-briefs.md` ("Wave 10"). Questions at
the end of this file; tracers that wait on an answer say so.

## Unchanged boards

`CmpBlocked`, `CmpCards`, `CmpPicking`, `CmpPromptsPlayer` are byte-identical to the old export.

## Every board: app bar and spotlight (HANDOFF "App bar and spotlight")

### App bar (new) — Main, PlayerTablet, GMDesktop, GMTablet (not on PlayerPhone)

- `.appf` wraps the board; `header.abar` 56 px (desktop) / 52 px (tablet) above the HUD; the HUD root is 844 / 716 px
  tall. Background `#0b1214`, bottom border `#1f2b30`, z 200.
- Left: back link `a.ab-back` 36×36 ("Back to your campaigns"; the app's header says "Back to main menu"), wordmark
  "DAGGERHEART" (Cinzel 900 19 px; hidden on tablet), `nav.ab-nav` "Campaign sections":
  **Dashboard · Combat Map (current, gold fill, green live dot `.ab-live`) · Party | World · Characters & Locations ·
  Adversaries · Journal**. Items 36 px tall, 13.5 px (tablet 12.5 px).
- Right (`.ab-r`): `button.ab-lk` "Lorekeeper" gold pill (aria "Ask the Lorekeeper"; icon only on tablet); GM only:
  `button.ab-ic` gear (aria "Campaign settings") and `button.ab-ava` "GM" (aria "Your preferences", purple `#4b3a7a`);
  a player gets `ab-ava ab-pc pt-<PC>`, their character's portrait with a gold ring.
- What exists: the campaign shell (`campaign-shell.tsx`) draws a tall art header with back link, wordmark,
  `CampaignNav` (order from `src/lib/campaign-sections.ts`), and the GM's Players button / a player's "Player" tag,
  above every campaign page, the combat map included. The HUD is `100dvh` below it. The floating "Ask the Lorekeeper"
  pill (`lorekeeper/drawer`, fixed bottom-right, hidden on the combat map at ≤ 1180 px) is the only Lorekeeper entry
  besides the nav item. Config plan S1 (not built) adds a gear + avatar to that top bar; Journal plan JX1 (not built)
  changes the nav to Dashboard, Party, Codex, World Map, Combat Map, Adversaries, Journal, Lorekeeper.
- Conflicts: nav order and names (Q1), where the bar appears (Q2), gear and avatar before config S1 (Q3).

### Spotlight disc (new) — replaces the GM spotlight panel and the player-side spotlight tags

- `.spd` hangs from a cord left of the day disc (desktop right 300 / day disc at right 206; tablet right 208, smaller:
  cord 16, disc 54, beam 90×84). Parts: cord (gold `#8a6a2e`; purple `#5b4a8f` under `spot-gm`), light cone
  `.spd-beam` (120×110, warm `rgba(255,236,190,.45)` / lilac), disc 72 px with gold ring + glow (purple ring when an
  adversary holds it; stronger when `aria-expanded`), `.spd-shine`, label "SPOTLIGHT" + holder name (gold `#f3cf86`,
  lilac `#c9bdf2` for an adversary).
- Faces: the whole party = 2×2 mini portraits (`k-party`, `.sp-grp`); a PC = portrait; an adversary = initial on red
  `#4a1814` (`.sp-en`, Cinzel 26).
- Light pool `.pool` under the holder's token on the map: 190 px radial glow, `mix-blend-mode: screen`, warm for a PC,
  lilac (`.pool.gm`) for an adversary; "the whole party" lights every PC at 110 px, opacity .75.
- Motion (CmpTokensDesign): "the disc face cross-fades 200ms; the light pool fades out under the old holder and in under
  the new one, 300ms." New colour tokens "Spotlight light" `#ffecbe` 28–80 % and "GM spotlight light" `#c9bdf2` 30–80 %.
- GM: `button.spd` "Spotlight: {name}. Change who has it", `aria-expanded`; opens the popover `.spp` (role dialog
  "Spotlight", right 200 / top 150, 360 px; sheet open: right 540; tablet right 120 / top 120 / 330 px, sheet open
  right 360). Header "Spotlight" + Close. Tabs **Party** / **Adversaries** (`role=tablist`; the popover opens on the
  holder's tab). Party rows `.spr` (56 px, 40 px face): "The whole party — No one chosen · players decide who acts",
  then each PC "Druid · Hope 1 · HP 4/6"; pill "Give", or "Has it" on the holder. Adversaries tab: "How you take it"
  `.sp-how`: **Free** ("A player failed or rolled with Fear") / **1 Fear** with the flame ("Interrupt the players");
  rows "Lieutenant — Leader · HP 4/6" with "Take" / "Has it" (purple). Footer `.spp-n`: "Playing around one screen? Set
  it to whoever acts and the table sees the light move on the map." Choosing a row moves the spotlight and closes.
  Board script: Fear −1 only when moving from a PC / the party to an adversary with "1 Fear" selected; adversary to
  adversary and anything to a PC is free.
- Players: `div.spd.ro` `role="img"` "Spotlight: {name}", view only. Phone: `.mspot` 44 px disc under the party strip
  (right 10, top 100; "Spotlight · Moss" pill) and the holder's mini banner lit (`.mb.lit`: gold inset + light cone);
  the phone's off-screen edge chip moved down (top 150 → 226) to clear it.
- Sheet open: desktop the disc moves left with the Fear banner (`.sh-open .spd{right:640px}`; Main uses 584 px); tablet
  it hides.
- Removed with it: the banner's " · Spotlight" suffix (`.bn-c`) and the Fear banner's SPOTLIGHT pill (`.fb-spot`).
  Kept: the sheet's "Spotlight" tag, the player's "The GM has the spotlight" card, the feed line.
- What exists: `hud/spotlight/**` (H1.S): `SpotlightBannerTag`, `FearSpotlightTag`, the GM `SpotlightMenu` panel (top
  middle under the toolbar ≥ 1440 px, left column below, the queue sheet on a phone: commit fee75325 /
  `useSpotlightInColumn`), the player's GM's-turn card, and `SpotlightPools` (`spotlight/light.tsx`) lighting only a
  spotlit **adversary** token (dcm-bxp.99.32.35). Server `combatSpotlight`: `state` (holder `null` = the players,
  nobody chosen | gm | pc), `gmTake({ tokenId? })`, `handTo({ characterId })`. No way to hand it back to "the whole
  party" (holder null) and no Fear spend on take. `encounterTracking.spotlight` (stat block) separately charges 1 Fear
  for every adversary spotlight after the first in a GM turn.
- Gaps: server "to the whole party" and "take with 1 Fear" (Q7 for the Fear rule); PC pools; party face; phone disc.

### Day disc

- Sample text "Day 3 / Afternoon" → "Day 1 / Dawn" (sample only). HANDOFF: the Day / Dim / Night switch is gone from the
  GM view; "light is set from the day disc". No board draws the disc's GM popover. What exists: `hud/scene/disc.tsx`
  (GM button → time arc / End day; "Week n · Day n" for core campaigns) and `hud/scene/light.tsx` `LightSeg` in the GM
  toolbar where `scene.canSetLight`. Conflict: Q6.

## GMDesktop / GMTablet

- Root class gains `gmc`; states now Calm (default, was Requests), Requests, Adversary acting, Spend Fear, Areas, **Log**
  (new), End scene.
- **Top centre**: `.gtitle` ("Forest Camp / Live · GM view · Session 6") and `.gtools` (Day/Dim/Night, Areas, Fog,
  Dice, Player view, End scene) are gone. New scene pill `.scn` (left 690, top 16; tablet left 484, top 12): `h1`
  "Forest Camp" (Cinzel 900 26 px; tablet 20 px) + `span.sc-live` "Live" chip with a green dot (`#9ff0bd` text,
  `#5fd38a` dot, 11 px caps). No "GM view · Session n" line. Fades out while a sheet is open. (CSS also defines an unused
  `.sc-row` spotlight row: not built.)
- **Bottom dock** `div.dock` role toolbar "Map tools" (centred, bottom 16, z 70, padding 6, radius 18, bg
  `rgba(11,18,20,.96)`): group 1 **Select** (pressed by default), **Measure**, **Areas** (pressed while the Areas panel
  is open), **Fog**, **Names** (pressed = names shown) | zoom `.dk-z`: "Zoom out" −, `.dk-pct` "91%" (aria "Fit the map
  to the screen"), "Zoom in" + | **Dice**, **Player view**, **Log** (pressed while Resolutions is open) | `.dk-end`
  **End scene** (flag icon, red outline `#6b3f3a`, text `#f3a58f`). Buttons `.dk-b` 44 px tall, min-width 52, icon over
  a 10.5 px label; pressed = gold `#2d2614` with a gold ring; groups split by `#253338`. Sheet open: dock at left 640,
  icons only (min-width 40). Tablet: bottom 12, always icons only (42 px), sheet open left 342.
  Existing: `MapBoard`'s `.cm-toolbar` (Areas, Aa Names, zoom −/%/+, Fit) and the HUD's GM toolbar
  (`hud/scene/index.tsx`: LightSeg, Areas, Fog pop, Dice pop, PreviewPicker, HudEndScene, Map tools). No Select or
  Measure exist on the combat map (Q11). The dock's % button fits the map (today "Fit" is separate).
- **"Waiting on you"** `button.wchip` bottom-left (left 16, bottom 16, 56 px tall; tablet 52 px, label hidden): tray
  icon, "Waiting on you", count badge (`.wn` purple `#8f7bd1`, `.wn0` grey "0"), chevron up (rotates when open,
  `aria-pressed`). Opens the queue `.gq` above it (bottom 72; tablet bottom 74, 300 px). Queue content unchanged.
  Existing: `hud/queue` always open bottom-left (queue, Resolutions, and below 1440 px the spotlight panel). Q13.
- **Log** opens Resolutions `.gr` (with Undo) above the dock on the right (right 16, bottom 80, 360 px; tablet right 12,
  bottom 74, 330 px). Existing: `hud/queue/resolutions.tsx` always open under the queue; hidden at tablet (H7.1 default).
- **Areas** panel `.ar` bottom-right (`right 182, bottom 80` on the board, clear of the dock and the review box; tablet
  right 12, bottom 74). Existing: `hud/areas` (collapsible, user 2026-11-02; tablet under the Fear banner).
- **Banners**: no PC is "you" on the GM view: all ally size (238 px), no gold trim, no `tk-you` on tokens. Existing:
  `hbn-you` follows `combatHud.party` `mine`; check it is false for every PC when the caller is the GM (a GM who also
  owns a PC sheet would get the gold trim today).
- **Map** moved 40 px left on desktop / 10 px on tablet (the old board left room for a column); full-bleed already in
  the app.
- Gone from the GM view (HANDOFF): the title-row buttons, the zoom / Names panel, the floating spotlight panel, the
  always-open queue and Resolutions, the Day/Dim/Night switch, the floating Lorekeeper button (the app bar has it).
- Not on any board and still needed (Q4): the "Map tools" drawer (Maps, Play / Edit, Combatants, token card, Reveal,
  Vision, map style, sprite packs, session chip, "Players can see each other's cards") and, until dcm-bxp.99.32.43, the
  class controls (`SheetExtras`, Q5). The "GM view · Session n" line and `LiveSessionChip` live in the drawer.
- GMTablet board bug (not a design intent): its sheet markup still calls `sAdversary` / `sSpend`, which the new script
  removed.

## Main / PlayerTablet (player)

- App bar (player variant: no gear; avatar = own PC portrait).
- Read-only spotlight disc + pools (above). The banner " · Spotlight" suffix and the Fear banner SPOTLIGHT pill are gone.
- Title, Dice / Sheet, feed, hand, result, hit, death, blocked cards: unchanged. Desktop: the title row and `.tr` now fade
  out while a sheet is open (`.root:not(.tab).sh-open .title,.tr{opacity:0}`); today the HUD hides only the GM's.
- Map 40 px / 10 px left (as GM).

## PlayerPhone

- `.mspot` 44 px spotlight disc under the party strip (right 10, top 100), gold / purple; the holder's mini banner lit
  (`.mb.lit`). Phone 3 ("You're hit") shows the Bandit holding it (purple, initial). No disc on the full-screen sheet.
  Existing: `hud/phone/strip.tsx` has neither (H7.2 default "the board shows neither"; now it does).
- Edge chip "Bandit · can't see →" moved from top 150 to 226 (clears the disc).
- Copy: Evolution on the sheet reads "Needs 3 Hope. You have 1." (matches the user's "needs" wording, 2026-11-02).
- No app bar on the phone board: the phone keeps today's campaign chrome question open (Q2 covers it).

## CmpTokens

- Height 2030 → 3230; new **Spotlight** section after Light: "Hangs left of the day disc on every screen. The GM taps
  it to move the spotlight; players only see it." Seven specimens: whole party, a PC has it, an adversary has it (GM
  only can set it), player view (view only), phone (small disc, lit mini banner), map light PC, map light adversary
  ("Purple pool."); and the GM popover twice (Party tab "Tap a row to give it; the holder says “Has it”.", Adversaries
  tab "Free after a failure or a roll with Fear, or 1 Fear to interrupt.").

## CmpTokensDesign

- Two colour swatches (spotlight light, GM spotlight light) and the spotlight motion line; height 1280 → 1440.

## CmpPromptsGM

- Lede: "Everything that waits on the GM goes behind “Waiting on you” at the bottom left of the GM view; each item is one
  of these. Moving the spotlight is not a prompt: the GM does it from the spotlight disc." Prompt cards unchanged.

## HANDOFF.md

- Board table: GMDesktop states "Calm, Requests, Adversary acting, Spend Fear, Areas, Log, End scene. The spotlight disc,
  Fear − / + and the dock work"; GMTablet "icon-only dock, compact app bar"; CmpTokens lists the spotlight section.
- New sections "App bar and spotlight (every board)" and "GM view (GMDesktop, GMTablet)" (summarised above).
- Layout: "Spotlight disc: right 300 on desktop (left of the day disc at right 206); right 208 on tablet."
- Scene data: "spotlight holder (the party, one PC or one adversary)".

## What stays as built

Banners (except GM "you"), Fear banner (minus the SPOTLIGHT pill), tokens and rings, sheet panel and make-room, hand,
every picker, result, hit window, death move, stat block, queue items, blocked states, phone bottom sheets. The user's
earlier answers on those stand.

## Questions for the user

Asked as multiple choice; the first option is the recommendation. Tracers that wait on an answer name it in the plan.

**Q1 · Nav in the app bar.** The design's nav is "Dashboard · Combat Map · Party | World · Characters & Locations ·
Adversaries · Journal" (Adversaries shown to players, Lorekeeper as a pill on the right). You set the order on
2026-11-03: Dashboard, Party, Codex, World Map, Combat Map, Adversaries (GM only), Journal, Lorekeeper.
- (a) Keep your order, names and GM-only Adversaries; take only the design's look (36 px items, gold current page, live
  dot on Combat Map) and show Lorekeeper as the gold pill on the right. → Same nav on every page; nothing renamed.
- (b) Use the design's nav everywhere (Combat Map second, World, Characters & Locations, the separator). → Renames and
  reorders every page's nav; Journal plan JX1 and several nav specs change.
- (c) Your order on every page, the design's shorter nav on the Combat Map only. → Two navs to keep in step.

**Q2 · Where the 56 px app bar appears.** Today every campaign page has the tall art header with the nav; the Combat Map
sits under it.
- (a) On the Combat Map only (the art header stays on the other pages); the phone keeps today's header. → Smallest
  change; the HUD gets the full height under 56 px; two header styles in the app.
- (b) On every campaign page except the dashboard (which keeps its art hero). → One compact chrome everywhere; touches
  every page's layout and visual specs; collides with config S1 and Journal JX1, which also own `campaign-shell.tsx`.
- (c) On the Combat Map, plus a full-screen button that hides it during play. → Most map space; one more control.

**Q3 · Gear and avatar before the config plan lands.** Config S1 (not built) puts the gear (Campaign settings) and the
avatar (Preferences) in the campaign top bar.
- (a) The combat app bar reserves both places and renders config S1's buttons once S1 merges; until then the GM sees
  today's Players button there and players their portrait without a menu. → No throwaway UI; S1's acceptance gains "and
  the combat app bar".
- (b) Run config S1 first; wave 10's app bar tracer waits for it. → Wave 10's app bar starts later.
- (c) Wave 10 builds the gear and avatar as stubs; S1 fills them later. → Two plans own the same buttons.

**Q4 · The Map tools drawer.** The dock is "the only toolbar" and has no Map tools; the drawer holds Maps, Play / Edit,
Combatants, the token card, Reveal, Vision, map style, sprite packs, the session chip and the "Players can see each
other's cards" switch (which you want kept).
- (a) A "Map tools" button at the dock's left end (icon + label, icon only on tablet); the drawer and the switch stay as
  they are. → One extra dock button; about 30 specs that open "Map tools" keep working.
- (b) "Map tools" moves into the gear's menu; the cards switch moves to Campaign settings › Table. → The dock matches the
  design exactly; the drawer is two clicks away and waits for config S1.
- (c) A Map tools icon in the app bar, left of Lorekeeper. → Off the map entirely; far from the map it changes.

**Q5 · Class controls (Flying, Beastform Drop out, stances, counters; bead dcm-bxp.99.32.43).** They sit in the Map
tools drawer as a stopgap; you asked to move them into the HUD sheet.
- (a) Do it in wave 10 as its own tracer, in parallel with the rest. → The drawer holds only map tools when the dock lands.
- (b) Keep it a separate bead after wave 10. → Players keep opening "Your character" for them meanwhile.

**Q6 · Setting the light without the Day / Dim / Night switch.** The design drops the switch: "light is set from the day
disc". The GM's disc today opens the time arc (frames) or Week / Day with End day (core).
- (a) The GM's disc pop-over gains Day / Dim / Night above the calendar (only where the light can be set). → Nothing you
  asked for is lost; one click deeper.
- (b) Clicking the disc cycles Day → Dim → Night; the calendar and End day move to a small "Calendar" link under it. →
  Fastest light change; End day one click deeper.
- (c) The light follows the clock only; no manual light. → Simplest; removes the GM's override (frames without campaign
  time would have a fixed light).

**Q7 · Taking the spotlight for an adversary: Free or 1 Fear (core rule).** Core rulebook, GM chapter (PDF p.155): "When
you spend a Fear, you can: → Interrupt the players to make a move. → Make an additional GM move. …" and "you can spend
a Fear to interrupt the action and spotlight an adversary"; the reference page (PDF p.350): "Spotlight an additional
adversary during a battle." The engine already charges 1 Fear for every adversary spotlight after the first in a GM
turn (`encounterTracking.spotlight`).
- (a) "1 Fear" on the disc spends 1 Fear (the interrupt) and counts as that adversary's spotlight this GM turn, so its
  first action costs nothing more; "Free" spends nothing; giving it to a PC or the party is free. → Matches the board;
  no double charge.
- (b) As (a), but the interrupt Fear and the per-turn spotlight Fear are separate (an interrupted adversary's action can
  cost again). → Strict reading; the GM may pay twice.
- (c) No choice: the server decides — free when the spotlight came to the GM from a failure or a roll with Fear, 1 Fear
  otherwise. → Fewer clicks; the GM can't take it free on a judgement call.

**Q8 · "The whole party" holder.** The disc's Party tab can give the spotlight to "The whole party (players decide who
acts)", which is today's "nobody chosen" state; there is no move for it yet.
- (a) Add it: the GM hands the spotlight to the whole party; players' controls unlock as with a PC holder. → Small server
  change (one mutation).
- (b) Leave it out; the GM always hands it to one PC. → The board's first row is not built.

**Q9 · Measure and Select in the dock.** The combat map has no measuring tool; "Select" is today's default pointer.
- (a) Select = today's pointer; Measure = drag from a square to another to see the range band (Melee, Very Close, Close,
  Far, Very Far) with the app's range model, GM screen only, nothing saved. → New GM tool, small.
- (b) Same, and players get Measure too (their own screen only). → Players can check range before acting.
- (c) Leave Measure out for now; the dock has Select only in that group. → Dock differs from the design.

**Q10 · "Waiting on you" closed by default.** The queue now opens only from the bottom-left button with a count.
- (a) Stays closed; when a new request arrives the count pulses and the GM gets a short toast "Vex: out of range ·
  Waiting on you". → Map stays clear; the GM still notices.
- (b) Opens by itself when a request arrives, closes when it's empty. → Can't miss one; covers the map's lower left.
- (c) Stays closed, count only. → As drawn; easy to miss a request.

**Q11 · Player spotlight disc vs the old tags.** The design drops the banner's " · Spotlight" and the Fear banner's
SPOTLIGHT pill and lights the holder's token instead (and the mini banner on a phone).
- (a) Follow the design: drop both tags; the disc, the light pool and the "The GM has the spotlight" card show it. →
  Less noise; banner specs change.
- (b) Keep the banner tag as well. → Redundant on desktop; helps when the holder's token is off screen.

## User answers 2026-11-04 (binding)
- Q1 (a) The user's nav order and names (Dashboard, Party, Codex, World Map, Combat Map, Adversaries GM-only, Journal, Lorekeeper); the design's look (gold current page, live dot on Combat Map, Lorekeeper gold pill on the right).
- Q2 (c) The 56 px app bar on the Combat Map only, PLUS a full-screen button that hides the app bar during play (other pages keep the art header).
- Q3 (c) Build the gear and avatar now as placeholder buttons in the combat app bar; config S1 fills them later (S1's acceptance gains "and the combat app bar's gear / avatar").
- Q4 (a) A 'Map tools' button at the dock's left end opens today's drawer (icon only on tablet).
- Q5 (a) Class controls move into the HUD sheet in wave 10 (H9.5).
- Q6 (a) The GM's day-disc pop-over gains Day / Dim / Night above the calendar.
- Q7 (a) '1 Fear' pays the interrupt and counts as that adversary's spotlight this GM turn (no second charge); 'Free' costs nothing; giving it to a PC or the party is free.
- Q8 (a) Add 'The whole party' as a spotlight holder.
- Q9 (b) Measure for the GM AND players (each on their own screen, nothing saved); Select = today's pointer.
- Q10 (a) 'Waiting on you' stays closed; a new request pulses the count and shows a short toast.
- Q11 (b) Keep the banner's ' · Spotlight' tag as well (drop only the Fear banner's SPOTLIGHT pill).
