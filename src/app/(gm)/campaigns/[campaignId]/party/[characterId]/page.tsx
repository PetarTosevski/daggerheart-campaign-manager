import "./sheet.css";

import { CharacterSheetView } from "./sheet";

export default async function CharacterSheetPage({ params }: { params: Promise<{ campaignId: string; characterId: string }> }) {
  const { characterId } = await params;
  return <CharacterSheetView characterId={characterId} />;
}
