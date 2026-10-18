"use client";

import "./frame-extras.css";

import { FrameExtras } from "@/components/party/extras/character-extras";

import { useSheet } from "../sheet-context";

// Frame extras region of page 1 (Motherboard, Beast Feast, Castle High); empty in other frames. Restyled by S7.

export function FrameExtrasRegion() {
  const { slot } = useSheet();
  return <FrameExtras {...slot} />;
}
