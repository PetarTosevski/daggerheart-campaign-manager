import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { clip } from "../../../../../src/lib/lorekeeper/answer-model";
import { RULINGS_COPY, RULINGS_EMPTY, RULINGS_TITLE, pinnedLabel } from "../../../../../src/lib/lorekeeper/copy";
import { LOREKEEPER_LIMITS } from "../../../../../convex/lib/validators/lorekeeper";
import { api, type Id } from "../../convex";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import type { LorekeeperSideProps } from "./slots";
import { lkStyles } from "./styles";

type Ruling = { _id: Id<"lorekeeperRulings">; title: string; text: string; meta: string };
type OpenAsk = {
  _id: Id<"lorekeeperAsks">;
  messageId: Id<"lorekeeperMessages">;
  askerName: string;
  characterName: string | null;
  question: string;
  call: string | null;
};

export function RulingsCard({ campaignId, access }: LorekeeperSideProps) {
  const rulings = useQuery(api.lorekeeperRulings.list, { campaignId });
  const asks = useQuery(api.lorekeeperAsks.listOpen, access.isGm ? { campaignId } : "skip");
  const [editing, setEditing] = useState<Ruling | null>(null);
  const [pinning, setPinning] = useState<OpenAsk | null>(null);
  const [unpinning, setUnpinning] = useState<Ruling | null>(null);

  return (
    <View accessibilityLabel={RULINGS_TITLE} style={lkStyles.card}>
      <View style={lkStyles.cardHead}>
        <Text style={lkStyles.cardTitle}>{RULINGS_TITLE}</Text>
        {rulings !== undefined ? <Text style={lkStyles.muted}>{pinnedLabel(rulings.length)}</Text> : null}
      </View>
      <Text style={lkStyles.muted}>{RULINGS_COPY}</Text>
      {access.isGm && asks !== undefined && asks.length > 0 ? (
        <AskList campaignId={campaignId} asks={asks} onPin={setPinning} />
      ) : null}
      {rulings === undefined ? <Text style={lkStyles.muted}>Loading…</Text> : null}
      {rulings !== undefined && rulings.length === 0 ? <Text style={lkStyles.muted}>{RULINGS_EMPTY}</Text> : null}
      {rulings?.map((ruling) => (
        <View key={ruling._id} style={lkStyles.rulingItem}>
          <Text style={lkStyles.rulingTitle}>{ruling.title}</Text>
          <Text style={lkStyles.muted}>{ruling.text}</Text>
          <Text style={lkStyles.muted}>{ruling.meta}</Text>
          {access.isGm ? (
            <View style={lkStyles.acts}>
              <Button onPress={() => setEditing(ruling)} variant="outline">
                Edit
              </Button>
              <Button onPress={() => setUnpinning(ruling)} variant="outline">
                Unpin
              </Button>
            </View>
          ) : null}
        </View>
      ))}
      {editing ? (
        <RulingDialog campaignId={campaignId} draft={{ title: editing.title, text: editing.text }} mode={{ kind: "edit", ruling: editing }} onClose={() => setEditing(null)} />
      ) : null}
      {pinning ? (
        <RulingDialog
          campaignId={campaignId}
          draft={{
            title: clip(pinning.question, LOREKEEPER_LIMITS.rulingTitle),
            text: clip(pinning.call ?? "", LOREKEEPER_LIMITS.rulingText),
          }}
          mode={{ kind: "ask", ask: pinning }}
          onClose={() => setPinning(null)}
        />
      ) : null}
      {unpinning ? <UnpinDialog campaignId={campaignId} onClose={() => setUnpinning(null)} ruling={unpinning} /> : null}
    </View>
  );
}

