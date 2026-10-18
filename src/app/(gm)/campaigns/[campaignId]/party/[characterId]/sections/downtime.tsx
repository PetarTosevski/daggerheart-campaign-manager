"use client";

import "./downtime.css";

import { RestPicker } from "@/components/party/rest";
import { SheetBox } from "@/components/party/sheet-ui";

import { useSheet } from "../sheet-context";

// Downtime box of page 1: the rest picker while the GM has a rest open. S10 adds the board's rest reference text.

export function DowntimeBox() {
  const { slot } = useSheet();
  return (
    <SheetBox title="Downtime">
      <RestPicker {...slot} />
      <p className="cs-small m-0 italic">When the GM opens a short or long rest, you choose your downtime moves here.</p>
    </SheetBox>
  );
}
