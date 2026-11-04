# Combat HUD — handoff for Claude Code

This canvas is the approved design for the Daggerheart Campaign Manager's combat UI. It replaces the left-column layout of the current Combat Map with:

- **F · Banners**: the party hangs as banners across the top-left; the GM's Fear hangs as a purple banner top-right.
- **E · At the token**: tokens carry HP and Stress rings and a Hope chip; an action ring opens around your own token.
- **D · Sheet at hand**: clicking any banner or character token opens that character's sheet as a full-height panel on the right. The map makes room for it instead of being covered.

Build it into the existing combat map (`Combat.dc.html` in the campaign manager and the backend combat engine). The rules engine already exists; this is the presentation layer around it.

## Boards

| Board | Size | What it shows |
|---|---|---|
| `Main.dc.html` | 1440×900 | **Player, desktop.** Interactive. Preview states: Picking a target, Card result, You're hit, Last Hit Point, Can't afford, GM's turn. Banners and tokens open sheets. |
| `PlayerTablet.dc.html` | 1024×768 | Same, tablet. Feed is hidden; banners are compact. |
| `PlayerPhone.dc.html` | 1800×940 | Four 390×844 phone frames: picking (picker as a bottom sheet), Hand tab, incoming hit, full-screen sheet. |
| `GMDesktop.dc.html` | 1440×900 | **GM, desktop.** Interactive. States: Calm, Requests, Adversary acting, Spend Fear, Areas, Log, End scene. The spotlight disc, Fear − / + and the dock work. Enemy tokens open stat blocks. |
| `GMTablet.dc.html` | 1024×768 | Same, tablet: icon-only dock, compact app bar. |
| `CmpCards.dc.html` | 1440 wide | Hand states: ready, playing, can't afford, used, locked (GM), another player's card, hidden hand, reaction; vault and recall; roll options; full card view. |
| `CmpTokens.dc.html` | | Banners (you, ally, condition, last HP), Fear banner (player / GM), token anatomy, token kinds, target rings, icons, lasting effects, light, **spotlight** (disc states, player/phone versions, map light, GM popover tabs). |
| `CmpPicking.dc.html` | | The one picking pattern: one target, weapon attack, area (square), wall (two points), chain links, damage split and per-ally picks. |
| `CmpPromptsPlayer.dc.html` | | Every player prompt (after-roll hold, riders, minions, waiting for GM, forced attack, Lead by Example, ally prompt, pay something else, Reliable Backup, two-tap). |
| `CmpPromptsGM.dc.html` | | Every GM prompt (Fear spend, feature choices, out of range, Difficulty, reactions, Momentum offer, Cloaked, fire, countdown, Hope split, end scene). |
| `CmpBlocked.dc.html` | | The blocked/cost system: three layers and the full refusal table. |
| `CmpTokensDesign.dc.html` | | Colours, type, radii, motion. |

The **Preview** box on interactive boards is a review aid only. Do not ship it.

## App bar and spotlight (every board)

- **App bar** (56 px desktop, 52 px tablet) above the map: back, wordmark (hidden on tablet), nav (Dashboard · Combat Map · Party | World · Characters & Locations · Adversaries · Journal), then Lorekeeper (icon only on tablet) and, for the GM, the settings gear and avatar; a player sees their character's portrait as the avatar. The HUD fills the rest (844 px / 716 px tall).
- **Spotlight disc** (`.spd`): hangs from a cord left of the day disc, the same family of object. It shows whoever has the spotlight, lit from above:
  - the whole party (no one chosen, players decide): four mini portraits, gold light;
  - one PC: that portrait, gold light;
  - an adversary: its initial on red, purple light (`spot-gm`).
  - The same light falls as a pool (`.pool`) under that creature's token on the map, so a table watching one TV sees who acts.
- **GM**: the disc is a button. It opens a popover with two tabs, **Party** (the whole party + each PC with Hope and HP) and **Adversaries** (every adversary in the scene with kind and HP). The holder is marked "Has it"; tapping another row moves the spotlight there and closes it. The Adversaries tab asks how you take it: **Free** (a player failed or rolled with Fear) or **1 Fear** (interrupt); taking it from the party with 1 Fear selected spends the Fear. The GM can always hand it to a specific PC, which is how a GM running the only screen hands turns around at a real table.
- **Players**: the same disc, view only (`.spd.ro`). On phone it is a 44 px disc under the party strip, and the holder's mini banner is lit.
- Root classes: `spot-<party|PC name|E0…>` plus `spot-gm` for an adversary; `sp-open` and `stab-party|adv` for the GM popover.
- With a sheet open the disc moves left with the Fear banner (desktop); on tablet it hides while a sheet is open.

## GM view (`GMDesktop`, `GMTablet`)

