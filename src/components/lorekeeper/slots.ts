import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Props of the Lorekeeper's feature slots (D13, plan `.omc/plans/d13-lorekeeper.yaml`). The page (L0,
 * `src/app/(gm)/campaigns/[campaignId]/lorekeeper/page.tsx`) owns the layout, the chat header frame (sigil,
 * 'The Lorekeeper', 'Keeper of your rulebooks · answers rule questions') and the error boundary around every slot;
 * each feature tracer owns its folder and fills the components its `index.tsx` exports, keeping their names and
 * props:
 *
 * | Folder           | Tracer | Exports (where the page mounts them)                                                   |
 * |------------------|--------|----------------------------------------------------------------------------------------|
 * | `chat/`          | L6     | `LorekeeperChat` (chat panel body: the stream and the composer; also the drawer's body),|
 * |                  |        | `ConversationsMenu` (chat header, right: the 'Conversations' menu)                      |
 * | `side/`          | L7     | `LorekeeperSide` (sidebar: Library, How I answer, Table rulings; at <= 760 px the       |
 * |                  |        | 'Library & rulings' fold, Q12), `IndexPill` (chat header, right: '<N> books indexed')   |
 * | `drawer/`        | L7     | mounted by the campaign layout, not by this page (the floating pill + `<dialog>`)       |
 * | `composer/`, `answer/`, `conversations/` | L6 | used inside `chat/`                                                 |
 *
 * Page layout (board Lorekeeper.dc.html, `page` variant): under the campaign chrome, a grid of a 300 px sidebar
 * (`<aside class="lk-side" aria-label="Library and rulings">` holding `LorekeeperSide`) and the fluid chat panel
 * (`<section class="lk-chat" aria-label="The Lorekeeper">`: header, then `<div class="lk-body">` holding
 * `LorekeeperChat`). At <= 760 px one column, the sidebar above the chat.
 *
 * Rules for every slot:
 * - The page wraps each slot in its own error boundary (CL1); a slot shows its own loading state (role=status)
 *   while its `useQuery` is `undefined`.
 * - Styles: the board's `lk-*` classes and `--lk-*` tokens from the page's `lorekeeper.css` (its header lists them);
 *   a slot adds CSS only in a colocated `.css` in its folder. Components rendered outside the page (the drawer)
 *   import `lorekeeper.css` themselves and put `lk-root` on their container.
 * - Text from the model, the books or other users renders as plain text only (no Markdown, no HTML).
 * - The server decides what each member reads (Q3: conversations are public to the campaign unless private; GM-only
 *   data never reaches a prompt, Q4); `access.isGm` only picks which controls to show.
 */

export type LorekeeperAccess = {
  /** The campaign's GM (pins rulings, switches books, sees Ask-the-GM requests). */
  isGm: boolean;
};

/** Where the chat column is shown: the Lorekeeper page or the drawer over another campaign page (L7). */
export type LorekeeperVariant = "page" | "drawer";

/** Props of `LorekeeperChat` and `ConversationsMenu`. */
export type LorekeeperChatProps = {
  campaignId: Id<"campaigns">;
  access: LorekeeperAccess;
  variant: LorekeeperVariant;
};

/** Props of `LorekeeperSide` and `IndexPill`. */
export type LorekeeperSideProps = {
  campaignId: Id<"campaigns">;
  access: LorekeeperAccess;
};
