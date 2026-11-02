import { Text, View } from "react-native";

import { type Tome, type TomeChapterId } from "../../../../../src/lib/frames/tomes";

import { tomeStyles as styles } from "./styles";

export function PublishedChapterBody({ tome, chapter }: { tome: Tome; chapter: TomeChapterId }) {
  if (chapter === "mechanics") {
    return (
      <View style={{ gap: 12 }}>
        {tome.mechanics.rules.map((rule) => (
          <View key={rule.n} style={styles.ruleCard}>
            <Text style={styles.ruleNumber}>{rule.n}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.ruleHead}>{rule.head}</Text>
              <Text style={styles.body}>{rule.text}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (chapter === "incident") {
    const { incident } = tome;
    return (
      <View style={{ gap: 12 }}>
        {incident.figures.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.kicker}>Key figures</Text>
            {incident.figures.map((figure) => (
              <View key={figure.name} style={styles.figureCard}>
                <Text style={styles.figureName}>{figure.name}</Text>
                <Text style={styles.figureRole}>{figure.role}</Text>
                {figure.line ? <Text style={styles.body}>{figure.line}</Text> : null}
              </View>
            ))}
            {incident.start ? <Text style={styles.body}>Start: {incident.start}</Text> : null}
          </View>
        ) : null}
        {incident.paragraphs.map((paragraph) => (
          <Text key={paragraph.slice(0, 32)} style={styles.body}>
            {paragraph}
          </Text>
        ))}
      </View>
    );
  }
  const { overview } = tome;
  return (
    <View style={{ gap: 12 }}>
      {overview.paragraphs.map((paragraph) => (
        <Text key={paragraph.slice(0, 32)} style={styles.body}>
          {paragraph}
        </Text>
      ))}
      {overview.quote ? (
        <Text style={[styles.body, { fontFamily: styles.bookTitle.fontFamily, fontSize: 20 }]}>{overview.quote.text}</Text>
      ) : null}
    </View>
  );
}
