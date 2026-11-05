import { useMutation } from "convex/react";
import { useState, type ComponentProps } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { isValidTitle, normalizeTitle, NOTE_LIMITS, pageMeta } from "../../../../../src/lib/domain/notes";
import type { Id } from "../../convex";
import { api } from "../../convex";
import { TearOutButton } from "./bin";
import { Entries, MigrateButton } from "./entries";
import { SharingChip } from "./sharing";
import { SessionPicker } from "./session-picker";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";
import { pageParam, pageRef, selectedPage, useJournal, type OwnPage } from "./use-journal";

export function JournalPage(props: NotesSlotProps) {
  const view = useJournal();
  if (view === undefined) {
    return (
      <View accessibilityLabel="Page" style={notesStyles.paper}>
        <Text accessibilityRole="text" style={notesStyles.line}>
          Loading the page…
        </Text>
      </View>
    );
  }
  const page = selectedPage(view, props.pageId);
  if (page === null) {
    return (
      <View accessibilityLabel="Page" style={notesStyles.paper}>
        <Text style={notesStyles.tape}>Missing page</Text>
        <Text style={notesStyles.line}>This page is not in your journal. Pick one in the index.</Text>
      </View>
    );
  }
  return <PagePaper {...props} page={page} />;
}

function PagePaper({ page, ...props }: NotesSlotProps & { page: OwnPage }) {
  const { campaignId } = props;
  const ref = pageRef(page);
  const rename = useMutation(api.notes.renamePage);
  const cycleTape = useMutation(api.notes.cycleTape);
  const setSession = useMutation(api.notes.setSession);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [now] = useState(() => Date.now());

  function run(promise: Promise<unknown>) {
    setError(null);
    promise.catch((e: unknown) => setError(errorMessage(e)));
  }

  function commitTitle(text: string) {
    setDraft(null);
    if (!isValidTitle(text) || normalizeTitle(text) === page.title) return;
    run(rename({ campaignId, page: ref, title: text }));
  }

  const slot: NotesSlotProps = { ...props, pageId: pageParam(page) };
  const createdAt = "createdAt" in page ? page.createdAt : now;

  return (
    <View accessibilityLabel="Page" style={notesStyles.paper}>
      <Text style={notesStyles.tape}>{page.title}</Text>
      <View style={notesStyles.toolbar}>
        <TextInput
          accessibilityLabel="Page title"
          maxLength={NOTE_LIMITS.TITLE_MAX}
          onBlur={() => commitTitle(draft ?? page.title)}
          onChangeText={setDraft}
          onFocus={() => setDraft(page.title)}
          style={notesStyles.pageTitle}
          value={draft ?? page.title}
        />
        <Text style={notesStyles.meta}>{pageMeta({ kind: page.kind, createdAt }, page.session ?? null)}</Text>
        <Pressable accessibilityRole="button" onPress={() => run(cycleTape({ campaignId, page: ref }))}>
          <Text style={notesStyles.chip}>Tape</Text>
        </Pressable>
        {page.kind === "log" ? (
          <Pressable accessibilityRole="button" onPress={() => setPicking(true)}>
            <Text style={notesStyles.chip}>Session</Text>
          </Pressable>
        ) : null}
        <MigrateButton {...slot} />
        <SharingChip {...slot} />
        <TearOutButton {...slot} />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
      <Entries {...slot} />
      <SessionPicker
        campaignId={campaignId}
        confirmLabel="Link session"
        current={"sessionId" in page ? (page.sessionId ?? null) : null}
        onClose={() => setPicking(false)}
        onPick={async (sessionId: Id<"sessions"> | null) => {
          await setSession({ campaignId, page: ref, sessionId });
        }}
        open={picking}
        title="Link a session"
      />
    </View>
  );
}

export type JournalPageProps = ComponentProps<typeof JournalPage>;