function AskList({ campaignId, asks, onPin }: { campaignId: Id<"campaigns">; asks: OpenAsk[]; onPin: (ask: OpenAsk) => void }) {
  const resolve = useMutation(api.lorekeeperAsks.resolve);
  const [error, setError] = useState<string | null>(null);

  return (
    <View>
      <Text style={lkStyles.muted}>Asked of you</Text>
      {asks.map((ask) => (
        <View key={ask._id} style={lkStyles.rulingItem}>
          <Text style={lkStyles.who}>Asked by {ask.characterName ?? ask.askerName}</Text>
          <Text style={lkStyles.muted}>{ask.question || "A rules question"}</Text>
          {ask.call ? <Text style={lkStyles.muted}>Suggested: {ask.call}</Text> : null}
          <View style={lkStyles.acts}>
            <Button onPress={() => onPin(ask)} variant="primary">
              Pin a ruling
            </Button>
            <Button
              onPress={async () => {
                setError(null);
                try {
                  await resolve({ campaignId, askId: ask._id });
                } catch (caught) {
                  setError(errorMessage(caught));
                }
              }}
              variant="outline"
            >
              Dismiss
            </Button>
          </View>
        </View>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={lkStyles.muted}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type DialogMode = { kind: "edit"; ruling: Ruling } | { kind: "ask"; ask: OpenAsk };

function RulingDialog({
  campaignId,
  mode,
  draft,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  mode: DialogMode;
  draft: { title: string; text: string };
  onClose: () => void;
}) {
  const update = useMutation(api.lorekeeperRulings.update);
  const pin = useMutation(api.lorekeeperRulings.pin);
  const resolve = useMutation(api.lorekeeperAsks.resolve);
  const sessions = useQuery(api.sessionWrap.dashboard, mode.kind === "ask" ? { campaignId } : "skip");
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = title.trim().length > 0 && text.trim().length > 0;

  async function save() {
    if (mode.kind === "edit") {
      const changes = {
        ...(title.trim() !== mode.ruling.title ? { title } : {}),
        ...(text.trim() !== mode.ruling.text ? { text } : {}),
      };
      if (Object.keys(changes).length > 0) await update({ campaignId, rulingId: mode.ruling._id, ...changes });
      return;
    }
    const live = sessions?.live?.sessionId;
    const rulingId = await pin({
      campaignId,
      title: title.trim(),
      text: text.trim(),
      fromMessageId: mode.ask.messageId,
      ...(live !== undefined ? { sessionId: live } : {}),
    });
    await resolve({ campaignId, askId: mode.ask._id, rulingId });
  }

  return (
    <Sheet onClose={onClose} open title={mode.kind === "edit" ? "Edit ruling" : "Pin a ruling"}>
      <View style={lkStyles.form}>
        {mode.kind === "ask" ? (
          <Text style={lkStyles.muted}>
            Asked by {mode.ask.characterName ?? mode.ask.askerName}: {mode.ask.question}
          </Text>
        ) : null}
        <TextInput maxLength={LOREKEEPER_LIMITS.rulingTitle} onChangeText={setTitle} style={lkStyles.field} value={title} />
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
          <Button
            disabled={!valid || busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await save();
                onClose();
              } catch (caught) {
                setError(errorMessage(caught));
                setBusy(false);
              }
            }}
          >
            {mode.kind === "edit" ? "Save" : "Pin ruling"}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

function UnpinDialog({ campaignId, ruling, onClose }: { campaignId: Id<"campaigns">; ruling: Ruling; onClose: () => void }) {
  const unpin = useMutation(api.lorekeeperRulings.unpin);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet onClose={onClose} open title="Unpin this ruling?">
      <Text style={lkStyles.muted}>“{ruling.title}” is removed from the table rulings, and the Lorekeeper stops quoting it.</Text>
      {error ? (
        <Text accessibilityRole="alert" style={lkStyles.muted}>
          {error}
        </Text>
      ) : null}
      <View style={lkStyles.acts}>
        <Button onPress={onClose} variant="outline">
          Cancel
        </Button>
        <Button
          onPress={async () => {
            setError(null);
            try {
              await unpin({ campaignId, rulingId: ruling._id });
              onClose();
            } catch (caught) {
              setError(errorMessage(caught));
            }
          }}
          variant="danger"
        >
          Unpin
        </Button>
      </View>
    </Sheet>
  );
}
