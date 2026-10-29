# TASK-LK-LK3: Edit a sent question; the edit replaces from there (dcm-bxp.82.13)

Plan: `.omc/plans/lorekeeper-scroll.yaml`, tracer LK3 (after LK2).

## Request

User 2026-10-29: "allow me to edit my questions, if I am in edit mode the answer should not be given until edit is completed & the new answer should look to the edited question". User answer (bead notes, binding): like ChatGPT and Claude. Saving an edit removes the old answer and every later message of the conversation, and the edited question gets a new answer.

## What changed

- `convex/lorekeeper.ts`: `editQuestion({ campaignId, questionId, question })` is one intent mutation (`campaignMutation`, `need: "view"`, rate limit `lorekeeperAsk` like `ask`). It refuses with `LOREKEEPER_NOT_FOUND` unless the row is a question of this campaign written by the caller in their own conversation (`ownConversation`). Then come the checks `ask` makes: `LOREKEEPER_QUESTION_INVALID` (1-1,000 characters after trimming), `LOREKEEPER_UNAVAILABLE`, `LOREKEEPER_BUSY` (an answer of the caller is on its way) and the caps (`reserve`: the edit counts as a question and books the first pass). In the same transaction it deletes every message of the conversation after the question, with the Ask-the-GM requests on those answers. A conversation holds at most 200 messages, so one bounded `.take(200)` read gets them all. It also writes the new text on the question (whose `_creationTime` is unchanged), corrects `messageCount`, renames the conversation when the edited question was the first one, inserts a pending answer and schedules `lorekeeperRun.run` and the watchdog. `prepare` finds the question as the message just before the new answer, and the history as the turns before it. Pinned rulings are their own rows and stay (`fromMessageId` may now point at a deleted answer, as it already can after a conversation is deleted).
- `src/components/lorekeeper/chat/question.tsx` (new): the question bubble. On the caller's own questions (`mine`, the Lorekeeper available, not an optimistic row) it shows an 'Edit' button (accessible name 'Edit question'). Edit mode replaces the bubble's text with a textarea ('Edit your question'), Cancel and Save. Enter saves, Shift+Enter adds a line and Escape cancels. Nothing is sent while editing. Save with unchanged text just closes edit mode. While an answer is on its way, a send is in progress or a cap applies, Save is disabled and the reason shows under the box. A failed save keeps the draft, and the composer's notice says why (`askFailure`).
- `src/components/lorekeeper/chat/edit.ts` (new): `editLocally`, the optimistic update. In the loaded pages of the question's conversation, the later messages leave, the question shows the new text and a pending answer (the thinking row) goes on top.
- `src/components/lorekeeper/chat/chat.tsx`: `ChatView` owns the `editQuestion` mutation and its failure notice (as for `ask`); `Stream` renders questions with `QuestionBubble`. `chat.css`: the Edit button, the edit box, Save / Cancel, the wait note.

## Tests

- `tests/convex/lorekeeper-chat.test.ts` (`editQuestion`):
  - editing the middle question of three removes its answer and the later pair and their Ask-the-GM request; a pinned ruling stays;
  - the run answers the edited text, and the request carries only the turns before the question;
  - `messageCount` is corrected and the title is unchanged; the edit uses one question of the day;
  - editing the first question renames the conversation;
  - the GM, an answer id, an empty or 1,001-character text, an edit while an answer is on its way and a missing key each get their code, and refused edits change nothing.
- `tests/convex/authz/lorekeeper-chat.entries.ts`: `editQuestion` works for the asker only (it gets `LOREKEEPER_UNAVAILABLE` past the access check, since the matrix has no key); otherPlayer, grantee and the GM get `LOREKEEPER_NOT_FOUND`.
- `tests/unit/lorekeeper-ui/edit-question.test.tsx`:
  - the bubble: Edit, Save (called once, with the trimmed text), Cancel, Escape, unchanged text, Save waiting with its reason, the draft kept on failure, and no Edit without `onEdit`;
  - `editLocally` on a fake store over two pages and another conversation.
- `tests/e2e/lorekeeper-chat.spec.ts`: a player asks two questions and edits the first. While editing, no thinking row and no new answer appear. After Save there is one question with the edited text and its new 'Rules unclear' answer; the old answer and the later pair are gone, also after a reload. The GM opens the shared conversation and sees no 'Edit question'.

No new module and no schema change, so `convex/_generated` needs no regeneration.
