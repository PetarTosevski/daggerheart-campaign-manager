import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import {
  BRUSHES,
  PAINT_TERRAINS,
  PLACEABLE_KINDS,
  PLACEABLE_OBJECTS,
  sameRef,
} from "../../../../../../src/components/combat-map/editor/edit-model";
import { errorMessage } from "../../../../../../src/lib/convex-errors";

import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { Button } from "../../../ui/button";
import type { CombatSlotProps } from "../contract";
import { useEditActions } from "./edit-actions";
import { CombatEditMap } from "./edit-map";
import { EditorStateProvider, toolFor, useEditor, type EditTool } from "./editor-state";
import { CombatObjectPanel } from "./object-panel";
import { editStyles } from "./styles";
import { useSpriteEditing } from "./use-sprite-editing";

const TOOLS: readonly { tool: EditTool; label: string; painted: boolean }[] = [
  { tool: "pan", label: "Move view", painted: false },
  { tool: "terrain", label: "Terrain", painted: true },
  { tool: "object", label: "Objects", painted: true },
  { tool: "block", label: "Block sight", painted: false },
  { tool: "eraseTerrain", label: "Erase terrain", painted: true },
  { tool: "eraseBlock", label: "Clear sight", painted: false },
];

const SIZES = [
  { key: "small" as const, label: "Small" },
  { key: "medium" as const, label: "Medium" },
  { key: "large" as const, label: "Large" },
];

