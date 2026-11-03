import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import {
  ABOUT_BOOKS_LABEL,
  ABOUT_BOOKS_NOTE,
  ABOUT_BOOKS_TITLE,
  BOOK_INDEXED,
  BOOK_OFF,
  LIBRARY_COPY,
  LIBRARY_EMPTY,
  LIBRARY_TITLE,
  booksIndexedLabel,
} from "../../../../../src/lib/lorekeeper/copy";
import type { LibraryBook } from "../../../../../convex/lorekeeperLibrary";

import { api } from "../../convex";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import type { LorekeeperSideProps } from "./slots";
import { lkStyles } from "./styles";

export function IndexPill({ campaignId }: LorekeeperSideProps) {
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  if (library === undefined) return null;
  return <Text style={[lkStyles.pill, lkStyles.pillOk]}>{booksIndexedLabel(library.indexedCount)}</Text>;
}

export function LibraryCard({ campaignId, access }: LorekeeperSideProps) {
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  const setEnabled = useMutation(api.lorekeeperLibrary.setEnabled);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(book: LibraryBook) {
    setError(null);
    try {
      await setEnabled({ campaignId, bookId: book.bookId, enabled: !book.enabled });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <View accessibilityLabel={LIBRARY_TITLE} style={lkStyles.card}>
      <View style={lkStyles.cardHead}>
        <Text style={lkStyles.cardTitle}>{LIBRARY_TITLE}</Text>
        {access.isGm ? (
          <Button onPress={() => setAboutOpen(true)} variant="outline">
            {ABOUT_BOOKS_LABEL}
          </Button>
        ) : null}
      </View>
      <Text style={lkStyles.muted}>{LIBRARY_COPY}</Text>
      {library === undefined ? <Text style={lkStyles.muted}>Loading…</Text> : null}
      {library !== undefined && library.books.length === 0 ? <Text style={lkStyles.muted}>{LIBRARY_EMPTY}.</Text> : null}
      {library?.books.map((book) => {
        const state = book.enabled ? BOOK_INDEXED : BOOK_OFF;
        const pill = book.enabled ? lkStyles.pillOk : lkStyles.pillRed;
        return (
          <View key={book.bookId} style={lkStyles.bookRow}>
            <View style={lkStyles.bookSpine} />
            <View style={{ flex: 1 }}>
              <Text style={lkStyles.cardTitle}>{book.title}</Text>
              <Text style={lkStyles.muted}>{book.subtitle}</Text>
            </View>
            {access.isGm ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: book.enabled }}
                onPress={() => void toggle(book)}
              >
                <Text style={[lkStyles.pill, pill]}>{state}</Text>
              </Pressable>
            ) : (
              <Text style={[lkStyles.pill, pill]}>{state}</Text>
            )}
          </View>
        );
      })}
      {error ? (
        <Text accessibilityRole="alert" style={lkStyles.muted}>
          {error}
        </Text>
      ) : null}
      <Sheet onClose={() => setAboutOpen(false)} open={aboutOpen} title={ABOUT_BOOKS_TITLE}>
        <Text style={lkStyles.muted}>{ABOUT_BOOKS_NOTE}</Text>
        <Button onPress={() => setAboutOpen(false)}>Got it</Button>
      </Sheet>
    </View>
  );
}
