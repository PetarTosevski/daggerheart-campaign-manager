"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ArtBackdrop, ComplexityDiamonds, CreateSteps, PageHeader } from "@/components/brand/brand";
import { BrandButton } from "@/components/brand/buttons";
import { assetBackground } from "@/lib/design-assets";
import { getPublishedFrame, type PublishedFrameId } from "@/lib/frames";

import { NameCampaignDialog } from "../../new/create-campaign";
import { ExpansionBadge } from "../../new/frame-select";

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 text-[12px] font-medium tracking-[0.2em] text-[#9aa6b0] uppercase">{children}</h2>
  );
}

/** The per-frame intro boards (Witherwild, FiveBanners, …). */
export function FrameIntro({ frameId }: { frameId: PublishedFrameId }) {
  const frame = getPublishedFrame(frameId)!;
  const [hidden, setHidden] = useState(false);
  const [naming, setNaming] = useState(false);
  const art = assetBackground(frame.intro.asset);

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden text-parchment"
      style={{ background: frame.intro.background }}
    >
      <ArtBackdrop image={art} position={frame.intro.position} dim={frame.intro.dim / 100} contain />

      <PageHeader
        backHref={`/new?frame=${frame.id}`}
        backLabel="Back to campaign frames"
        title="Campaign Frame"
        actions={<CreateSteps translucent />}
        translucent
      />

      <main className="relative mx-auto flex w-full max-w-[1344px] flex-1 items-start px-4 py-7 sm:px-12">
        {hidden ? (
          <BrandButton
            variant="pill"
            size="lg"
            className="border-white/20 bg-[rgb(9_12_16/0.82)]"
            onClick={() => setHidden(false)}
          >
            <Eye strokeWidth={1.8} aria-hidden="true" />
            Show details
          </BrandButton>
        ) : (
          <section
            aria-labelledby="frame-title"
            className="flex w-full max-w-[760px] flex-col gap-4 rounded-[18px] border border-white/10 bg-[rgb(9_13_18/0.84)] px-6 py-7 sm:px-8"
          >
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-3 text-[13px] tracking-[0.2em] text-[#b3bcc4] uppercase">
                <span>{frame.source}</span>
                <span aria-hidden="true">·</span>
                <span>
                  Complexity <ComplexityDiamonds value={frame.complexity} />
                </span>
                {frame.expansion ? <ExpansionBadge small /> : null}
              </div>
              <h1
                id="frame-title"
                className="m-0 font-display text-[36px] leading-[1.04] font-black tracking-[0.04em] sm:text-[52px]"
              >
                {frame.name}
              </h1>
              <p className="m-0 text-[17px] leading-normal text-[#dde3e8] italic">{frame.tagline}</p>
              <p className="m-0 text-[13px] text-[#9aa6b0]">Designed by {frame.designers}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Heading>The Pitch</Heading>
              {frame.pitch.map((paragraph) => (
                <p key={paragraph.slice(0, 24)} className="m-0 text-[15px] leading-relaxed text-[#dde3e8]">
                  {paragraph}
                </p>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              <Heading>Tone &amp; Feel</Heading>
              <div className="flex flex-wrap gap-2">
                {frame.tones.map((tone) => (
                  <span key={tone} className="rounded-full border border-[#45505a] px-3 py-1.5 text-[13px]">
                    {tone}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Heading>Themes</Heading>
                <p className="m-0 text-[15px] leading-normal text-[#dde3e8]">{frame.themes}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Heading>Touchstones</Heading>
                <p className="m-0 text-[15px] leading-normal text-[#dde3e8]">{frame.touchstones}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Heading>Special Mechanics</Heading>
                <p className="m-0 text-[15px] leading-snug text-brand">{frame.mechanics}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Heading>Inciting Incident</Heading>
                <p className="m-0 text-[15px] leading-snug text-brand">{frame.incident}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-1.5">
              <BrandButton variant="primary" size="xl" onClick={() => setNaming(true)}>
                Choose this Frame
              </BrandButton>
              <BrandButton
                variant="pill"
                size="xl"
                className="ml-auto border-white/20 px-5 text-[15px]"
                onClick={() => setHidden(true)}
              >
                <EyeOff strokeWidth={1.8} aria-hidden="true" />
                View full art
              </BrandButton>
            </div>
          </section>
        )}
      </main>

      <NameCampaignDialog
        frameId={frame.id}
        frameName={frame.name}
        open={naming}
        onClose={() => setNaming(false)}
      />
    </div>
  );
}
