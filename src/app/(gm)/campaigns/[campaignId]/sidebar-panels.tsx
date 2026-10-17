"use client";

import { KEY_FIGURES, TOME_CHAPTERS } from "@/lib/frames/tomes";

import { useCampaign, useOpenTome } from "./campaign-shell";

/** "Campaign Tome" panel: one button per chapter (Hub* boards). */
export function TomePanel() {
  const openTome = useOpenTome();
  return (
    <section aria-labelledby="tome-h" className="flex flex-col gap-2.5 rounded-[14px] bg-[#efe3c8] p-5 text-[#2a1f14]">
      <h2 id="tome-h" className="m-0 font-display text-[22px] font-bold">
        Campaign Tome
      </h2>
      {TOME_CHAPTERS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => openTome(c.id)}
          className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-[#cdb88f] bg-[#e3d2ad] px-3 text-left font-serif text-[19px] hover:brightness-105"
        >
          <span className="w-7 font-display text-[#8e2b2b]">{c.numeral}</span>
          {c.title}
        </button>
      ))}
    </section>
  );
}

/** "Key Figures" panel: the frame's main NPCs. A custom campaign keeps them in its tome. */
export function KeyFiguresPanel() {
  const campaign = useCampaign();
  const openTome = useOpenTome();
  const figures = campaign.frameId === "custom" ? [] : KEY_FIGURES[campaign.frameId];
  return (
    <section aria-labelledby="npc-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5">
      <h2 id="npc-h" className="m-0 font-display text-[22px] font-bold text-parchment">
        Key Figures
      </h2>
      {figures.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {figures.map((f, i) => (
            <li
              key={f.name}
              className={`flex flex-col gap-0.5 py-2.5 ${i < figures.length - 1 ? "border-b border-[#22303a]" : ""}`}
            >
              <span className="font-semibold text-[#e6ecea]">{f.name}</span>
              <span className="text-[13px] text-[#9fb2b6]">{f.role}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-[#9fb2b6]">
          Your campaign’s key figures live in your{" "}
          <button type="button" className="cursor-pointer text-brand underline underline-offset-4" onClick={() => openTome("incident")}>
            Inciting Incident
          </button>
          .
        </p>
      )}
    </section>
  );
}
