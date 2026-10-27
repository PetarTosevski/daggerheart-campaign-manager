# TASK-LK-LK1: Lorekeeper chat opens at the latest message (dcm-bxp.82.11)

Plan: `.omc/plans/lorekeeper-scroll.yaml`, tracer LK1.

## Request

User 2026-10-27, Claude's chat UI as the model: the Lorekeeper opened at the top and needed scrolling down. Wanted: the newest message visible on open, older ones reachable by scrolling up, the page itself fixed.

## What changed

- `lorekeeper/page.tsx`: the root is `data-page`; a layout effect measures the campaign header above it into `--lk-top` (DOM only, no state, re-measured on resize and body resize).
- `lorekeeper.css`: `.lk-root[data-page]` is `100dvh - --lk-top` tall (minimum 460 px) with `overflow: hidden`, so the document is one screen. The grid stretches; the library side panel scrolls on its own; the chat card fills the height. At 760 px and below the side row is 72 px (it is the folded "Library & rulings") and the chat header is compact (subtitle stays, one line).
- `chat/chat.css`: `.lk-chatcol` no longer has a calc height; `.lk-streamwrap` is the scroll area's frame; the first child gets `margin-top: auto` so a short conversation sits against the composer (bottom anchored). Phones: suggestion chips and the toggle row are one scrolling row so the stream keeps at least about 150 px at 390x844.
- `chat/chat.tsx`: `Stream` keeps the existing layout-effect scroll-to-end (mount, conversation switch, new or streaming message, unless the reader scrolled up) and adds a "Jump to latest" button. `away` state is set only from the scroll handler; the button scrolls in its click handler (rule 13).

## Tests

`tests/e2e/lorekeeper-chat.spec.ts`: `expectPinnedAndFixed` (log at its end, composer on screen, document height equals the viewport) after a reload, after scrolling up and clicking "Jump to latest", and at 390, 820 and 1440 wide.
