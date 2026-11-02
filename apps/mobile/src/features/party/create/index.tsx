import { Empty } from "../../../ui/empty";

/**
 * Stub. The character-creation tracer replaces this folder.
 * It does not call `characters.create`.
 */
export function CreateCharacterSlot({ campaignId }: { campaignId: string }) {
  return (
    <Empty message={`Not built yet. Campaign ${campaignId}.`} title="Create character" />
  );
}
