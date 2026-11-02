# TASK-HUD-H6.1: the refusal table, the shortfall helper, the three blocked layers and the toast host

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 7 batch A, tracer H6.1 (board CmpBlocked). Briefs:
`.omc/plans/combat-hud-briefs.md` "Wave 7", "Board elements → existing code → data" (Blocked layers row). Parent bead
dcm-bxp.99.32; reads the planned structured shortfall of dcm-bxp.99.32.2 (not built). Mode: add. Nothing here is wired
into an existing surface yet: H6.2 (player surfaces) and H6.3 (GM surfaces) apply it. The only visible change today is
the toast host in the hand region (empty until something pushes a toast).

## What landed

| File | What |
|---|---|
| `src/lib/errors/refusals.ts` | The refusal table `REFUSALS` (every combat code → CmpBlocked title, message lead + rest, hint, before-the-click forms, place, follow-up, tone), `CLIENT_REFUSALS` (board rows with no server code), `FALLBACK`, and the resolvers `refusalFor(error, ctx)`, `refusalForCode(code, ctx)`, `beforeText(code, ctx)`, `refusalData`, `isMappedRefusal`. |
| `src/lib/domain/combat-actions/shortfall.ts` | Pure: `Shortfall { resource, need, have, payer? }`, `readShortfall(data)` (bead dcm-bxp.99.32.2's planned shape, single or list), `shortResourcesFromText` (today's "Short of: hope, stress."), `shortfallOf(costs, room)` (client pre-compute), `visibleShortfall` (no enemy numbers for players), words: `shortfallLabel` ("Needs 3 Hope · you have 1"), `shortfallTag` ("Needs 1 Hope"), `shortfallSentence` ("Wall Walk costs 1 Hope." / "You have 0."), `shortfallHint`, `shortfallTitle`, `amountText`, `resourceName`. |
| `src/components/combat-map/hud/blocked/reason.tsx` | Layer 1: `blockedReason(input)`, `useBlocked(reason)`, `<BlockedReason>` (`.hud-why`), `<BlockedTag>` (`.hud-hs .hud-hs-no` + lock). |
| `src/components/combat-map/hud/blocked/use-refusal.tsx` | Layer 2: `useRefusal(options)` → `{ refusal, messageId, run, fail, clear }`; `<RefusalMessage>` (`.hud-inl`, `role="alert"`). |
| `src/components/combat-map/hud/blocked/blocked.css`, `index.ts` | The board's `.why`, `.inl`, lock tag and `.dis` look (`.hud-root [aria-disabled="true"].hud-btn`); the barrel. |
| `src/components/combat-map/hud/toasts/store.ts` | Layer 3 store: `hudToasts.push / refusal / dismiss / reset / subscribe / get`, `useHudToasts()`; `TOAST_TTL` 6 s (8 s with a hint), `TOAST_MAX` 3. |
| `src/components/combat-map/hud/toasts/index.tsx`, `toasts.css` | `HudToasts` (the H0 stub filled; same export and props): an always-mounted `role="status"` region "Notices" in the hand region, stacked above the cards (`order: -1`), newest nearest the hand, ✕ per toast, auto-dismiss paused on hover / focus, entry motion off under `prefers-reduced-motion`. |
| `tests/unit/hud/refusals.test.ts` | 29 tests: the inventory (fails on an unmapped combat code; keys only real codes), every board row, FALLBACK, the shortfall helper, enemy redaction. |
| `tests/unit/hud/toasts.test.tsx` | 16 tests: the three layers and the toast host. |

## The API for H6.2 / H6.3

Import from `@/components/combat-map/hud/blocked` (layers) and `@/lib/errors/refusals` (words). Never write a refusal
sentence in a surface; never key on the server's text.

### Layer 1: before the click

```ts
blockedReason({
  spotlightWithGm?: boolean,   // combatSpotlight.state.reactionsOnly (H1.S)
  reaction?: boolean,          // reactions stay enabled while the GM holds the spotlight
  used?: "card" | "feature" | null, // the use's ready === false
  costs?: readonly Cost[], room?: PayerRoom, // pre-compute; or pass shortfall
  shortfall?: Shortfall[],
  kind?: "card" | "feature" | "fear",
  subject?, target?, viewer?,  // RefusalContext
}): Blocked | null
// Blocked = { code, text: "Needs 3 Hope · you have 1", tag: "Needs 3 Hope", refusal: Refusal }
```

