import { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { MAX_PACK_NAME, MAX_PACK_SPRITES, MAX_SPRITE_NAME } from "../../../../../convex/lib/validators/spritePacks";
import type { PackRow, PackSpriteRow, SpritePatch } from "../../../../../convex/spritePacks";
import type { Id } from "../../convex";
import { WriteButton } from "../../shell/offline";
import { Button } from "../../ui/button";
import { BlurName } from "./blur-name";
import { SpriteFields } from "./fields";
import { SettingSelect } from "./setting-select";
import { styles } from "./styles";
import { Uploader } from "./uploader";
import { useConfirm } from "./use-confirm";
import { usePackMutations } from "./use-packs";

export function PackCard({ campaignId, pack }: { campaignId: Id<"campaigns">; pack: PackRow }) {
  const mutations = usePackMutations(campaignId);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(pack.sprites.length === 0);
  const run = (work: Promise<unknown> | unknown) => {
    setError(null);
    void Promise.resolve(work).catch((e: unknown) => setError(errorMessage(e)));
  };
  const remove = useConfirm(() => run(mutations.deletePack({ campaignId, packId: pack._id })));

  return (
    <View accessibilityLabel={`Pack ${pack.name}`} style={styles.section}>
      <View style={[styles.row, styles.between]}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {pack.name}
        </Text>
        <Text style={styles.muted}>
          {pack.sprites.length} / {MAX_PACK_SPRITES} sprites
        </Text>
      </View>
      <BlurName
        label="Pack name"
        maxLength={MAX_PACK_NAME}
        onCommit={(name) => run(mutations.renamePack({ campaignId, packId: pack._id, name }))}
        value={pack.name}
      />
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Setting</Text>
        <SettingSelect
          onChange={(ext) => run(mutations.setPackExtends({ campaignId, packId: pack._id, extends: ext }))}
          value={pack.extends?.id ?? null}
        />
      </View>
      <WriteButton onPress={remove.click} variant="danger">
        {remove.asking ? "Confirm delete" : "Delete pack"}
      </WriteButton>
      {remove.asking ? (
        <Text accessibilityRole="status" style={styles.muted}>
          Deletes the pack and its {pack.sprites.length} sprites. Map objects that use them go back to their Classic look.
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.err}>
          {error}
        </Text>
      ) : null}
      <Button onPress={() => setAdding(!adding)} variant="outline">
        {adding ? "Hide upload" : "Add sprites"}
      </Button>
      {adding ? <Uploader campaignId={campaignId} pack={pack} /> : null}
      {pack.sprites.length > 0 ? (
        <View accessibilityLabel={`Sprites in ${pack.name}`} style={styles.spriteList}>
          {pack.sprites.map((sprite, i) => (
            <SpriteRow
              key={sprite._id}
              campaignId={campaignId}
              first={i === 0}
              last={i === pack.sprites.length - 1}
              mutations={mutations}
              onError={setError}
              sprite={sprite}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SpriteRow({
  campaignId,
  sprite,
  first,
  last,
  mutations,
  onError,
}: {
  campaignId: Id<"campaigns">;
  sprite: PackSpriteRow;
  first: boolean;
  last: boolean;
  mutations: ReturnType<typeof usePackMutations>;
  onError: (message: string | null) => void;
}) {
  const run = (work: Promise<unknown> | unknown) => {
    onError(null);
    void Promise.resolve(work).catch((e: unknown) => onError(errorMessage(e)));
  };
  const save = (patch: SpritePatch) => run(mutations.updateSprite({ campaignId, spriteId: sprite._id, patch }));
  const remove = useConfirm(() => run(mutations.removeSprite({ campaignId, spriteId: sprite._id })));

  return (
    <View accessibilityLabel={sprite.name} style={styles.spriteCard}>
      <View style={styles.row}>
        {sprite.url ? (
          <Image accessibilityLabel={sprite.name} contentFit="contain" source={{ uri: sprite.url }} style={styles.thumb} />
        ) : (
          <View style={styles.thumb} />
        )}
        <BlurName
          label="Name"
          maxLength={MAX_SPRITE_NAME}
          onCommit={(name) => save({ name })}
          value={sprite.name}
        />
      </View>
      <SpriteFields
        onChange={save}
        values={{
          category: sprite.category,
          w: sprite.w,
          h: sprite.h,
          sight: sprite.sight,
          light: sprite.light,
          height: sprite.height,
          classicKind: sprite.classicKind,
          terrain: sprite.terrain,
        }}
      />
      <View style={styles.row}>
        <Button
          accessibilityLabel={`Move ${sprite.name} up`}
          disabled={first}
          onPress={() => run(mutations.reorderSprite({ campaignId, spriteId: sprite._id, direction: "up" }))}
          variant="outline"
        >
          Up
        </Button>
        <Button
          accessibilityLabel={`Move ${sprite.name} down`}
          disabled={last}
          onPress={() => run(mutations.reorderSprite({ campaignId, spriteId: sprite._id, direction: "down" }))}
          variant="outline"
        >
          Down
        </Button>
        <WriteButton onPress={remove.click} variant="danger">
          {remove.asking ? "Confirm delete" : "Delete"}
        </WriteButton>
      </View>
    </View>
  );
}
