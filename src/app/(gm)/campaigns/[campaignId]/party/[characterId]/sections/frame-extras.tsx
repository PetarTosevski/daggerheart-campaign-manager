"use client";

import "./frame-extras.css";

import { FrameExtras } from "@/components/party/extras/character-extras";

import { useSheet } from "../sheet-context";

// Frame extras region of page 1 (Motherboard, Beast Feast, Castle High): one paper sh-box per extra (S7); empty in other frames.

export function FrameExtrasRegion() {
  const { slot } = useSheet();
  return <FrameExtras {...slot} />;
}
