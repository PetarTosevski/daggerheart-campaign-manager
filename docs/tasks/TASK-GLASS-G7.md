# TASK-GLASS-G7: Lorekeeper buttons are glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G7; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.8.
Built on G0 (`docs/tasks/TASK-GLASS-G0.md`) and the briefs' default answers (Q1-Q9 = a). The page renders inside the
campaign shell, so every button (and every native `<dialog>`: the brand Modal and the drawer) takes the shell's
`data-viewer`; no portal needs `ViewerScope`.

## Buttons per file

| File | Button | Role | Notes |
|---|---|---|---|
| `lorekeeper/error.tsx` | "Try again" | neutral, sm | route error boundary |
| `lorekeeper/page.tsx` | Slot boundary "Try again" | neutral, sm | |
| `chat/boundary.tsx` | Chat boundary action ("Try again" / its label) | neutral, sm | |
| `composer/composer.tsx` | Suggestion chips ("Critical hits", …) | neutral, sm | `flex-none` keeps them from shrinking in the phones' one-row scroller |
| `composer/composer.tsx` | "Ask" | confirm | `flex-none` |
| `composer/composer.tsx` | "Stop" (while an answer streams) | cancel | backs out of the running answer |
| `composer/composer.tsx` | Internet search On / Off | neutral, sm + `aria-pressed` | a two-option switch (Q6 a) |
| `composer/composer.tsx` | "Private" | neutral, sm + `aria-pressed` | a switch |
| `composer/composer.tsx` | "Start a new conversation" (notice) | neutral, sm | the composer's Ask stays the one confirm |
| `chat/question.tsx` | "Edit" on the asker's question | neutral, sm | |
| `chat/question.tsx` | Edit mode "Cancel" / "Save" | cancel / confirm, sm | |
| `chat/chat.tsx` | "Show earlier messages" | neutral, sm | `self-center` |
| `chat/chat.tsx` | "Jump to latest" | neutral | keeps `lk-jump` (position only, plus a solid `background-color` under the glass so answer text does not show through, LK2) |
| `answer/answer-card.tsx` | Error card "Try again" | neutral, sm | |
| `answer/answer-card.tsx` | Copy, Open in book, Pin as table ruling, Ask the GM / Sent to the GM | neutral, sm | the goal's "answer-card actions neutral"; disabled logic unchanged |
| `answer/answer-card.tsx` | "Show on the map" (`<Link>`) | `brandButton` neutral, sm | `no-underline` |
| `answer/pin-dialog.tsx` | "Cancel" / "Pin ruling" (submit) | cancel / confirm | |
| `side/index.tsx` | "Library & rulings" fold (phones) | tool | keeps `lk-foldbtn` for layout only (hidden above 760 px, full width, label left / chevron right) |
| `side/library.tsx` | "About books" (GM) | neutral, sm | |
| `side/library.tsx` | About books dialog "Got it" | cancel | only closes the dialog |
| `side/rulings.tsx` | Ruling "Edit" | neutral, sm | |
| `side/rulings.tsx` | Ruling "Unpin" | danger, sm | opens the confirm (Q9 a: the opener and the final button are both red) |
| `side/rulings.tsx` | Open ask "Pin a ruling" / "Dismiss" | allow / deny, sm | the GM's yes / no to a player's Ask-the-GM request (role map) |
| `side/rulings.tsx` | Ruling dialog "Cancel" / "Save" or "Pin ruling" | cancel / confirm | |
| `side/rulings.tsx` | Unpin dialog "Cancel" / "Unpin" | cancel / danger | |
| `drawer/panel.tsx` | Drawer "✕" (Close the Lorekeeper) | cancel, icon, round | `flex-none` |
| `conversations/menu.tsx` | "Conversations ▾" | neutral, sm | `aria-expanded` unchanged; the ref still reaches the button (React 19 ref prop) |
| `conversations/menu.tsx` | "＋ New conversation" | confirm, sm | the menu's one main action |
| `conversations/menu.tsx` | Row "🗑" (Delete “…”) | danger, icon | `flex-none self-center`; opens the confirm (Q9 a) |
| `conversations/menu.tsx` | Delete dialog "Cancel" / "Delete" | cancel / danger | |

### Left alone, and why

