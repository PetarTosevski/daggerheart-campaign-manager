import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { attackLabel, experienceLabel, textBlocks, thresholdsLabel, typeLabel } from "../../../../../src/lib/adversaries/catalogue";

import { advStyles } from "./styles";
import type { StatBlockData } from "./types";

const KIND_LABEL: Record<string, string> = { passive: "Passive", action: "Action", reaction: "Reaction", evolution: "Evolution" };

export function FeatureText({ text }: { text: string }) {
  return (
    <>
      {textBlocks(text).map((block, i) =>
        block.kind === "p" ? (
          <Text key={i} style={advStyles.body}>
            {block.text}
          </Text>
        ) : (
          <View key={i}>
            {block.items.map((item, j) => (
              <Text key={j} style={advStyles.body}>
                • {item}
              </Text>
            ))}
          </View>
        ),
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Text style={advStyles.stat}>
      <Text style={advStyles.statStrong}>{label}: </Text>
      {value}
    </Text>
  );
}

/** An adversary stat block as the book prints it; `actions` sit under the head. */
export function StatBlock({ block, actions, subtitle }: { block: StatBlockData; actions?: ReactNode; subtitle?: string }) {
  const experiences = experienceLabel(block.experiences);
  return (
    <View accessibilityLabel={`${block.name} stat block`} style={advStyles.paper}>
      <Text accessibilityRole="header" style={advStyles.h2}>
        {block.name}
      </Text>
      <Text style={advStyles.label}>
        Tier {block.tier} {typeLabel(block)}
        {subtitle ? ` · ${subtitle}` : ""}
      </Text>
      {actions ? <View style={advStyles.row}>{actions}</View> : null}
      {block.description ? <Text style={advStyles.serifItalic}>{block.description}</Text> : null}
      {block.motives ? <Stat label="Motives & Tactics" value={block.motives} /> : null}
      <View style={advStyles.row}>
        <Stat label="Difficulty" value={String(block.difficulty)} />
        <Stat label="Thresholds" value={thresholdsLabel(block.thresholds)} />
        <Stat label="HP" value={String(block.hp)} />
        <Stat label="Stress" value={block.stress === null ? "None" : String(block.stress)} />
      </View>
      <Stat
        label="ATK"
        value={`${attackLabel(block.attack.modifier)} · ${block.attack.name}: ${block.attack.range} · ${block.attack.damage}`}
      />
      {experiences ? <Stat label="Experience" value={experiences} /> : null}
      {block.features.length > 0 ? <Text style={advStyles.label}>Features</Text> : null}
      {block.features.map((feature, i) => (
        <View key={`${feature.name}-${i}`} style={advStyles.section}>
          <Text style={advStyles.h3}>
            {feature.name} - {KIND_LABEL[feature.kind] ?? feature.kind}
          </Text>
          <FeatureText text={feature.text} />
        </View>
      ))}
    </View>
  );
}
