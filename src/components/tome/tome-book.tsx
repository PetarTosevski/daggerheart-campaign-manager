"use client";

import { MapPin, PenLine, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { TOME_CHAPTERS, type Tome, type TomeChapterId } from "@/lib/frames/tomes";
import { cn } from "@/lib/utils";

// Colours from the Tome* boards.
const INK = "#2a1f14";
const RUBRIC = "#8e2b2b";

export type CustomTomeText = { overview: string; incident: string; mechanics: string };

/** GM notes and prompts for a custom campaign's tome (TomeCustom board). */
const CUSTOM_CHAPTERS: Record<TomeChapterId, { note: string; must: string; placeholder: string }> = {
  overview: {
    note: "Share your overview with your players before they build characters: the world, its history and what makes it different.",
    must: "This is your own campaign, so there is no book text here. You need to write your own lore and setting text for this chapter.",
    placeholder: "Write your setting here: the world, its history, its peoples, and the pitch you read to your players…",
  },
  incident: {
    note: "The inciting incident is the event that pulls the party into the story in your first session.",
    must: "Write your own inciting incident: the event that throws the party together, where the first session starts, and the key figures involved.",
    placeholder: "What happens at the start of the first session? Where are the characters, who do they meet, and what goes wrong?",
  },
  mechanics: {
    note: "Campaign mechanics are the special rules that apply only to this campaign. They are optional, but they make a frame feel unique.",
    must: "No mechanics come with a custom campaign. You need to write your own custom mechanics: special resources, countdowns, environment rules or changes to the core rules.",
    placeholder: "e.g. 1. Corruption: when a PC rolls with Fear in a cursed place, they mark a Corruption token…",
  },
};

type Content =
  | { kind: "published"; tome: Tome }
  | {
      kind: "custom";
      text: CustomTomeText;
      /** Present for the GM; players read the text only. */
      onSave?: (chapter: TomeChapterId, text: string) => Promise<unknown>;
      setup: { label: string; value: string }[];
    };

function Prose({ paragraphs }: { paragraphs: string[] }) {
  const [first, ...rest] = paragraphs.filter((p) => p.trim());
  if (!first) return null;
  return (
    <>
      <p className="m-0">
        <span className="float-left pt-2 pr-2.5 font-display text-[70px] leading-[0.82]" style={{ color: RUBRIC }} aria-hidden="true">
          {first.charAt(0)}
        </span>
        <span className="sr-only">{first.charAt(0)}</span>
        {first.slice(1)}
      </p>
      {rest.map((p) => (
        <p key={p.slice(0, 32)} className="m-0 indent-[1.4em]">
          {p}
        </p>
      ))}
    </>
  );
}

function PublishedChapter({ tome, chapter }: { tome: Tome; chapter: TomeChapterId }) {
  if (chapter === "mechanics") {
    return (
      <div className="flex flex-col gap-3">
        {tome.mechanics.rules.map((rule) => (
          <div key={rule.n} className="flex gap-3.5 rounded-lg border border-[#cdb88f] bg-[#e3d2ad] px-4 py-3.5">
            <span
              className="flex size-8 flex-none items-center justify-center rounded-full border-2 font-display text-[15px] font-bold"
              style={{ borderColor: RUBRIC, color: RUBRIC }}
            >
              {rule.n}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-display text-[16px] font-bold">{rule.head}</span>
              <span className="text-[18px] leading-[1.55] whitespace-pre-line">{rule.text}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (chapter === "incident") {
    const { incident } = tome;
    return (
      <>
        {incident.figures.length ? (
          <div className="mb-1 flex flex-col gap-2.5">
            <div className="font-display text-[13px] tracking-[0.22em] text-[#7a5b2e]">KEY FIGURES</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
              {incident.figures.map((f) => (
                <div key={f.name} className="flex flex-col gap-0.5 rounded-md border border-[#cdb88f] bg-[#e3d2ad] px-3.5 py-3">
                  <span className="font-display text-[16px] leading-tight font-bold">{f.name}</span>
                  <span className="text-[14px] text-[#6a5236]">{f.role}</span>
                  {f.line ? <span className="text-[15px] leading-snug">{f.line}</span> : null}
                </div>
              ))}
            </div>
            {incident.start ? (
              <div className="flex items-center gap-2 self-start rounded-full bg-[#2f4a3a] px-3.5 py-1.5 text-[15px] text-[#eef3ea]">
                <MapPin className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
                Start: {incident.start}
              </div>
            ) : null}
          </div>
        ) : null}
        <Prose paragraphs={incident.paragraphs} />
      </>
    );
  }
  const { overview } = tome;
  const [first, ...rest] = overview.paragraphs;
  return (
    <>
      <Prose paragraphs={first ? [first] : []} />
      {overview.quote ? (
        <blockquote
          className="my-1 border-l-[3px] py-1.5 pl-5 font-display text-[21px] leading-snug text-[#5a2a1a]"
          style={{ borderColor: RUBRIC }}
        >
          {overview.quote.text}
        </blockquote>
      ) : null}
      {rest.map((p) => (
        <p key={p.slice(0, 32)} className="m-0 indent-[1.4em]">
          {p}
        </p>
      ))}
    </>
  );
}

function CustomChapter({
  chapter,
  content,
}: {
  chapter: TomeChapterId;
  content: Extract<Content, { kind: "custom" }>;
}) {
  const saved = content.text[chapter];
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingText = useRef<string | null>(null);
  const inFlight = useRef(0);
  const latestRequest = useRef(0);
  const saveRef = useRef(content.onSave);
  useEffect(() => {
    saveRef.current = content.onSave;
  }, [content.onSave]);
  const meta = CUSTOM_CHAPTERS[chapter];

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = pendingText.current;
    const save = saveRef.current;
    if (text === null || !save) return;
    pendingText.current = null;
    const request = ++latestRequest.current;
    inFlight.current += 1;
    save(chapter, text)
      .then(() => {
        if (request === latestRequest.current) setStatus("saved");
      })
      .catch(() => {
        if (request === latestRequest.current) setStatus("error");
      })
      .finally(() => {
        inFlight.current -= 1;
      });
  };

  // Edits from another device show up whenever nothing here is unsaved.
  useEffect(() => {
    if (pendingText.current === null && inFlight.current === 0) {
      setDraft(saved);
    }
  }, [saved]);
  // Switching chapter or closing the book saves what was typed in the last moment.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- flush reads refs only
  useEffect(() => () => flush(), []);

  if (!content.onSave) {
    return saved.trim() ? (
      <div className="whitespace-pre-line">{saved}</div>
    ) : (
      <p className="m-0 text-[#6a5236] italic">Your GM hasn’t written this chapter yet.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-lg bg-[#2f4a3a] px-4 py-3 text-[16px] leading-snug text-[#eef3ea]">
        <PenLine className="mt-0.5 size-[18px] flex-none" strokeWidth={1.8} aria-hidden="true" />
        {meta.must}
      </div>
      {chapter === "overview" && content.setup.length ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-[#cdb88f] bg-[#e8d9b8] px-4 py-3 text-[16px]">
          <div className="col-span-2 font-display text-[12px] tracking-[0.18em] text-[#6f5530]">FROM YOUR FRAME SETUP</div>
          {content.setup.map((row) => (
            <div key={row.label} className="contents">
              <dt className="font-semibold">{row.label}</dt>
              <dd className="m-0">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <label className="flex flex-col gap-2">
        <span className="font-display text-[13px] tracking-[0.22em] text-[#7a5b2e] uppercase">
          Your {TOME_CHAPTERS.find((c) => c.id === chapter)!.title.replace(/^The /, "")}
        </span>
        <textarea
          value={draft}
          rows={12}
          placeholder={meta.placeholder}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            setStatus("saving");
            pendingText.current = text;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, 600);
          }}
          onBlur={flush}
          className="min-h-[300px] resize-y rounded-md border border-[#cdb88f] bg-[#f5ecd8] px-4 py-3 text-[18px] leading-relaxed text-[#2a1f14] placeholder:text-[#8a7350]"
        />
      </label>
      <p className="m-0 text-[14px] text-[#6a5236]" aria-live="polite">
        {status === "saving"
          ? "Saving…"
          : status === "saved"
            ? "Saved."
            : status === "error"
              ? "Couldn’t save. Check your connection; your text is still here."
              : "Your text saves automatically as you type."}
      </p>
    </div>
  );
}

/** The open-book tome from the Tome* boards: contents on the left, a chapter on the right. */
export function TomeBook({
  open,
  onClose,
  chapter,
  onChapter,
  kicker,
  title,
  art,
  content,
}: {
  open: boolean;
  onClose: () => void;
  chapter: TomeChapterId;
  onChapter: (chapter: TomeChapterId) => void;
  kicker: string;
  title: string;
  art: { image: string; position: string };
  content: Content;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const chapterHeadingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [chapter]);

  const index = TOME_CHAPTERS.findIndex((c) => c.id === chapter);
  const current = TOME_CHAPTERS[index];
  const prev = TOME_CHAPTERS[index - 1];
  const next = TOME_CHAPTERS[index + 1];
  const note =
    content.kind === "published"
      ? content.tome[chapter].note
      : CUSTOM_CHAPTERS[chapter].note;
  const sub = content.kind === "published" && chapter === "mechanics" ? content.tome.mechanics.sub : undefined;

  let body: ReactNode;
  if (content.kind === "published") body = <PublishedChapter tome={content.tome} chapter={chapter} />;
  else body = <CustomChapter key={chapter} chapter={chapter} content={content} />;

  return (
    <dialog
      ref={ref}
      aria-label={`${title} tome`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto h-[min(880px,calc(100dvh-32px))] w-[calc(100%-24px)] max-w-[1240px] overflow-visible bg-transparent p-0 backdrop:bg-[rgb(4_8_10/0.78)]"
    >
      {open ? (
        <div className="relative flex h-full rounded-2xl border border-[#5c4430] bg-[#3b2b1d] p-2.5 shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:p-[18px]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tome"
            className="absolute -top-4 -right-2 z-[2] flex size-12 cursor-pointer items-center justify-center rounded-full border-2 border-[#b8955a] bg-[#3b2b1d] text-[#f1e3c4] sm:-right-[18px]"
          >
            <X className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
          </button>
          <div
            aria-hidden="true"
            className="absolute top-0 right-[140px] z-[1] hidden h-[140px] w-7 sm:block"
            style={{ background: RUBRIC, clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%)" }}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-[#efe3c8] font-serif lg:flex-row" style={{ color: INK }}>
            <div className="flex flex-col gap-5 border-[#d3c19c] px-6 pt-8 pb-4 lg:flex-[0_0_38%] lg:gap-[22px] lg:border-r lg:px-10 lg:pt-12 lg:pb-9 lg:shadow-[inset_-28px_0_34px_-26px_rgba(90,60,20,0.4)]">
              <div className="font-display text-[13px] tracking-[0.28em] text-[#7a5b2e] uppercase">{kicker}</div>
              <h2 className="m-0 font-display text-[32px] leading-[1.05] font-black lg:text-[46px]">{title}</h2>
              <svg width="220" height="14" viewBox="0 0 220 14" aria-hidden="true" className="hidden lg:block">
                <path d="M0 7h96M124 7h96" stroke="#a68352" strokeWidth="1.2" />
                <path d="M110 1l6 6-6 6-6-6z" fill={RUBRIC} />
              </svg>
              <div className="hidden font-display text-[13px] tracking-[0.22em] text-[#7a5b2e] uppercase lg:block">Contents</div>
              <nav aria-label="Chapters" className="flex flex-row flex-wrap gap-1.5 lg:flex-col">
                {TOME_CHAPTERS.map((c) => {
                  const on = c.id === chapter;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-current={on ? "page" : undefined}
                      onClick={() => onChapter(c.id)}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-1.5 rounded border-l-[3px] px-3 py-1.5 text-left text-[18px] lg:text-[20px]",
                        on ? "bg-[#e3d2ad] font-medium" : "border-transparent bg-transparent",
                      )}
                      style={on ? { borderColor: RUBRIC } : undefined}
                    >
                      <span className="w-10 font-display text-[18px]" style={{ color: RUBRIC }}>
                        {c.numeral}
                      </span>
                      <span className="flex-1">{c.title}</span>
                    </button>
                  );
                })}
              </nav>
              <div
                aria-hidden="true"
                className="mt-auto hidden h-[170px] rounded-t-[100px] rounded-b-lg border-[3px] border-double border-[#a68352] bg-cover bg-no-repeat lg:block"
                style={{ backgroundImage: art.image, backgroundPosition: art.position }}
              />
              {note ? (
                <div className="hidden rounded-md border border-[#cdb88f] bg-[#e8d9b8] px-4 py-3.5 text-[16px] leading-normal text-[#4a3a26] italic lg:block">
                  <span className="mb-1 block font-display text-[12px] tracking-[0.18em] text-[#6f5530] not-italic">
                    FOR THE GAME MASTER
                  </span>
                  {note}
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-6 pt-4 pb-4 lg:gap-[18px] lg:pt-12 lg:pr-14 lg:pb-7 lg:pl-[52px]">
              <div className="flex items-baseline gap-4">
                <span className="font-display text-[22px]" style={{ color: RUBRIC }}>
                  {current.numeral}.
                </span>
                <h3 id={chapterHeadingId} className="m-0 font-display text-[26px] font-bold lg:text-[32px]">
                  {current.title}
                </h3>
              </div>
              {sub ? <div className="-mt-2 font-display text-[18px] text-[#6a4a22]">{sub}</div> : null}
              <div className="h-px bg-[#cdb88f]" />
              {/* Focusable so keyboard users can scroll a long chapter (axe scrollable-region-focusable). */}
              <div
                ref={bodyRef}
                tabIndex={0}
                role="region"
                aria-labelledby={chapterHeadingId}
                className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-3.5 text-[18px] leading-[1.65] lg:text-[19px]"
              >
                {body}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[#cdb88f] pt-3.5">
                <div className="sm:min-w-[120px]">
                  {prev ? (
                    <button
                      type="button"
                      onClick={() => onChapter(prev.id)}
                      className="min-h-11 cursor-pointer px-3.5 font-display text-[14px] tracking-[0.08em] text-[#6a4a22]"
                    >
                      ‹ <span className="hidden sm:inline">{prev.title}</span>
                      <span className="sm:hidden">Previous</span>
                    </button>
                  ) : null}
                </div>
                <span className="font-display text-[14px] text-[#735a3a]">— {current.numeral} —</span>
                <div className="flex justify-end sm:min-w-[120px]">
                  {next ? (
                    <button
                      type="button"
                      onClick={() => onChapter(next.id)}
                      className="min-h-11 cursor-pointer px-3.5 font-display text-[14px] tracking-[0.08em] text-[#6a4a22]"
                    >
                      <span className="hidden sm:inline">{next.title}</span>
                      <span className="sm:hidden">Next</span> ›
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
