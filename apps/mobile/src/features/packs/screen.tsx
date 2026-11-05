import { useQuery } from "convex/react";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { MAX_PACK_NAME, MAX_SPRITE_PACKS } from "../../../../../convex/lib/validators/spritePacks";
import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { Loading } from "../../ui/loading";
import { Button } from "../../ui/button";
import { cleanName } from "./labels";
import { PackCard } from "./pack-card";
import { SettingSelect } from "./setting-select";
import { styles } from "./styles";
import { useIntent } from "./intent";

export function PacksBody() {
  const campaign = useCampaign();
  const packs = useQuery(api.spritePacks.packs, { campaignId: campaign._id });

  if (packs === undefined) {
    return <Loading label="Loading sprite packs" />;
  }

  return (
    <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        Sprite packs
      </Text>
      <NewPack campaignId={campaign._id} full={packs.length >= MAX_SPRITE_PACKS} />
      {packs.length === 0 ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Your packs
          </Text>
          <Text style={styles.muted}>
            No packs yet. The built-in packs are always available; make a pack to add your own sprite sheets or single sprites.
          </Text>
        </View>
      ) : (
        packs.map((pack) => <PackCard key={pack._id} campaignId={campaign._id} pack={pack} />)
      )}
    </ScrollView>
  );
}

function NewPack({ campaignId, full }: { campaignId: ReturnType<typeof useCampaign>["_id"]; full: boolean }) {
  const [name, setName] = useState("");
  const [ext, setExt] = useState<string | null>(null);
  const create = useIntent(api.spritePacks.createPack);
  const clean = cleanName(name, MAX_PACK_NAME);

  async function submit() {
    if (clean === null) return;
    const result = await create.fire({ campaignId, name: clean, ...(ext === null ? {} : { extends: ext }) });
    if (result) {
      setName("");
      setExt(null);
    }
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        New pack
      </Text>
      <Text style={styles.label}>Pack name</Text>
      <TextInput
        accessibilityLabel="Pack name"
        maxLength={MAX_PACK_NAME}
        onChangeText={setName}
        placeholder="Moorland ruins"
        style={styles.input}
        value={name}
      />
      <Text style={styles.label}>Setting</Text>
      <SettingSelect onChange={setExt} value={ext} />
      <Button disabled={clean === null || create.pending || full} onPress={() => void submit()} variant="primary">
        {create.pending ? "Creating…" : "Create pack"}
      </Button>
      {full ? (
        <Text style={styles.muted}>
          This campaign has {MAX_SPRITE_PACKS} packs, the most it can hold. Delete one to make another.
        </Text>
      ) : null}
      {create.error ? (
        <Text accessibilityRole="alert" style={styles.err}>
          {create.error}
        </Text>
      ) : null}
    </View>
  );
}
