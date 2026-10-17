"use client";

import { FileText, PenLine } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { ComplexityDiamonds, CreateSteps, PageHeader } from "@/components/brand/brand";
import { BrandButton, brandButton } from "@/components/brand/buttons";
import { assetBackground } from "@/lib/design-assets";
import { PUBLISHED_FRAMES, type PublishedFrame } from "@/lib/frames";
import { cn } from "@/lib/utils";

import { clearCustomDraft, CustomFrameForm, useCustomDraft, type CustomDraft } from "./custom-frame-form";
import { NameCampaignDialog, useCreateCampaign } from "./create-campaign";

export function ExpansionBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[#5b4a8f] bg-[#1e1930] font-display font-bold tracking-[0.08em]",
        small ? "px-2.5 py-[3px] text-[12px]" : "self-start px-3 py-1 text-[13px]",
      )}
    >
      <span className="text-hope">Hope</span>
      <span className="text-muted-text">&amp;</span>
      <span className="text-fear">Fear</span>
    </span>
  );
}

function KindCard({
  checked,
  onPick,
  icon,
  title,
  text,
}: {
  checked: boolean;
  onPick: () => void;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onPick}
      className={cn(
        "flex min-h-[120px] cursor-pointer items-center gap-5 rounded-2xl border-2 px-[26px] py-[22px] text-left text-parchment",
        checked ? "border-brand bg-raised" : "border-line bg-panel-2",
      )}
    >
      <span
        className={cn(
          "flex size-14 flex-none items-center justify-center rounded-xl border-[1.5px]",
          checked ? "border-brand text-brand" : "border-[#5c556b] text-[#5c556b]",
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-1.5">
        <span className="font-display text-[22px] font-bold sm:text-[26px]">{title}</span>
        <span className="text-[15px] leading-normal text-muted-text">{text}</span>
      </span>
    </button>
  );
}

function FrameListItem({ frame, selected, onPick }: { frame: PublishedFrame; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        "relative flex min-h-[84px] w-full flex-none cursor-pointer items-center gap-4 overflow-hidden rounded-xl border px-4 py-3 text-left text-parchment",
        selected ? "border-brand bg-raised" : "border-line bg-panel-2",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-no-repeat"
        style={{ backgroundImage: assetBackground(frame.art.asset), backgroundPosition: frame.art.position }}
      />
      <span aria-hidden="true" className="absolute inset-0 bg-[rgb(8_10_14/0.5)]" />
      <span className="relative flex min-w-0 flex-1 flex-col gap-1.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
        <span className="font-display text-[21px] font-bold">{frame.name}</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-[#d4dbe0]">{frame.source}</span>
          {frame.expansion ? <ExpansionBadge small /> : null}
        </span>
      </span>
      <span className="relative flex flex-none flex-col items-end gap-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
        <span className="text-[11px] tracking-[0.12em] text-[#d4dbe0] uppercase">Complexity</span>
        <span className="text-[15px]">
          <ComplexityDiamonds value={frame.complexity} />
        </span>
      </span>
    </button>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className="text-[15px] leading-normal text-body">{children}</span>
    </div>
  );
}

function FrameDetails({ frame }: { frame: PublishedFrame }) {
  return (
    <section
      aria-label="Frame details"
      className="flex min-w-0 flex-[1_1_520px] flex-col gap-[18px] rounded-2xl border border-line bg-panel p-7"
    >
      <div
        role="img"
        aria-label={`Key art for ${frame.name}`}
        className="h-[140px] rounded-xl bg-[#221f2d] bg-cover bg-no-repeat"
        style={{ backgroundImage: assetBackground(frame.art.asset), backgroundPosition: frame.art.position }}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-2">
          {frame.expansion ? <ExpansionBadge /> : null}
          <h2 className="m-0 font-display text-[30px] font-bold sm:text-[34px]">{frame.name}</h2>
        </div>
        <span className="text-[14px] text-muted-text">
          Complexity <ComplexityDiamonds value={frame.complexity} />
        </span>
      </div>
      <Detail label="The Pitch">{frame.tagline}</Detail>
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Tone &amp; Feel</span>
        <div className="flex flex-wrap gap-2">
          {frame.tones.map((tone) => (
            <span key={tone} className="rounded-full border border-line-2 px-3 py-1.5 text-[13px]">
              {tone}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Detail label="Themes">{frame.themes}</Detail>
        <Detail label="Touchstones">{frame.touchstones}</Detail>
      </div>
      <div className="mt-auto flex flex-wrap gap-3">
        <Link href={`/frames/${frame.id}`} className={brandButton({ variant: "outline", size: "lg" })}>
          Preview full frame
        </Link>
      </div>
    </section>
  );
}

/** FrameSelect board: pick a published frame or write a custom one. */
export function FrameSelect() {
  const params = useSearchParams();
  const [kind, setKind] = useState<"frame" | "custom">(params.get("kind") === "custom" ? "custom" : "frame");
  const initial = PUBLISHED_FRAMES.findIndex((f) => f.id === params.get("frame"));
  const [selectedId, setSelectedId] = useState<string>(PUBLISHED_FRAMES[Math.max(0, initial)].id);
  const [search, setSearch] = useState("");
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useCustomDraft();
  const custom = useCreateCampaign({ onCreated: clearCustomDraft });

  const frames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PUBLISHED_FRAMES;
    return PUBLISHED_FRAMES.filter((f) =>
      [f.name, f.tagline, f.themes, f.touchstones, ...f.tones].some((text) => text.toLowerCase().includes(q)),
    );
  }, [search]);

  const selected = PUBLISHED_FRAMES.find((f) => f.id === selectedId) ?? PUBLISHED_FRAMES[0];
  const isFrame = kind === "frame";
  const customName = draft.name.trim();

  const summary = isFrame
    ? `Frame: ${selected.name}`
    : customName
      ? `Custom: ${customName} · ${draft.tones.length} tone${draft.tones.length === 1 ? "" : "s"}`
      : "Name your campaign to start";

  return (
    <div className="flex min-h-screen flex-col bg-ink text-parchment">
      <PageHeader backHref="/" backLabel="Back to main menu" title="Create New Campaign" actions={<CreateSteps />} />

      <main className="mx-auto flex w-full max-w-[1344px] flex-1 flex-col gap-7 px-4 py-10 sm:px-12 lg:px-20">
        <div className="flex flex-col gap-2.5">
          <h2 className="m-0 font-display text-[32px] font-bold tracking-[0.03em] sm:text-[44px]">
            Existing Campaign Frame &amp; Custom
          </h2>
          <p className="m-0 text-[17px] text-muted-text">
            Begin from a published frame, or forge your own world from nothing.
          </p>
        </div>

        <div role="radiogroup" aria-label="Campaign kind" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <KindCard
            checked={isFrame}
            onPick={() => setKind("frame")}
            icon={<FileText className="size-[26px]" strokeWidth={1.6} aria-hidden="true" />}
            title="Existing Campaign Frame"
            text="Pitch, themes, special mechanics and an inciting incident, ready to play."
          />
          <KindCard
            checked={!isFrame}
            onPick={() => setKind("custom")}
            icon={<PenLine className="size-[26px]" strokeWidth={1.6} aria-hidden="true" />}
            title="Custom"
            text="Write your own pitch, tone, themes and touchstones from a blank frame."
          />
        </div>

        {isFrame ? (
          <div className="flex flex-wrap gap-6">
            <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-[13px] font-medium tracking-[0.22em] text-muted-text uppercase">
                  Campaign Frames
                </h2>
                <label htmlFor="fs-search" className="sr-only">
                  Search frames
                </label>
                <input
                  id="fs-search"
                  type="search"
                  placeholder="Search frames"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-h-11 w-[200px] rounded-lg border border-line-2 bg-panel px-3 text-[15px] text-parchment placeholder:text-subtle"
                />
              </div>
              <div className="flex max-h-[460px] flex-col gap-2.5 overflow-y-auto pr-1.5">
                {frames.map((frame) => (
                  <FrameListItem
                    key={frame.id}
                    frame={frame}
                    selected={frame.id === selected.id}
                    onPick={() => setSelectedId(frame.id)}
                  />
                ))}
                {frames.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line-2 p-6 text-center text-muted-text">
                    No frame matches “{search}”.
                  </p>
                ) : null}
              </div>
            </div>
            <FrameDetails frame={selected} />
          </div>
        ) : (
          <CustomFrameForm draft={draft} onChange={setDraft} />
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[#2a2838] px-4 py-5 sm:px-12">
        <Link href="/" className={brandButton({ variant: "outline", size: "lg" })}>
          Back
        </Link>
        <span className="text-[14px] text-muted-text" aria-live="polite">
          {custom.error ?? summary}
        </span>
        <BrandButton
          variant="primary"
          size="lg"
          className="px-8"
          disabled={(!isFrame && !customName) || custom.pending}
          onClick={() => {
            if (isFrame) setNaming(true);
            else void custom.submit({ frameId: "custom", name: draft.name, custom: draftToInput(draft) });
          }}
        >
          {custom.pending ? "Creating…" : "Start campaign"}
        </BrandButton>
      </footer>

      <NameCampaignDialog
        frameId={selected.id}
        frameName={selected.name}
        open={naming}
        onClose={() => setNaming(false)}
      />
    </div>
  );
}

function draftToInput({ pitch, tones, themes, touchstones, partySize, startingTier, background }: CustomDraft) {
  return { pitch, tones, themes, touchstones, partySize, startingTier, background };
}