| File | Button | Why |
|---|---|---|
| `drawer/index.tsx` | The floating "Ask the Lorekeeper" pill (not on the Combat Map) | the board's gold sigil pill, the twin of the app bar's `.ab-lk` pill that G1 left alone for the same reason; the app-bar pill is G1's |
| `side/library.tsx` | Book "Indexed" / "Off" pill (`role="switch"`, `aria-checked`) | a status pill that doubles as the GM's switch; players see the same pill as plain text. Making it glass would change its semantics (`aria-checked` → `aria-pressed`) and the board's green / red state colours |
| `answer/answer-card.tsx` | Quote chips "📖 <book> · p.<page>" (`lk-chip`) | citation chips on the parchment that open the page, i.e. links |
| `conversations/menu.tsx` | Conversation rows (`lk-convos-pick`) | list rows that open something |

## CSS deleted

| File | Rules |
|---|---|
| `lorekeeper/lorekeeper.css` | `.lk-act` (+ `:hover`, `:disabled`), `.lk-act-dark` (+ `:hover`), `.lk-sug` (+ `:hover`), `.lk-send` (+ `:disabled`), `.lk-toggle button` (+ `[aria-pressed]`); `.lk-toggle` now only lays out its two glass buttons; the phones' 44 px rule keeps only `.lk-chip`; header comment updated |
| `side/side.css` | `.lk-act-gold` (+ `:hover`), `.lk-rulingacts .lk-act` heights, the `.lk-foldbtn` / `.lk-act` focus outlines, `.lk-help .lk-send`, `.lk-dialog .lk-danger`; the phones' `.lk-foldbtn` look (border, background, font, height, padding) down to `display` / `justify-content` / `width` |
| `chat/chat.css` | `.lk-act.lk-jump` look (now `.lk-jump`: position + solid backing), `.lk-act.lk-qeditbtn`, `.lk-act.lk-qsave`, `.lk-earlier`, the `.lk-act` / `.lk-sug` / `.lk-send` / `.lk-toggle button` / `.lk-visibility` focus outlines, `.lk-actlink`, `.lk-visibility` (+ `[aria-pressed]`), `.lk-sug:disabled`, `.lk-formacts .lk-act`, `.lk-danger`, `.lk-convos-toggle`, `.lk-convos-new`, `.lk-convos-del` (+ `:hover`, `:focus-visible`), the phones' `.lk-visibility` / `.lk-convos-toggle` / `.lk-earlier` / `.lk-send` / `[data-page] .lk-sug` rules |
| `drawer/drawer.css` | `.lk-drawerclose` (+ `:focus-visible`) |

The small glass buttons reach 44 px on touch by themselves (`gb-sm` under `max-width: 1100px`, `pointer: coarse`),
so the per-class 44 px phone rules went with the classes.

## Shots

`tests/e2e/visual/GLASS-G7.spec.ts` (`E2E_VISUAL=1`) writes to `test-results/visual/GLASS-G7/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g7/`:

- `page-{gm,player}-{1440,1024,390}`: the page with a "From the rules" and a "Rules unclear" answer (the GM reads the
  player's shared conversation); `side-gm-390`: the opened 'Library & rulings' fold with the open ask and a ruling.
- `composer-{gm,player}-hover-ask`: a hovered Ask confirm (axe clean); `answer-{gm,player}-focus-copy`: a
  keyboard-focused Copy on the parchment (axe clean focused and hovered).
- `conversations-{gm,player}`, `delete-player-hover-danger` (axe clean), `unpin-gm`, `pin-gm-hover-confirm` (axe
  clean), `about-gm`, `drawer-gm`, `drawer-gm-focus`.

The spec also asserts the roles, the viewer colours (Ask and Pin ruling: the Fear rim for the GM, the Hope rim for a
player; Cancel and the drawer ✕ the other way round) and 44 px at ≤ 1100 px.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G7`: OK.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/lorekeeper-ui`, `tests/unit/lorekeeper`,
  `tests/unit/brand`, `error-boundaries-redirect`, `app-bar`: 14 files, 207 passed; the full suite 519 files, 11051
  passed, 1 expected fail.
- e2e, servers started by hand on 3877 / 3977, `E2E_REUSE_SERVERS=1`, `--workers=1`:
  - lorekeeper-chat, lorekeeper-flow, lorekeeper-privacy, lorekeeper-shell, lorekeeper-side and the visual D13-L6,
    D13-L7, D13-L9 (`E2E_VISUAL=1`): 17 passed.
  - visual GLASS-G7: 1 passed.
