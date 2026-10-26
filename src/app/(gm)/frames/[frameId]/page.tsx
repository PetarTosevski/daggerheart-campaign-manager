import { notFound } from "next/navigation";

import { getPublishedFrame } from "@/lib/frames";

import { FrameIntro } from "./frame-intro";

export default async function FrameIntroPage({ params }: { params: Promise<{ frameId: string }> }) {
  const { frameId } = await params;
  const frame = getPublishedFrame(frameId);
  if (!frame) notFound();
  return <FrameIntro frameId={frame.id} />;
}