- **Top centre**: scene title + Live chip only.
- **Bottom dock** (the only toolbar): Select, Measure, Areas, Fog, Names | zoom − % + (the % fits the map) | Dice, Player view, Log | End scene. Icons only on tablet and while a sheet is open.
- **Bottom left**: "Waiting on you" with a count; it opens the request queue above it. Nothing else lives in that corner.
- **Log** opens Resolutions (with Undo) above the dock on the right. **Areas** opens its panel bottom-right.
- Gone from the old GM layout: the title-row buttons, the zoom/Names panel, the floating spotlight panel, the always-open queue and Resolutions, the Day/Dim/Night switch (light is set from the day disc), the floating Lorekeeper button.
- No PC is "you" on the GM view: all banners are the ally size, no gold trim.

## Hard rules

1. **The hand's card face is the app's own and must not change.** Markup and CSS are copied verbatim from `Party.dc.html`: `.hand-card`, `.hc-face`, `.hcf-head`, `.hcf-name`, `.hcf-lvl`, `.hcf-art` with `.dkc-art.dca-<card-id>`, `.hcf-rc`, `.hcf-meta`, `.hcf-text`, `.hcf-acts`, `.hcf-btn`, `.vault-deck`, `.vd-card`. States live *around* the card only:
   - a tag above it (`.hs .hs-play | .hs-no | .hs-used | .hs-limit | .hs-cost`)
   - a lift and glow while playing
   - grey wash for used / can't afford / locked.
2. **Players never see adversary numbers** (HP, Stress, Difficulty, thresholds). Player-view enemy tokens have no rings; results say Hit / Miss / Defeated.
3. **Out of range is not an error.** It routes to the GM (`GM approves` tag, amber dashed ring) and nothing is rolled or paid until the GM allows it.
4. Clickable banners and tokens are real `<button>`s with `aria-label`s.

## Layout (desktop 1440×900)

- **Map**: full-bleed, 48 px per square here; the map image sits in `.mapz > .stage`.
- **Banners**:
  - `button.bn` at x = 24, 182, 340, 498, hanging from a gold rod; the open character's banner drops 8 px.
  - Your banner is 270 px tall with a gold trim; allies are 238 px.
  - Content: portrait, name, class, HP / Stress / Armor pips, conditions; the Hope seal sits at the tip.
- **Title, Dice and Sheet buttons**: x = 690.
- **Day/time disc**: hangs left of the Fear banner.
- **Fear banner**: right 24, 12 diamond pips. On the GM view only it has − / +.
- **Hand**: bottom, centred around x = 1050, with the vault, Roll options and Hide cards beside the fan.
- **Feed** ("Just now"): bottom-left on the player view. On the GM view see "GM view" above.
- **Spotlight disc**: right 300 on desktop (left of the day disc at right 206); right 208 on tablet.
- **Sheet panel**: full height, right 0, 400 px wide. While it is open:
  - the map transitions `translateX(-125px) scale(.94)` over 350 ms;
  - the Fear banner moves to right 424, the hand to left 330, and pop-ups shift left;
  - the day/time disc hides.
  - Clicking another banner or token swaps the sheet; clicking the same one, or ✕, closes it.
- **Tablet (1024)**:
  - Banners are 108 px wide and the map is 39 px per square.
  - The sheet panel is 340 px; when it opens, the map shifts −60 px and scales to 0.92, and the title hides.
- **Phone (390)**:
  - A mini banner strip (with Fear) runs across the top.
  - Pickers and the hit window are bottom sheets with 44–48 px buttons.
  - The bottom-sheet tabs are Hand / Attack / Dice / Feed.
  - The sheet is full screen.
  - Off-screen targets show as edge chips ("Sniper · Very Far · GM →").

## Tokens

- **Ring**: `svg.tk-arc`. The left half is HP left (red `#e0503f`); the right half is Stress marked (blue `#7a9cc4`). Both are drawn with `pathLength=100` and `stroke-dasharray`.
- **Hope**: gold chip, top right (`.tk-hope`).
- **Conditions**: icon badge(s), bottom right (`.tk-cd`).
- **Side colour**:
  - You: gold ring plus glow.
  - Ally PC: teal `#9fd8c4`.
  - Ally NPC: mint `#9fd8b0`.
  - Neutral: grey.
  - Adversary: red `#c0392b`.
- **GM view**: adversaries also get HP/Stress rings.
- **Target ring states** (`.tg-<state>` on the token):

| State | Ring | Badge |
|---|---|---|
| `picked` | solid gold, glow | check |
| `in` | dashed gold | — |
| `out` | dashed amber | "GM" |
| `los` | dotted salmon, face dimmed | eye-off |

  - Each ring has a band label above it (`.tg-l`).
  - Secondary picks, like the Restrain rider, use a dashed label below (`.tg-rl`).
- **GM attack picking** uses the same pattern in purple: `.g-ring.g-pick | g-out | g-hid`.

## The picking pattern

Everything that picks (cards, weapon attacks, features, reactions, GM adversary attacks) uses one panel anchored beside the primary target (`.pk-anchor > .pk`, 42 px right of the token, vertically centred):

