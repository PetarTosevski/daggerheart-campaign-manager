import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { allowedVisibilities, visibilityLabel, type Visibility } from "../../../../../src/lib/domain/notes";
import type { PageRef } from "../../../../../convex/lib/validators/notes";
import type { RecipientRow } from "../../../../../convex/notesSharing";
import { api, type Id } from "../../convex";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";
import { pageRef, selectedPage, useJournal } from "./use-journal";

const PLAYER_HINT: Record<Visibility, string> = {
  gm: "Only you and the GM.",
  private: "Only you. Stays private even if your character leaves the story.",
  players: "The other players. The GM can't read it.",
  everyone: "The GM and every player.",
  chosen: "Only the people you tick below. The GM reads it only if ticked.",
};

const GM_HINT: Partial<Record<Visibility, string>> = {
  private: "Only you.",
  everyone: "Every player, under 'Shared by GM'.",
  chosen: "Only the players you tick below.",
};

export function chipText(visibility: Visibility, isGm: boolean, recipients: readonly RecipientRow[] | undefined): string {
  const label = visibilityLabel(visibility, isGm);
  if (visibility !== "chosen" || recipients === undefined) return label;
  const names = recipients.filter((r) => r.chosen).map((r) => r.name);
  return `${label} · ${names.length > 0 ? names.join(", ") : "nobody yet"}`;
}

export function SharingChip({ campaignId, pageId, access }: NotesSlotProps) {
  const view = useJournal();
  const page = view === undefined ? null : selectedPage(view, pageId);
  const [open, setOpen] = useState(false);
  const ref = page === null ? null : pageRef(page);
  const chosen = page?.visibility === "chosen";
  const recipients = useQuery(
    api.notesSharing.recipients,
    ref !== null && (chosen || open) ? { campaignId, page: ref } : "skip",
  );
  if (page === null || ref === null) return null;
  const text = chipText(page.visibility, access.isGm, recipients);
  return (
    <>
      <Pressable accessibilityLabel={`Sharing: ${text}`} accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text style={notesStyles.chip}>{text}</Text>
      </Pressable>
      <SharingDialog
        campaignId={campaignId}
        isGm={access.isGm}
        onClose={() => setOpen(false)}
        open={open}
        page={ref}
        recipients={recipients}
        visibility={page.visibility}
      />
    </>
  );
}

function SharingDialog({
  open,
  onClose,
  campaignId,
  page,
  visibility,
  isGm,
  recipients,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: Id<"campaigns">;
  page: PageRef;
  visibility: Visibility;
  isGm: boolean;
  recipients: RecipientRow[] | undefined;
}) {
  const setVisibility = useMutation(api.notesSharing.setVisibility);
  const addRecipient = useMutation(api.notesSharing.addRecipient);
  const removeRecipient = useMutation(api.notesSharing.removeRecipient);
  const [error, setError] = useState<string | null>(null);

  function run(promise: Promise<unknown>) {
    setError(null);
    promise.catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <Sheet onClose={onClose} open={open} title="Share this page">
      <ScrollView style={{ gap: 12, maxHeight: 420 }}>
        <Text style={notesStyles.label}>Who can read this page</Text>
        {allowedVisibilities(isGm).map((value) => (
          <Pressable accessibilityRole="radio" key={value} onPress={() => run(setVisibility({ campaignId, page, visibility: value }))}>
            <Text style={notesStyles.line}>
              {value === visibility ? "● " : "○ "}
              {visibilityLabel(value, isGm)}
            </Text>
            <Text style={notesStyles.muted}>{(isGm ? GM_HINT[value] : undefined) ?? PLAYER_HINT[value]}</Text>
          </Pressable>
        ))}
        {visibility === "chosen" ? (
          <View style={{ gap: 8 }}>
            <Text style={notesStyles.label}>Chosen players</Text>
            {recipients === undefined ? (
              <Text style={notesStyles.muted}>Loading the players…</Text>
            ) : recipients.length === 0 ? (
              <Text style={notesStyles.muted}>Nobody else is in this campaign yet.</Text>
            ) : (
              recipients.map((r) => (
                <Pressable
                  accessibilityRole="checkbox"
                  key={r.userId}
                  onPress={() =>
                    run(
                      r.chosen
                        ? removeRecipient({ campaignId, page, userId: r.userId })
                        : addRecipient({ campaignId, page, userId: r.userId }),
                    )
                  }
                >
                  <Text style={notesStyles.line}>
                    {r.chosen ? "☑ " : "☐ "}
                    {r.name}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={notesStyles.error}>
            {error}
          </Text>
        ) : null}
        <Button onPress={onClose} variant="outline">
          Done
        </Button>
      </ScrollView>
    </Sheet>
  );
}
