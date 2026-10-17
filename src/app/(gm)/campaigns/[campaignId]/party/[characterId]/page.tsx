import "./sheet.css";

import { CharacterExtras } from "@/components/party/extras/character-extras";

import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { CharacterSheetView } from "./sheet";

export default async function CharacterSheetPage({ params }: { params: Promise<{ campaignId: string; characterId: string }> }) {
  const { campaignId, characterId } = await params;
  return (
    <CharacterSheetView
      characterId={characterId}
      extras={
        <CharacterExtras
          campaign={{ _id: campaignId as Id<"campaigns"> }}
          character={{ _id: characterId as Id<"characters"> }}
        />
      }
    />
  );
}
