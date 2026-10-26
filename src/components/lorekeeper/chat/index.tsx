"use client";

import "./chat.css";

import { ConversationsMenuView } from "../conversations/menu";
import type { LorekeeperChatProps } from "../slots";
import { ChatView } from "./chat";

/**
 * The chat slot (D13 L6; contract in ../slots.ts): `LorekeeperChat` is the chat panel body (the stream and the
 * composer; also the drawer's body, L7) and `ConversationsMenu` the 'Conversations' menu in the chat header. Both
 * show the same conversation (./selection.ts). The page wraps each in its own error boundary.
 */
export function LorekeeperChat(props: LorekeeperChatProps) {
  return <ChatView {...props} />;
}

/** The 'Conversations' menu in the chat header. */
export function ConversationsMenu(props: LorekeeperChatProps) {
  return <ConversationsMenuView {...props} />;
}