1. **Header**: card art thumbnail, name, and the rule ("Pick 1 target within Far").
2. **Target list**: one row per creature in the scene, kept in sync with the map rings; tapping either selects. States are picked / in / out / los.
3. **Riders and options**: toggles with a cost pill. Riders that only apply on a hit say so ("If it hits, also Restrain the Bandit").
4. **Footer**: what you'll pay ("Spends your last Hope") and **one** primary button that names the action ("Cast on Lieutenant", "Attack Brannoc").

Other picking modes (see `CmpPicking`):
- **Area**: a crosshair with a radius preview and a banner ("Pick the centre of Dark Cloud within Close · Esc cancels").
- **Wall**: two draggable points.
- **Chain**: numbered links.
- **After the roll**: damage-split steppers, and per-ally chips that each player answers on their own screen.

On phone, the panel becomes a bottom sheet.

## Interactive boards: state model

- The root element gets classes:
  - `st-<state>` for the preview state;
  - `sh-open sh-<Name>` when a sheet is open, where `<Name>` is a PC name or, on the GM view, `E0…E3`.
- Elements that show in only some states use `.only.on-<state>` or `.s-<state>`.
- In the real app these classes come from engine state. For example:
  - `pick`: a card is being played and needs targets;
  - `hit`: an incoming-hit window is pending for this player;
  - `gm`: the spotlight is on the GM.

## Copy and blocked states

`CmpBlocked` is the spec. The rules:

- **Before the click**: a disabled control plus the reason beside it ("Needs 3 Hope · you have 1"). Use the refusal's shortfall data to pre-compute it wherever the cost is known client-side (Hope, Stress, Armor Slots, card limits, Fear).
- **At the click**: the server's refusal renders under the pressed control.
- **Later or elsewhere**: a toast near the hand.
- **Codes**:
  - From the existing server: `CARD_COST_UNPAID`, `CARD_EXHAUSTED`, `COMBAT_NO_LINE_OF_SIGHT`, `NOT_ENOUGH_FEAR`, `FALLBACK`.
  - Codes marked `*` in the table are suggested names: map them to the server's real codes.

## Data each element needs

- **Party**: name, class, level, portrait, HP marked/max, Stress marked/max, Hope (max 6), Armor Slots, Evasion, thresholds, Experiences, features with cost/limit/state, conditions and lasting effects with source and duration.
- **Adversary** (GM): the stat block from the app's adversary data (Difficulty, thresholds, HP, Stress, attack, weapon, range, damage, Experience, motives, features with kind and Fear cost) plus live HP/Stress marks and conditions.
- **Scene**: GM Fear (0–12), spotlight holder (the party, one PC or one adversary), day number and phase (Day / Dim / Night), live map, areas.

## Assets

The boards load images from this canvas's asset store (`/_blob/<id>`):

| Asset | Blob id |
|---|---|
| Map | `bcdb625117b5015285f17a6ee6bae438` |
| Moss portrait | `d9e1ee70a58da42b83e8d870715c4ea0` |
| Brannoc portrait | `3ea2843178212974e44b09a8c093a08e` |
| Vex portrait | `46f53c9b11ff3452d676407535bdebe3` |
| Oriel portrait | `81c35a76c926bea3eb135e467b68fe33` |
| Card art: Vicious Entangle | `ace8ecbe504e167165da9c1ffa6a8cd3` |
| Card art: Unleash Chaos | `7653bee39f720dabb4174e4f8573695c` |
| Card art: Wall Walk | `1df538416afbabf1e215e1647129ceb3` |
| Card art: Rune Ward | `7a61023e2faa385936de06c16eb15faf` |
| Card back: Sage | `4b92d6260a15a20e8a6776c46a46ca1e` |
| Card back: Arcana | `1a83347eef01f93965105d0a7984834d` |
| Default card back | `3ce28d2a9171100887c205f3f6019b5e` |

In the app, use the existing portrait (`PORTRAITS`), card-art (`.dca-*`) and card-back (`.cb-*`) assets instead. The export zip includes copies under `assets/`.

## Sample content to replace

- **Party and Experiences**: the four PCs, their positions, every number on the tokens and banners, and the Experiences are samples. Moss's thresholds 9/16 assume Leather Armor (6/13) plus level 3; the allies' thresholds are samples.
- **Scene events**: the request-queue entries, the feed rows, and the "Mira / Ash" names in the GM prompts are examples.
- **Taken from the app's own data** (they don't need replacing):
  - card text, adversary stat blocks and feature text;
  - the class features shown on the sheets;
  - the death-move wording, which follows the core rules.

## Suggested build order

1. Banners, Fear banner and token rings (read-only), placed from engine state.
2. The sheet panel (own / view-only / GM edit), map make-room transition, switching.
3. The picking panel replacing the old target list, aim panel and Use dialog; riders; GM approval routing.
4. Result panel, hit window, death move.
5. GM request queue, adversary stat panel and attack picker, Fear spend confirm.
6. Blocked-state system wired to refusal codes.
7. Tablet and phone layouts.
