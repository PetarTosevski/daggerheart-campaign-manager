import { useAction, useMutation, useQuery } from "convex/react";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { errorMessage } from "../../../../../../../src/lib/convex-errors";
import { photoImportMessages } from "../../../../../../../src/lib/errors/photoImport";
import { MAX_PHOTOS, type ImportDraft, type PhotoReadResult } from "../../../../../../../src/lib/import/draft";
import { api } from "../../../../convex";
import type { Id } from "../../../../convex";
import { Button } from "../../../../ui/button";
import { useIntent } from "../../../trackers/intent";
import { wizardStyles as s } from "../styles";
import { ReviewForm, type Owner } from "./review";

type Step =
  | { kind: "pick" }
  | { kind: "reading"; note: string }
  | { kind: "review"; result: PhotoReadResult }
  | { kind: "saved"; characterId: Id<"characters">; name: string };

/** Pick photos, upload, read with Claude, review, then save through `photoImport.create`. */
export function PhotoImportFlow({
  campaignId,
  hopeAndFear,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  hopeAndFear: boolean;
  onClose: () => void;
}) {
  const uploadUrl = useMutation(api.photoImport.uploadUrl);
  const claim = useMutation(api.photoImport.claim);
  const discard = useMutation(api.photoImport.discard);
  const read = useAction(api.photoImport.read);
  const create = useIntent(api.photoImport.create);
  const roster = useQuery(api.members.roster, { campaignId });
  const [uris, setUris] = useState<string[]>([]);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const reading = useRef(false);

  const owners: Owner[] = roster
    ? [{ userId: roster.gm.userId, name: `${roster.gm.name} (GM)` }, ...roster.players.map((p) => ({ userId: p.userId, name: p.name }))]
    : [];

  async function pickPhotos() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images"],
      quality: 0.88,
      selectionLimit: MAX_PHOTOS,
    });
    if (result.canceled) return;
    setUris(result.assets.slice(0, MAX_PHOTOS).map((a) => a.uri));
  }

  async function readPhotos() {
    if (reading.current || uris.length === 0) return;
    reading.current = true;
    setError(null);
    setStep({ kind: "reading", note: "Preparing the photos…" });
    try {
      await discard({ campaignId });
      for (const [i, uri] of uris.entries()) {
        setStep({ kind: "reading", note: `Uploading photo ${i + 1} of ${uris.length}…` });
        const blob = await (await fetch(uri)).blob();
        const url = await uploadUrl({ campaignId });
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
        if (!response.ok) throw new Error("An upload failed. Try again.");
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        const claimed = await claim({ campaignId, storageId });
        if (!claimed.ok) throw new Error(photoImportMessages[claimed.code]);
      }
      setStep({ kind: "reading", note: "Claude is reading the sheet… this can take a minute." });
      setStep({ kind: "review", result: await read({ campaignId }) });
    } catch (e) {
      setError(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
      setStep({ kind: "pick" });
      await discard({ campaignId }).catch(() => undefined);
    } finally {
      reading.current = false;
    }
  }

  async function save(draft: ImportDraft, ownerId: Id<"users">) {
    const result = await create.fire({ campaignId, draft, ownerId });
    if (result) setStep({ kind: "saved", characterId: result.characterId, name: draft.name });
  }

  if (step.kind === "saved") {
    return (
      <View style={{ gap: 12 }}>
        <Text style={s.lead}>{step.name} joined the party.</Text>
        <Button onPress={onClose} variant="primary">
          Close
        </Button>
      </View>
    );
  }

  if (step.kind === "review") {
    return (
      <ReviewForm
        defaultOwner={roster?.gm.userId}
        error={create.error}
        hopeAndFear={hopeAndFear}
        initial={step.result.draft}
        onSave={(draft, ownerId) => void save(draft, ownerId)}
        owners={owners}
        saving={create.pending}
        unmatched={step.result.unmatched}
        unreadable={step.result.unreadable}
      />
    );
  }

  const busy = step.kind === "reading";
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.lead}>
        Take up to {MAX_PHOTOS} clear photos of a filled-in character sheet. Claude reads them into a draft you check before anything is saved.
      </Text>
      <Button disabled={busy} onPress={() => void pickPhotos()} variant="outline">
        Choose photos
      </Button>
      {uris.length > 0 ? (
        <Text style={s.hint}>
          {uris.length} photo{uris.length === 1 ? "" : "s"} selected
        </Text>
      ) : null}
      {busy ? (
        <Text accessibilityRole="progressbar" style={s.hint}>
          {step.note}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button disabled={busy || uris.length === 0} onPress={() => void readPhotos()} variant="primary">
          Read photos
        </Button>
        <Button disabled={busy} onPress={onClose} variant="outline">
          Cancel
        </Button>
      </View>
    </View>
  );
}
