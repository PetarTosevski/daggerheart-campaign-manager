# TASK-HUD-H3.0: the picking panel, target rings, GM approval routing, "Waiting for the GM" with Withdraw

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 4 batch A, tracer H3.0 (boards CmpPicking, Main, CmpTokens,
CmpPromptsPlayer). Depends on HD3 (`combatWithdraw.withdraw`). Parent bead dcm-bxp.99.32 (no own bead). Mode: add;
everything renders only inside the HUD shell (switch on, Play).

## What landed

All in `src/components/combat-map/hud/pick/`:

| File | What |
|---|---|
| `types.ts` | The pick-session API types (below). |
| `session.tsx` | `PickProvider` (the one session: spec + picks + options + sending/message) and `usePick()`. Keeps H0's `useHud().pick` slot in step (`{ id, anchorTokenId }` → root class `hud-pk-open`); a session is live only while the slot names it. |
| `model.ts` | Pure: `buildRows` (reuses the Hand model's `fitsSide` / `outOfRange` and the server's `combatActions.targets` hints; band from the engine's `rangeCheck`), `togglePick`, `keepPicks`, `selectionOf`, `primaryProblem`, `ruleText`, labels, `waitingUses` / `waitingReason`. |
| `scene.ts` | `usePickScene`: the creatures (player: `combatVision.playerView`; GM: `combatTokens.list` with `spec.actor` as self) and rows, shared by panel and rings (one subscription each). |
| `panel.tsx` | The panel (`.pk`): anchored 42 px right of the primary target (first pick, else the actor's token), vertically centred, flipped left at the screen's right edge, clamped on screen, measured per frame (the map pans / zooms / makes room under it); a bottom sheet at ≤ 760 px. Header (card art via `next/image` for a card, name, rule, ✕), target rows, picker `extra` rows, rider / option switches (H0 `Toggle` + `CostPill`), footer cost line + ONE primary; refusal / `stay` message under it (`role="alert"`). |
| `layer.tsx` | The ring layer (`HudPickLayer`): `.hud-tg-picked / -in / -out / -los`, ally (or self) picked mint, band label above (`.hud-tg-l`), "GM" / check / eye-off badge, rider label below (`.hud-tg-rl`), dimmed face for out-of-sight, dashed aim line actor → primary. Tap targets over the listed tokens (tabIndex −1, `preventDefault` on pointer down so the map does not pan; rows are the keyboard path). The classic CA5 rings hide while a session is open. |
| `waiting.tsx` | "Waiting for the GM" (`.pc.wait`): one card per own use waiting on approval, from `combatRequests.mine` (attack sanctions), `combatCards.pending`, `combatFeatures.pending`; "<Target> is <Band>. Nothing is rolled or paid until the GM decides.", "Asking the GM…", **Withdraw** → `combatWithdraw.withdraw` with an optimistic update dropping the request from all three reads (`dropWithdrawn`). Players only (the GM has the queue). |
| `attack.tsx` | `plainAttackSession` (the reference picker: one enemy in the weapon's range, `combatActions.attack`, `pending` → Waiting) and the **interim "Attack" button** (`PickLauncher`, bottom right) until H3.4's ring opens H3.2's picker (bead **dcm-bxp.99.32.18**). After a resolved attack it shows "Hit" / "Miss" / "Defeated" beside the button (hard rule 2) until H4.1's result panel. |
| `index.tsx` | `HudPick` (panel + waiting + launcher), `HudPickLayer`, and the public API re-exports. |
| `pick.css` | Board values on the `--hud-*` tokens. |

### Out-of-owns edit

- `src/components/combat-map/hud/shell.tsx`: mounts `<PickProvider>` inside `<HudProvider>` (import + 2 lines). The
  session must be shared by the pop region (panel), the map layer (rings) and every picker region (hand, ring, sheet),
  and `state.tsx`'s slot only says which session is open (its own comment: "H3.0 owns the session itself").

## The pick-session API (for H3.1, H3.2, H3.3, H3.4, H5.2)

Import from `src/components/combat-map/hud/pick` (inside the HUD shell only; `usePick()` throws elsewhere).

```ts
const pick = usePick();
pick.open(spec);            // from a click handler; ends any other session (its onCancel runs)
pick.session;               // PickLive | null: { spec, picked, options, sending, message }
pick.cancel();              // ✕ / Esc: runs spec.onCancel, gives focus back to what opened it
pick.update(patch);         // change rule / options / primary / rows / data of the open session
pick.setPicked(ids); pick.setOption(id, on); pick.send(selection); pick.finish();
```

`PickSessionSpec<D>`:

| Field | Meaning |
|---|---|
| `id` | Stable per picker and thing ("card:vicious-entangle:cast"). Opening the same id again replaces it. |
| `source` | `{ kind: "card" \| "attack" \| "feature" \| "reaction" \| "adversary", name, cardId? }`: header name; `cardId` gives the art thumbnail. |
| `rule` | The Hand model's `TargetAsk` (`targetAsk(use)` from `actions/hand/model.ts` gives it for a card use) + `min?` (default 1; 0 = optional targets), `slot?` (weapon for `range: "weapon"` and for the line-of-sight hints), `text?` (header rule line; default `ruleText`: "Pick 1 target within Far"), `locked?` (forced attack: rows and rings show, taps do nothing). `max: 1` = a tap replaces; `n` = up to n; `null` = any number. |
| `primary` | `{ label(sel), pay?(sel), blocked?(sel), send(sel) }`. `label` names the action ("Cast on Lieutenant"). `pay` is the footer cost line; an out-of-range pick replaces it with "Out of range: the GM approves first. Nothing is rolled or paid until then." `blocked` returns the client-side reason (CmpBlocked layer 1, "Needs 3 Hope · you have 1"). `send` returns `PickOutcome`: `{kind:"done"}` (ends), `{kind:"pending", requestId}` (ends; Waiting shows from the server), `{kind:"stay", message?}` (keeps the panel). A thrown `ConvexError` keeps the panel and shows `errorMessage(e)` under the primary (layer 2). |
| `actor?` | `{ tokenId, characterId? }`. Default: the player's own character. The GM must pass it (Play for: the PC's token + characterId; H5.2: the adversary's token). |
| `picked?` | Initial picks (e.g. `seenTargets(targetTokenIds, actor.enemies)`). Unknown / out-of-sight ids drop. |
| `options?` | `PickOption[]`: `{ id, label, note?, cost?: { amount, resource }, defaultOn?, disabled?, tokenId?, ringLabel? }` → switch rows with cost pills; `tokenId` + `ringLabel` put a `.tg-rl` label under that token while on ("Restrain"). Say "If it hits, …" in the label for on-hit riders. |
| `rows?` | `PickRowInput[]` the picker builds itself (minion offer, chain links, the GM's adversary attack): `{ tokenId, name, side, band, reach: "in"\|"out"\|"los", conditions? }`. Default: every creature fitting `rule.side`. |
| `extra?` | `(ctx) => ReactNode`: picker rows between targets and options (grimoire spell, weapon tiles, Lead by Example). `ctx = { selection, data, update, close }`. Keep picker state in `data` and change it with `update({ data })` so the render stays pure. |
| `data?` | Picker-owned state (typed `D`). |
| `onCancel?` | Runs once when the session ends without a send (lower the raised card, clear an aim). |

`PickSelection` (what `label` / `pay` / `blocked` / `send` / `extra` see): `{ targets: PickRow[] (first = primary target),
targetIds, outOfRange, options }`. Rows: `{ tokenId, name, side, band, reach, conditions }`; names and bands only (U1),
condition names per answer 10a.

**Out of range → GM approval**: pickers do nothing special. The row says "GM approves", the ring is amber with a GM
badge, the footer says nothing is paid until then, the primary still sends; the server (`useCard` / `useFeature` /
`attack`) answers `pending`; return `{ kind: "pending", requestId }` and the HUD shows "Waiting for the GM" with
Withdraw (from the open-request reads, so it survives a reload and the GM's Allow / Decline removes it live).
Out of sight (`reach: "los"`, from the server's hint) is listed greyed "Can't see" and never picked (Q2,
COMBAT_NO_LINE_OF_SIGHT).

### Example (H3.1, a one-target card)

```tsx
const pick = usePick();
const ask = targetAsk(use)!;                       // { side: "enemy", max: 1, range: "far" }
pick.open<{ spell: string | null }>({
  id: `card:${card.cardId}:${use.id}`,
  source: { kind: "card", name: card.name, cardId: card.cardId },
  rule: ask,
  picked: seenTargets(targetTokenIds, actor.enemies),
  data: { spell: null },
  options: riders.map((r) => ({ id: r.id, label: `If it hits, also ${r.name}`, cost: { amount: 1, resource: "hope" } })),
  extra: ({ data, update }) => <SpellRows value={data.spell} onPick={(spell) => update({ data: { spell } })} />,
  primary: {
    label: (s) => (s.targets[0] ? `Cast on ${s.targets[0].name}` : "Cast"),
    pay: () => (hope === 1 ? "Spends your last Hope" : "Spends 1 Hope"),
    blocked: () => (hope < 1 ? "Needs 1 Hope · you have 0" : null),
    send: async (s) => {
      const out = await useCard({ ..., targetTokenIds: [...s.targetIds], idempotencyKey: crypto.randomUUID() });
      if (out.status === "pending") return { kind: "pending", requestId: out.requestId };
      if (out.status === "needsChoice") return { kind: "stay", message: "Choose after the roll" }; // or open the next step
      showResult(out);
      return { kind: "done" };
    },
  },
  onCancel: () => lowerCard(card.cardId),
});
```

H3.2: start from `plainAttackSession` (attack.tsx), add weapon tiles in `extra` (switching `rule.slot` with `update`),
roll chips and riders as `options`, `rule.locked` for a forced attack, the minion pick as `rows`. H3.3: features as above;
areas / walls / chains are their own map modes (the panel's `rows` can show chain links). H5.2: `actor: { tokenId:
adversaryToken }` with `rows` (the server's view of the adversary's targets), purple variant to add.

## Board states matched (shots: `E2E_VISUAL=1 E2E_PORT=… E2E_CONVEX_PORT=… pnpm exec playwright test tests/e2e/visual/HUD-H3.0.spec.ts`)

`test-results/visual/HUD-H3.0/`: `player-picking-{1440,1024,390}.png`, `player-panel.png`, `player-rings-1440.png`,
`player-waiting-1440.png`, `player-waiting-card.png`; board renders beside them: `board-Main.png` (Main 'Picking a
target'), `board-CmpPicking.png`, `board-CmpPromptsPlayer.png`.

- CmpPicking 'One target · a card' / Main 'Picking a target': panel beside the primary target, header + rule, rows
  picked / in / out "GM approves" / los "Can't see" with condition names, riders as switches with cost pills, footer
  cost line + one primary naming the action. Matched; the seed's real scene (Moss's first weapon, the Jagged Knife
  adversaries) replaces the sample.
- CmpTokens 'Target rings': picked (solid gold, check), in (dashed gold), out (dashed amber, GM), los (dotted salmon,
  dimmed face, eye-off), ally picked mint, band label above, `.tg-rl` below. Matched.
- CmpPromptsPlayer 'Waiting for the GM': hourglass, "Waiting for the GM", "<use> · out of range", the reason, "Asking the
  GM…" with the dots, Withdraw. Matched; placed at the right under the Fear banner (the boards don't place it on Main).
- Deviations: a picked out-of-range row shows "✓ GM approves" and its ring stays amber with the GM badge (the boards
  never show both at once; hard rule 3 wins). Conditions wrap under long adversary names. The panel's footer wraps
  long primary labels ("Attack Jagged Knife Lieutenant"). Phone: a bottom sheet, its footer padded clear of the app's
  floating "Ask the Lorekeeper" button (H7.x owns the phone layout).

## What moved out of the old column

Nothing yet: the classic TargetList / Attack bar / Use dialog stay (drawer). The HUD's own rows and rings replace them
per picker in H3.1-H3.3; the interim Attack button covers a plain attack meanwhile.

## Tests

- `tests/unit/hud/pick-model.test.tsx` (17): rows (sides, bands, weapon reach from hints, out of sight, order,
  conditions), single / multi / locked picks, keepPicks, selection, primary problems, rule line, labels without digits,
  waiting rows and reason, plain attack session (pending, Hit / Miss / Defeated).
- `tests/unit/hud/pick-panel.test.tsx` (11): open → focus to the title once placed, slot, rows / rings states, row and
  ring taps in step, single replace, los not pickable, rider ring label, GM footer line, pending send ends without
  onCancel, refusal under the primary, Esc / ✕ cancel + onCancel + focus back, `extra` + `update`, loading line;
  waiting cards, Withdraw args, refusal on the card, optimistic update, GM gets none; the interim Attack button.
- `tests/e2e/hud-pick.spec.ts` (2): player panel / rows / rings / band labels / GM badge / ring tap / position right of
  the target / axe / Esc + focus back; live two-browser: an out-of-range attack shows "Waiting for the GM" for the
  player and the request in the GM's classic Resolutions list; Withdraw removes both; Hope unchanged; axe.
- `tests/e2e/visual/HUD-H3.0.spec.ts` (1, `E2E_VISUAL=1`).

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest focused: `tests/unit/hud` 11 files, 141 passed (28 new). Full suite (`--maxWorkers=2 --testTimeout=120000`): 456 files,
  10289 passed + 1 expected fail.
- e2e (ports 3181 / 3474): `hud-pick.spec.ts` 2 / 2; all `tests/e2e/hud-*.spec.ts` 14 / 14 (banners, fear, hand,
  make-room, pick, sheet, shell, spotlight, tokens); `visual/HUD-H3.0.spec.ts` 1 / 1. The first build failed with
  "next/font/google queries have exactly one entry" (docs/testing.md): deleting `.next-e2e-3181` and building outside
  the sandbox fixed it.

## Beads

- Filed **dcm-bxp.99.32.18**: remove the interim Attack button once H3.4's ring opens H3.2's attack picker (give
  `hud/pick/attack.tsx` + `hud/pick/index.tsx` to H3.4's owns, or do it at merge).

## Merge-time actions

- Accept the out-of-owns `hud/shell.tsx` edit (`PickProvider` mount).
- No Convex change, no codegen, no schema, no authz entry.
- Plan note for H3.1-H3.4: they read `hud/pick/**`; a picker needing a panel change (e.g. H5.2's purple GM variant, a
  tablet layout) should get `hud/pick/panel.tsx` / `pick.css` in its owns.

## QUESTIONS (safest reversible defaults taken)

1. **Where does "Waiting for the GM" sit on Main?** The boards show it only on CmpPromptsPlayer. Default: a card at the
   right under the Fear banner (moves left with the sheet). Easy to move.
2. **Interim Attack entry.** H3.0 has no picker of its own on the boards; to give the API a real consumer (and the live
   acceptance an out-of-range pick) it adds a small "Attack" button bottom right, removed by H3.4 (dcm-bxp.99.32.18).
   Alternative: hide it until H3.4 and test through H3.1's card picker instead.
3. **Ally / self picks on the map.** Ring taps work for every listed row (allies too, mint when picked); with no
   session, a click on an ally token still opens their sheet (H2.1). Confirm that during a pick a tap on an ally's ring
   should pick rather than open the sheet (the default).
4. **Line of sight for non-enemies.** The server's hints (`combatActions.targets`) cover enemies only; an ally or
   neutral listed in a session is never "Can't see" (the player sees them in `playerView`). Card rules for allies
   ("an ally within Close") don't ask for line of sight in the text the card runner checks; if a card needs it, the
   server answers COMBAT_NO_LINE_OF_SIGHT under the primary.
