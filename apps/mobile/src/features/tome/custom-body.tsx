import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { CUSTOM_CHAPTERS, TOME_CHAPTERS, type TomeChapterId } from "../../../../../src/lib/frames/tomes";
import { useWritesEnabled } from "../../shell/offline";

import { tomeStyles as styles } from "./styles";

type CustomText = { overview: string; incident: string; mechanics: string };

export function CustomChapterBody({
  chapter,
  text,
  setup,
  onSave,
}: {
  chapter: TomeChapterId;
  text: CustomText;
  setup: { label: string; value: string }[];
  onSave?: (chapter: TomeChapterId, value: string) => Promise<unknown>;
}) {
  const saved = text[chapter];
  const canWrite = useWritesEnabled();
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingText = useRef<string | null>(null);
  const inFlight = useRef(0);
  const latestRequest = useRef(0);
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pendingText.current;
    const save = saveRef.current;
    if (next === null || !save) return;
    pendingText.current = null;
    const request = ++latestRequest.current;
    inFlight.current += 1;
    Promise.resolve(save(chapter, next))
      .then(() => {
        if (request === latestRequest.current) setStatus("saved");
      })
      .catch(() => {
        if (request === latestRequest.current) setStatus("error");
      })
      .finally(() => {
        inFlight.current -= 1;
      });
  };

  useEffect(() => {
    if (pendingText.current === null && inFlight.current === 0) {
      setDraft(saved);
    }
  }, [saved]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- flush reads refs only
  useEffect(() => () => flush(), []);

  const meta = CUSTOM_CHAPTERS[chapter];
  const chapterTitle = TOME_CHAPTERS.find((row) => row.id === chapter)?.title ?? chapter;

  if (!onSave) {
    return saved.trim() ? (
      <Text style={styles.body}>{saved}</Text>
    ) : (
      <Text style={styles.note}>Your GM hasn’t written this chapter yet.</Text>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.gmNote}>{meta.must}</Text>
      {chapter === "overview" && setup.length > 0 ? (
        <View style={styles.setupBlock}>
          <Text style={styles.setupHeading}>From your frame setup</Text>
          {setup.map((row) => (
            <Text key={row.label} style={styles.setupRow}>
              <Text style={{ fontWeight: "600" }}>{row.label}: </Text>
              {row.value}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.kicker}>Your {chapterTitle.replace(/^The /, "")}</Text>
      <TextInput
        accessibilityLabel={`Edit ${chapterTitle}`}
        editable={canWrite}
        multiline
        onBlur={flush}
        onChangeText={(value) => {
          setDraft(value);
          setStatus("saving");
          pendingText.current = value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 600);
        }}
        placeholder={meta.placeholder}
        placeholderTextColor="#8a7350"
        style={styles.editor}
        value={draft}
      />
      <Text accessibilityLiveRegion="polite" style={styles.saveStatus}>
        {status === "saving"
          ? "Saving…"
          : status === "saved"
            ? "Saved."
            : status === "error"
              ? "Couldn’t save. Check your connection; your text is still here."
              : "Your text saves automatically as you type."}
      </Text>
    </View>
  );
}
