# TASK-SR-DD1: Domain Deck browser with Take card

Status: Review. Plan: `.omc/plans/domain-deck.yaml`, tracer DD1. No schema change (`docs/data-model.md` unchanged).

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Rules (`src/lib/domain/level-up/index.ts`):** new exports shared by the server and the sheet, so the two cannot disagree:
  - `cardsAllowed(sheet)`: level + 1 + one per "additional domain card" advancement pick. The Domains box now uses it too.
  - `deckDomains(sheet)`: the class domains, then the multiclass domain.
  - `unlockLevel(sheet, card)`: the lowest level at which the card comes within reach (class domain: its level; multiclass domain: 2 × level − 1), or null.
  - `cardTakeProblem(sheet, cardId, sources)`: `{ reason: "unknown" | "owned" | "locked" | "full", message }` or null. Built on the existing `cardLimit` with cap `MAX_LEVEL`.
  - `sourcesFor` and `addCard` (loadout while it holds fewer than 5, else vault) are now exported. They are reused, not copied.
- **Server (`convex/characters.ts`): `takeCard`** `userMutation({ characterId, cardId })`, returns `null`. It loads through `editable()` (owner or GM). It finds the sources the way `levelUp.apply` does (`resolveOptions(...).hopeAndFear`) and refuses with `INVALID` (the `cardTakeProblem` message) when the call breaks the rules. Otherwise it saves `addCard(...)` through `saveSheet`, which bumps `updatedAt`. Taking a card costs no Stress.
- **Client (`C/sheet-context.tsx`):** `takeCard(cardId)` is wired through `run()` like `moveCard`.
- **UI (`C/sections/domains.tsx` + `domains.css`):** the "Domain Deck" `SheetBox` sits below the felt table and follows the board's markup:
  - Filter group "Filter by domain" (All + each domain, `aria-pressed`) and the "Hide cards above my level" toggle.
  - `dk-grid` of `dkc` cards: domain colour, icon, name, level, art when present, meta "Domain Type · Recall N", text clamped to 5 lines with More/Less (`aria-expanded`, named "More about X").
  - Buttons per state, from `cardTakeProblem`: "Take card" (`Take X`), disabled "No picks left" (`No picks left for X`), owned badge "In loadout" / "In vault".
  - Locked cards sit in a `dkf` flip wrapper. The face-down back uses the domain's `CARD_BACKS` art and is a button labelled with the board's backLabel. Turning it over shows the greyed face with "Unlocks at level N" and a ghost "Turn over" button. The hidden side is `inert` + `aria-hidden`, and focus moves to the side that now shows.
  - Read-only viewers see the deck, filters and backs, but no Take or No-picks buttons.
  - Take busy-disables every Take button while the mutation runs.
  - The hand-empty text now reads as the board's.

## Defaults and deviations

- **No "Remove" button**, as the plan says.
- **Clamped text, not the board's scrolling 5/7.6 cards:** the board's later override (line 239) gives deck cards a fixed aspect ratio and scrolling text. The acceptance asks for clamping with More/Less, so this build follows the base `.dkc` rules. That also avoids focusable scroll regions (as S12 decided).
- **44 px targets everywhere:** the filters, Take, Turn over and More are at least 44 px tall at every width. The board uses 32–34 px buttons.
- **Locked rule:** cards out of reach follow `cardLimit` (the multiclass domain unlocks at ceil(level/2)), not the board's plain `level > L`.
- **Face-down labels repeat:** the board's backLabel ("Face-down level N Domain card. …") is the same for every card of a domain and level. It is kept as specified.
- **authz matrix:** `tests/convex/authz-matrix.test.ts` does not exist yet (hardening plan). `tests/convex/domain-deck.test.ts` covers anonymous (UNAUTHENTICATED), outsider (NOT_FOUND), another player (FORBIDDEN) and the GM (ok).

## Visual comparison

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| domain deck | test-results/visual/DD1/domain-deck-* | test-results/visual/board/domain-deck-* | Same layout: filter pills, the toggle on the right, a 4-column grid at 1440, card anatomy, Take buttons in the domain colour, face-down backs with the "Level N" tag. The board's test bard is at a higher level, so it shows more open cards. Card art renders in the app (the board's `/_blob` art is blank from disk). One column at 390, with no horizontal scroll. |
| deck, one card turned over, one expanded | DD1/domain-deck-flipped-* | (board state not shot) | The flipped face is greyed with "Unlocks at level 3" and Turn over. More expands the full text. |

## Verification (ports 3118/3348)

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 102 files, 1062 tests passed.
- e2e: character-sheet (3), level-up (1), domain-deck (1) passed. `E2E_VISUAL=1` DD1 (1) passed.
