import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { CONVERSATIONS_LABEL, NEW_CONVERSATION_LABEL } from "../../../../../src/lib/lorekeeper/copy";
import type { ConversationView } from "../../../../../convex/lorekeeper";
import { api, type Id } from "../../convex";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import { askerNames } from "../../../../../src/lib/lorekeeper/names";
import { resolveSelection, useSelection } from "./selection";
import type { LorekeeperChatProps } from "./slots";
import { lkStyles } from "./styles";

export function ConversationsMenu(props: LorekeeperChatProps) {
  const { campaignId } = props;
  const lists = useQuery(api.lorekeeper.listConversations, { campaignId });
  const roster = useQuery(api.members.roster, { campaignId });
  const [selection, select] = useSelection(campaignId);
  const current = resolveSelection(selection, lists?.mine);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<ConversationView | null>(null);
  const remove = useMutation(api.lorekeeper.removeConversation);
  const names = askerNames(roster);

  const pick = (id: Id<"lorekeeperConversations"> | "new") => {
    select(id);
    setOpen(false);
  };

  return (
    <>
      <Button onPress={() => setOpen(true)} variant="outline">
        {CONVERSATIONS_LABEL}
      </Button>
      <Sheet onClose={() => setOpen(false)} open={open} title={CONVERSATIONS_LABEL}>
        <View style={{ gap: 12 }}>
          <Button onPress={() => pick("new")} variant="outline">
            {`＋ ${NEW_CONVERSATION_LABEL}`}
          </Button>
          {lists === undefined ? <Text style={lkStyles.muted}>Loading…</Text> : null}
          {lists?.mine.map((row) => (
            <Pressable key={row._id} accessibilityRole="button" onPress={() => pick(row._id)}>
              <Text style={lkStyles.muted}>{row.title}</Text>
              {current === row._id ? <Text style={lkStyles.muted}>Selected</Text> : null}
              <Button onPress={() => setDeleting(row)} variant="outline">
                Delete
              </Button>
            </Pressable>
          ))}
          {lists?.shared.map((row) => (
            <Pressable key={row._id} accessibilityRole="button" onPress={() => pick(row._id)}>
              <Text style={lkStyles.muted}>
                {names.get(row.userId) ?? "A player"} · {row.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
      {deleting ? (
        <Sheet onClose={() => setDeleting(null)} open title="Delete conversation?">
          <Text style={lkStyles.muted}>This removes “{deleting.title}” from your list.</Text>
          <View style={lkStyles.acts}>
            <Button onPress={() => setDeleting(null)} variant="outline">
              Cancel
            </Button>
            <Button
              onPress={async () => {
                try {
                  await remove({ campaignId, conversationId: deleting._id });
                  if (current === deleting._id) select("new");
                  setDeleting(null);
                  setOpen(false);
                } catch (caught) {
                  console.error(errorMessage(caught));
                }
              }}
              variant="danger"
            >
              Delete
            </Button>
          </View>
        </Sheet>
      ) : null}
    </>
  );
}