function EditToolsBody({ campaignId, layout }: { campaignId: Id<"campaigns">; layout: CombatSlotProps["layout"] }) {
  const editor = useEditor();
  const sprites = useSpriteEditing(campaignId, layout);
  const edits = useEditActions(campaignId, layout, editor.setError);
  const settings = useQuery(api.combatMapStyle.settings, { campaignId });

  const isImage = layout.source === "image";
  const tools = TOOLS.filter((t) => !isImage || !t.painted);
  const tool = toolFor(editor.tool, isImage);
  const selected = layout.objects.find((o) => o._id === editor.selectedObjectId) ?? null;
  const style = layout.style ?? "classic";

  const [prompt, setPrompt] = useState(layout.prompt ?? "");
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  const settingOptions = useMemo(() => {
    const builtin = [...(settings?.builtin ?? [])].sort((a, b) => a.label.localeCompare(b.label));
    const packs = settings?.packs ?? [];
    return { builtin, packs };
  }, [settings]);

  async function runGenerate(another: boolean) {
    const desc = prompt.trim();
    if (!desc) {
      setGenMessage("Describe the scene first.");
      return;
    }
    setGenBusy(true);
    setGenMessage(null);
    try {
      const result = await edits.generate({ prompt: desc, size, ...(another ? { another: true } : {}) });
      setGenMessage(result.saved ? "Layout updated on the server." : "The map changed while generating; try again.");
    } catch (e) {
      setGenMessage(errorMessage(e));
    } finally {
      setGenBusy(false);
    }
  }

  const gmView = { state: "noCharacter" as const, mapId: layout._id as Id<"combatMaps"> };

  return (
    <ScrollView contentContainerStyle={editStyles.stack} testID="combat-edit-tools">
      <View style={editStyles.panel}>
        <Text accessibilityRole="header" style={editStyles.title}>
          Edit by hand
        </Text>
        <Text style={editStyles.hint}>Paint terrain, place objects, and edit sight on the map below.</Text>
        <View accessibilityRole="toolbar" style={editStyles.row}>
          {tools.map((t) => (
            <Button
              key={t.tool}
              onPress={() => editor.setTool(t.tool)}
              variant={tool === t.tool ? "solid" : "outline"}
            >
              {t.label}
            </Button>
          ))}
        </View>
        {tool === "terrain" && !sprites.active ? (
          <View testID="combat-edit-terrain">
            <Text style={editStyles.label}>Terrain</Text>
            <View style={editStyles.row}>
              {PAINT_TERRAINS.map(({ terrain }) => (
                <Button
                  key={terrain}
                  onPress={() => editor.setTerrain(terrain)}
                  variant={editor.terrain === terrain && editor.texture === null ? "solid" : "outline"}
                >
                  {terrain}
                </Button>
              ))}
            </View>
          </View>
        ) : null}
        {tool === "terrain" && sprites.active ? (
          <View testID="combat-edit-terrain">
            <Text style={editStyles.label}>Textures</Text>
            <View style={editStyles.row}>
              {sprites.palette.textures.slice(0, 8).map((item) => (
                <Button
                  key={item.key}
                  onPress={() => editor.setTexture(item.ref)}
                  variant={editor.texture !== null && sameRef(editor.texture, item.ref) ? "solid" : "outline"}
                >
                  {item.name}
                </Button>
              ))}
            </View>
          </View>
        ) : null}
        {(tool === "terrain" || tool === "block" || tool === "eraseTerrain" || tool === "eraseBlock") && !isImage ? (
          <View style={editStyles.row}>
            <Text style={editStyles.label}>Brush</Text>
            {BRUSHES.map((n) => (
              <Button key={n} onPress={() => editor.setBrush(n)} variant={editor.brush === n ? "solid" : "outline"}>
                {String(n)}
              </Button>
            ))}
            {tool === "terrain" ? (
              <Button onPress={() => edits.clearPaint("terrain")} variant="outline">
                Undo all painting
              </Button>
            ) : null}
          </View>
        ) : null}
        {tool === "object" && !sprites.active ? (
          <View style={editStyles.row} testID="combat-edit-palette">
            {PLACEABLE_KINDS.map((kind) => (
              <Button
                key={kind}
                onPress={() => editor.setKind(kind)}
                variant={editor.kind === kind ? "solid" : "outline"}
              >
                {PLACEABLE_OBJECTS[kind].label}
              </Button>
            ))}
          </View>
        ) : null}
        {tool === "object" && sprites.active ? (
          <View style={editStyles.row} testID="combat-edit-palette">
            {sprites.palette.objects.slice(0, 12).map((item) => (
              <Button
                key={item.key}
                onPress={() => editor.setSprite(item.ref)}
                variant={editor.sprite !== null && sameRef(editor.sprite, item.ref) ? "solid" : "outline"}
              >
                {item.name}
              </Button>
            ))}
          </View>
        ) : null}
        {editor.error ? (
          <Text accessibilityLiveRegion="polite" style={editStyles.error}>
            {editor.error}
          </Text>
        ) : null}
      </View>

      {!isImage ? (
        <View style={editStyles.panel}>
          <Text style={editStyles.title}>Map style</Text>
          <View style={editStyles.row}>
            <Button onPress={() => edits.setStyle("classic")} variant={style === "classic" ? "solid" : "outline"}>
              Classic
            </Button>
            <Button onPress={() => edits.setStyle("sprites")} variant={style === "sprites" ? "solid" : "outline"}>
              Sprites
            </Button>
          </View>
          <Text style={editStyles.label}>Setting</Text>
          <View style={editStyles.row}>
            <Button onPress={() => edits.setSetting(null)} variant="outline">
              Let Claude choose
            </Button>
            {settingOptions.builtin.map((s) => (
              <Button key={s.id} onPress={() => edits.setSetting({ builtin: s.id })} variant="outline">
                {s.label}
              </Button>
            ))}
          </View>
        </View>
      ) : null}

      {!isImage ? (
        <View style={editStyles.panel}>
          <Text style={editStyles.title}>Scene</Text>
          <TextInput
            accessibilityLabel="Describe the battlefield"
            multiline
            onChangeText={setPrompt}
            placeholder="Describe where the fight happens…"
            style={editStyles.prompt}
            value={prompt}
          />
          <View style={editStyles.row}>
            {SIZES.map((s) => (
              <Button key={s.key} onPress={() => setSize(s.key)} variant={size === s.key ? "solid" : "outline"}>
                {s.label}
              </Button>
            ))}
          </View>
          <View style={editStyles.row}>
            <Button disabled={genBusy} onPress={() => void runGenerate(false)} variant="solid">
              Generate map
            </Button>
            {layout.source === "generated" ? (
              <Button disabled={genBusy} onPress={() => void runGenerate(true)} variant="outline">
                Another version
              </Button>
            ) : null}
            {genBusy ? (
              <Button onPress={() => edits.stopGenerate()} variant="outline">
                Stop
              </Button>
            ) : null}
          </View>
          {genMessage ? <Text style={editStyles.hint}>{genMessage}</Text> : null}
        </View>
      ) : null}

      {selected ? <CombatObjectPanel edits={edits} object={selected} onDone={() => editor.selectObject(null)} sprites={sprites} /> : null}

      <CombatEditMap edits={edits} layout={layout} sprites={sprites} view={gmView} />
    </ScrollView>
  );
}

export function CombatEditTools(props: CombatSlotProps) {
  return (
    <EditorStateProvider>
      <EditToolsBody campaignId={props.campaignId as Id<"campaigns">} layout={props.layout} />
    </EditorStateProvider>
  );
}
