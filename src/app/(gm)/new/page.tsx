import { Suspense } from "react";

import { FrameSelect } from "./frame-select";

export default function NewCampaignPage() {
  return (
    <Suspense>
      <FrameSelect />
    </Suspense>
  );
}
