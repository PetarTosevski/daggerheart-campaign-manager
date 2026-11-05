import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../convex";
import type { Id } from "../../../../convex";
import { Button } from "../../../../ui/button";
import { Sheet } from "../../../../ui/sheet";
import { PhotoImportFlow } from "./flow";

/** GM-only photo import entry. Returns null for players so nothing subscribes to `photoImport`. */
export function PhotoImportButton({
  campaignId,
  hopeAndFear,
  isGm,
}: {
  campaignId: Id<"campaigns">;
  hopeAndFear: boolean;
  isGm: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!isGm) return null;
  return (
    <PhotoImportGate
      campaignId={campaignId}
      hopeAndFear={hopeAndFear}
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      open={open}
    />
  );
}

function PhotoImportGate({
  campaignId,
  hopeAndFear,
  open,
  onOpen,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  hopeAndFear: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const available = useQuery(api.photoImport.available, { campaignId });
  if (available !== true) return null;
  return (
    <>
      <Button onPress={onOpen} variant="pill">
        Import from photo
      </Button>
      <Sheet onClose={onClose} open={open} title="Import from photo">
        <PhotoImportFlow campaignId={campaignId} hopeAndFear={hopeAndFear} onClose={onClose} />
      </Sheet>
    </>
  );
}
