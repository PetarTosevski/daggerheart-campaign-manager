# TASK-LK-LK2: Jump to latest bottom-right; new answers always scroll to the latest (dcm-bxp.82.12)

Plan: `.omc/plans/lorekeeper-scroll.yaml`, tracer LK2 (after LK1).

## Request

User 2026-10-29 (screenshot): the 'Jump to latest' button sat centred over the answer text with a see-through look and was hard to read. Wanted: bottom-right of the message area, a solid background, a 44 px target; a new message or answer (including an answer starting to stream) always brings the view to the latest, even if the reader had scrolled up; while reading older messages with no new answer, the reader goes down only via 'Jump to latest'.

## What changed

- `chat/chat.css`: `.lk-act.lk-jump` sits at `right: 14px; bottom: 14px` of `.lk-streamwrap`, background `--lk-card`, border `--lk-gold-deep`, text `--lk-text`, `min-height: 44px` (hover `--lk-line`). The compound selector beats `.lk-act`'s transparent background and its hover.
- `chat/chat.tsx` (`Stream`): the layout effect keeps a `seen` ref (last message id, whether it was streaming, pending question, loading). An arrival (first render or conversation switch, a new last message id, the pending question showing or going, loading ending, the last answer starting to stream) sets `stuck` and scrolls to the end. Text growing between arrivals is followed only while the reader is at the bottom. DOM and refs only; `away` is still set only from the scroll handler and the button scrolls in its click handler (rule 13).

## Tests

`tests/e2e/lorekeeper-chat.spec.ts`: after the Hex answer, the log is scrolled to the top; 'Jump to latest' is in the bottom-right corner of the log (right half, within 40 px of its right and bottom edges), at least 44 px tall, with a non-transparent background. A question asked from there is in view and the button hides. LK1's reload, jump and one-screen checks still pass.
