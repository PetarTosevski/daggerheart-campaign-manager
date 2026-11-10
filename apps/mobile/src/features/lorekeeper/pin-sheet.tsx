import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { ACTION_LABELS } from "../../../../../src/lib/lorekeeper/copy";
import { LOREKEEPER_LIMITS } from "../../../../../convex/lib/validators/lorekeeper";
import { useMutation } from "convex/react";

import { api, type Id } from "../../convex";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import { lkStyles } from "./styles";

export function PinSheet({
  open,
  campaignId,
  answerId,
  draft,
  onClose,
}: {
  open: boolean;
  campaignId: Id<"campaigns">;
  answerId: Id<"lorekeeperMessages">;
  draft: { title: string; text: string };
  onClose: () => void;
}) {
  const pin = useMutation(api.lorekeeperRulings.pin);
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = title.trim().length > 0 && text.trim().length > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await pin({ campaignId, title: title.trim(), text: text.trim(), fromMessageId: answerId });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} open={open} title={ACTION_LABELS.pinRuling}>
      <View style={lkStyles.form}>
        <Text style={lkStyles.muted}>Title</Text>
        <TextInput
          maxLength={LOREKEEPER_LIMITS.rulingTitle}
          onChangeText={setTitle}
          style={lkStyles.field}
          value={title}
        />
        <Text style={lkStyles.muted}>Ruling</Text>
        <TextInput
          maxLength={LOREKEEPER_LIMITS.rulingText}
          multiline
          onChangeText={setText}
          style={[lkStyles.field, lkStyles.fieldMultiline]}
          value={text}
        />
        {error ? (
          <Text accessibilityRole="alert" style={lkStyles.muted}>
            {error}
          </Text>
        ) : null}
        <View style={lkStyles.acts}>
          <Button onPress={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!valid || busy} onPress={() => void submit()}>
            Pin ruling
          </Button>
        </View>
      </View>
    </Sheet>
  );
}