Order: spotlight (non-reactions) → used up → cost. `room` lists only the resources the surface locks on
(`{ hope }`, `{ fear }` for the GM, `{ stress: max - marked }` …); a resource left out is not checked (see Q1).

```tsx
const why = blockedReason({ kind: "feature", subject: f.name, used: f.ready ? null : "feature", costs: use.costs,
  room: { hope: sheet.hope }, spotlightWithGm: spot.reactionsOnly, reaction: use.activation === "reaction" });
const b = useBlocked(why);              // { blocked, text, reasonId, control }
<button className="hud-btn" {...b.control} onClick={() => { if (!b.blocked) send(); }}>Use</button>
<BlockedReason id={b.reasonId}>{b.text}</BlockedReason>      // or a tip; or <BlockedTag>{why.tag}</BlockedTag> on a card
```

`control` is `aria-disabled` + `aria-describedby` (the control stays focusable so the reason is read and a tip can
show; guard the click with `b.blocked`). `REFUSALS[code].before` names the board's form for each code (`card-tag`,
`use-disabled`, `feature-disabled`, `option-hidden`, `used-tag`, `sheet-badge`, `picker-counter`, `ring-dimmed`,
`ring-dotted`, `ring-hint`, `fear-disabled`, `attack-disabled`, `control-disabled`, `toast`, `none`). For the existing
lock texts: `featureLock` (ring) = `shortfallSentence(s, { subject, verb: "needs" })`; `hopeShortfall` (pick-feature),
`pick-card/model.ts`, `pick-attack/model.ts` and hand `states.ts` = `shortfallLabel` / `shortfallTag` of
`shortfallOf(costs, { hope })`. H6.2 swaps them in (their files are H6.2's owns).

### Layer 2: at the click

```tsx
const r = useRefusal({ subject: card.name, onThen: (then) => then === "snap-back" && snapBack() });
<button aria-describedby={r.refusal ? r.messageId : undefined}
  onClick={() => void r.run(() => useCard(args), { target: "the Lieutenant" })}>Cast on Lieutenant</button>
<RefusalMessage refusal={r.refusal} id={r.messageId} />
```

`run(send, ctx?)` clears the last refusal, awaits `send`, returns its result, or on a throw resolves it with
`refusalFor` and returns `undefined`. A refusal whose `place` is `toast` (REQUEST_NOT_OPEN, FEATURE_NEEDS_MAP,
NOT_A_RESPONDER, the "gone" codes, FALLBACK) goes to the toast host instead; force one place with `place: "inline" |
"toast"`. `then` ("refresh", "snap-back", "dice-box") reaches `onThen`. `fail(error, ctx?)` does the same for a
`.catch` elsewhere. A pick session (H3.0 `send` throws → `errorMessage`) switches to `refusalFor(error, ctx).text` (or
renders `RefusalMessage`) in H6.2.

### Layer 3: later or elsewhere

```ts
hudToasts.refusal(refusalFor(error, { subject }));              // a refusal that arrived later
hudToasts.push({ title: "Already answered", message: "Someone already answered this.", tone: "neutral" });
```

Repeats (same key: code + text, or title + message) replace instead of stacking. The host is mounted once by the
shell (hand region); tests call `hudToasts.reset()`.

### Resolving a refusal

`refusalFor(error, ctx)` → `Refusal { code, title, lead, rest, hint, text, before, place, then, tone, shortfall }`.
Order: the table's entry; a cost code reads the server's structured shortfall, else `ctx.shortfall`, else the resources
of its "Short of: …" text (or the code's: NOT_ENOUGH_HOPE → Hope, NOT_ENOUGH_FEAR / FEAR_EMPTY → Fear); a non-cost
entry uses the caller's names (`subject`, `target`, `max`, `adversary`) over the server's sentence, and the server's
sentence over the generic one (a server text equal to its domain default, or "Short of: …", adds nothing). An app code
outside the table keeps its own message under the control; an unknown code or any non-refusal error is FALLBACK.

## The code map (CmpBlocked → server)

| Board row | Real code(s) | Message (with names) | Hint | Before the click | Place / then |
|---|---|---|---|---|---|
| CARD_COST_UNPAID (Hope) | CARD_COST_UNPAID, FEATURE_COST_UNPAID, NOT_ENOUGH_HOPE | **Wall Walk costs 1 Hope.** You have 0. | Roll with Hope, or rest, to gain Hope. | card tag, Use disabled (feature: feature disabled) | inline |
| CARD_COST_UNPAID (Stress) | same, resource stress | **Beastform needs a Stress.** Your Stress is full. | Clear Stress on a rest or with an ally’s help. | feature disabled | inline |
| — No Armor Slot | **none** (client-only `NO_ARMOR_SLOT`; a cost refusal with armor reads the same) | **No Armor Slot left to mark.** | Repair armor on a rest. | hit window: option hidden | inline |
| CARD_EXHAUSTED | CARD_EXHAUSTED | **Rune Ward is used** until your next rest. | — | "Used · back after a rest" | inline |
| FEATURE_USED* | FEATURE_EXHAUSTED | **That feature is used up for now.** | It comes back on a rest. | sheet badge | inline |
| CONDITION_NOT_MET* | INVALID, FEATURE_STATE_MISSING (server sentence wins) | **You need to be inside the area first.** | (FEATURE_STATE_MISSING: Set it up, then try again.) | card tag | inline |
| TOO_MANY_TARGETS* | COMBAT_TARGET_INVALID (`ctx.max`) | **Pick up to 2 targets.** | — | picker counter | inline |
| BAD_TARGET* | COMBAT_TARGET_INVALID (`ctx.target`) | **The Bandit can’t be attacked right now.** | — | ring dimmed | inline |
| COMBAT_NO_LINE_OF_SIGHT | COMBAT_NO_LINE_OF_SIGHT | **You can’t see the Bandit** from where you stand. | Move or remove what blocks the view. | dotted ring | inline |
| OUT_OF_REACH* | COMBAT_OUT_OF_REACH | **Move next to the Bandit first.** | — | ring + hint | inline |
| NOT_IN_COMBAT* | CARD_NOT_COMBAT, FEATURE_NOT_COMBAT | **Wall Walk can’t be used in combat.** | — | card tag / feature disabled | inline |
| NO_MAP* | FEATURE_NEEDS_MAP | **That needs a live map** with its targets on it. | Ask the GM to set a map live. | toast | toast |
| NOT_ENOUGH_FEAR | NOT_ENOUGH_FEAR, FEAR_EMPTY | **This needs 2 Fear.** You have 1. | — | Fear cost disabled | inline |
| SPOTLIGHT_FIRST* | ADVERSARY_NOT_SPOTLIT | **Spotlight the Lieutenant first.** | Spotlighting costs 1 Fear. | attack disabled | inline |
| STALE_REQUEST* | REQUEST_NOT_OPEN | **Someone already answered this.** | — | toast | toast (neutral), then refresh |
| MOVE_BLOCKED* | MOVE_BLOCKED (real code, combatMap.ts) | **Something blocks the way.** | — | — | inline, then snap-back |
| DIFFICULT_TERRAIN* | **none** (client-only `DIFFICULT_TERRAIN`) | **Difficult terrain:** a movement roll is needed. | — | — | then dice-box |
| (new) SPOTLIGHT_WITH_GM | SPOTLIGHT_WITH_GM (H1.S, spotlight.ts) | **The GM has the spotlight.** You can use reactions until it comes back. | — | every non-reaction control disabled | inline |
| FALLBACK | unknown code / non-refusal error | **Something went wrong.** Check your connection and try again. | — | toast | toast |

The other combat codes (no board row) keep their domain's words with a short title: CARD_NOT_IN_LOADOUT (card tag,
hint "Swap it in from your vault first."), COMBAT_NOT_YOUR_CHARACTER, FEATURE_NOT_OWNED, ADVERSARY_FEATURE_UNAVAILABLE
(attack disabled), NOT_A_RESPONDER (toast, refresh), the combatMap codes (COMBAT_*_NOT_FOUND: toast, refresh;
COMBAT_NOT_YOUR_TOKEN: snap-back; limits / layout / light / corrupt inline or toast), NOT_FOUND, RATE_LIMITED,
CHARACTER_UNAVAILABLE, ENCOUNTER_NOT_RUNNING.

**Board rows without a real server code:** "— No Armor Slot" (the board itself shows "—") and DIFFICULT_TERRAIN* (no
movement roll exists on the map; see Q2). Both are `CLIENT_REFUSALS` only; the test asserts no client-only key is a
server code and every `REFUSALS` key is a real one. MOVE_BLOCKED* is marked suggested on the board but already exists.

The inventory test (`refusals.test.ts`) loads every module of `src/lib/errors/` and fails when a code of `combat*.ts`,
`adversaryActions.ts` or `spotlight.ts`, or any code named `COMBAT_* / CARD_* / FEATURE_* / SPOTLIGHT_* / MOVE_*`,
has no `REFUSALS` entry. `REFUSALS` is also typed `Record<RefusalCode, Entry>`, so a new code in those modules fails
typecheck first.

## Board states matched

CmpBlocked "Three layers": layer 1 `.why` ("Needs 3 Hope · you have 1") and the `hs-no` tag ("Needs 1 Hope") as
`BlockedReason` / `BlockedTag`; layer 2 `.inl` ("**You can’t see the Lieutenant** from where you stand.") as
`RefusalMessage`; layer 3 `.toast` / `.toast.neutral` ("Not enough Hope" + message + hint; "Already answered") in
`HudToasts`. Same colours, radii and type as the board's CSS. "Every refusal": every row as in the table above. No
visual spec: nothing is wired into a surface yet (H6.2 / H6.3 shoot the states on their surfaces).

## Tests

- `tests/unit/hud/refusals.test.ts` (29) and `tests/unit/hud/toasts.test.tsx` (16): pass.
- Full vitest, lint (0 problems in owns), typecheck, and every `tests/e2e/hud-*.spec.ts`: see the commit's report.

## Out-of-owns edits

None.

## Merge-time actions (orchestrator)

1. None required. `HudToasts` keeps its export and props, so `shell.tsx` is unchanged.
2. When dcm-bxp.99.32.2 lands (AppError `shortfall`), `readShortfall` picks it up with no change here; if its shape
   differs from `{ resource, need, have }` (single or list; resources hope / stress / hp / armor / tokens / fear /
   gold / favor / focus; optional `payer`), adjust `readShortfall` only. The server should set `payer: "adversary"`
   on an adversary's own cost if a player could ever receive it (the client drops the numbers then anyway).
3. H6.2 / H6.3: replace `errorMessage(e)` in HUD view files with `useRefusal` / `refusalFor`, and the ad-hoc lock
   strings (ring `featureLock`, `hopeShortfall`, pick-card / pick-attack, hand `states.ts`) with `blockedReason` /
   the shortfall words. `pick/types.ts` documents `errorMessage` for the pick panel's refusal: switch it to
   `refusalFor(error, ctx).text` there.

## Beads

None filed. dcm-bxp.99.32.2 (structured shortfall, lane:w3-vocabulary) already covers the server side.

## QUESTIONS (safest reversible defaults taken)

1. **Stress costs with full Stress.** The character sheet guide says: "If you ever need to mark Stress and can’t, mark a
   Hit Point." (core.txt, PDF page 345, the character sheet walkthrough). The engine's `unaffordable`
   (card-effects/availability.ts) refuses a Stress cost with no free slot (CARD_COST_UNPAID "Short of: stress."), and
   the board shows "Beastform needs a Stress. Your Stress is full."; H3.4's ring deliberately does not lock on Stress.
   Is a voluntary Stress cost payable by marking a Hit Point instead? Default: the helper locks on a resource only when
   the surface passes its room (`room.stress`), so each surface keeps today's behaviour; the server decides.
2. **Difficult terrain.** CB p.104 "Moving far or moving as your primary action": "If you’re not already making an
   action roll, or if you want to move farther than your Close range, you’ll need to succeed on an Agility Roll to
   safely reposition yourself. The GM sets this Difficulty depending on the situation." The map has no movement roll
   or difficult-terrain rule today and no server code. Should a token move into a difficult-terrain area (or past Close)
   open the dice box for an Agility Roll, and is it core or frame-exclusive? Default: client-only `DIFFICULT_TERRAIN`
   entry (then: dice-box), raised by nothing yet.
3. **"costs" vs "needs".** CmpBlocked and Main's toast say "Wall Walk costs 1 Hope. You have 0."; Main's ring says
   "Evolution needs 3 Hope. You have 1.". Default: the refusal says "costs", the ring keeps "needs"
   (`shortfallSentence(..., { verb: "needs" })`). Say if one wording should win everywhere.
4. **SPOTLIGHT_WITH_GM wording.** The server's default text is "Only reactions until it comes back to you."; the table
   uses the brief's "You can use reactions until it comes back." (the HUD never shows the server's default text for this
   code). The short before-the-click form is "The GM has the spotlight · reactions only".
