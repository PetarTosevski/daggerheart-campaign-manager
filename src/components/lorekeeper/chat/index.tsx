import type { ReactNode } from "react";

import { Sigil } from "../sigil";
import type { LorekeeperChatProps } from "../slots";

/**
 * The chat panel body: stream and composer (L6 replaces this L0 stub, keeping the names and props; contract in
 * ../slots.ts). The stub shows the empty conversation's intro.
 */
export function LorekeeperChat({ variant }: LorekeeperChatProps) {
  return (
    <div className="lk-stream" role="log" aria-live="polite" aria-label="Conversation" data-variant={variant}>
      <div className="lk-intro">
        <Sigil />
        <p className="lk-muted">Ask me anything about the rules in your books.</p>
      </div>
    </div>
  );
}

/** The 'Conversations' menu in the chat header (L6). The stub renders nothing. */
export const ConversationsMenu: (props: LorekeeperChatProps) => ReactNode = () => {
  return null;
};
