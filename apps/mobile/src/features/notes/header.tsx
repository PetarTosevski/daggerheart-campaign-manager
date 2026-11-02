import { Text } from "react-native";

import { journalTitle, subLine } from "../../../../../src/lib/domain/notes";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";
import { useJournal } from "./use-journal";

export function JournalHeading(_props: NotesSlotProps) {
  const view = useJournal();
  if (view === undefined) {
    return (
      <Text accessibilityRole="text" style={notesStyles.muted}>
        Loading the journal…
      </Text>
    );
  }
  const counts = view.journal ?? { pageCount: view.templates.length, entryCount: 0 };
  return (
    <>
      <Text accessibilityRole="header" style={notesStyles.title}>
        {journalTitle(view.whoName)}
      </Text>
      <Text style={notesStyles.sub}>{subLine(view.whoSub, counts)}</Text>
    </>
  );
}
