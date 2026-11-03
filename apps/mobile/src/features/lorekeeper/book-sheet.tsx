import { ScrollView, Text, View } from "react-native";
import { useQuery } from "convex/react";

import { api, type Id } from "../../convex";
import { Sheet } from "../../ui/sheet";
import { lkStyles } from "./styles";

export type BookPage = { bookId: Id<"lorekeeperBooks">; page: number; title: string };

export function BookSheet({
  campaignId,
  page,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  page: BookPage | null;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} open={page !== null} title={page ? `${page.title} · p.${page.page}` : "The book"}>
      {page ? <PageText campaignId={campaignId} page={page} /> : null}
    </Sheet>
  );
}

function PageText({ campaignId, page }: { campaignId: Id<"campaigns">; page: BookPage }) {
  const text = useQuery(api.lorekeeperLibrary.pageText, { campaignId, bookId: page.bookId, page: page.page });
  if (text === undefined) {
    return <Text style={lkStyles.muted}>Loading…</Text>;
  }
  return (
    <ScrollView>
      <View style={{ gap: 12 }}>
        {text.sections.map((section, index) => (
          <View key={`${index}:${section.section}`}>
            <Text style={lkStyles.muted}>{section.section}</Text>
            <Text style={lkStyles.answerInk}>{section.text}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
