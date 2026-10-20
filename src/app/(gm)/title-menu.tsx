"use client";

import { useQuery } from "convex/react";
import { BookOpen, Play, Plus, Sun, Users } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { LogoMark } from "@/components/brand/brand";
import { frameName, plural } from "@/lib/campaign-display";

import { api } from "../../../convex/_generated/api";
import { JoinDialog } from "./join-dialog";
import { SettingsDialog } from "./settings-dialog";

const ITEM =
  "flex min-h-[76px] w-full cursor-pointer items-center gap-3 rounded-[10px] border border-transparent px-5 py-2.5 text-center text-parchment transition-[background,border-color,box-shadow] duration-200 hover:border-line-2 hover:bg-raised hover:shadow-[inset_3px_0_0_var(--brand)]";

function MenuItem({ icon, label, sub }: { icon: ReactNode; label: string; sub: string }) {
  return (
    <>
      <span className="flex w-10 flex-none justify-center text-brand">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
        <span className="font-display text-[22px] font-bold tracking-[0.08em] sm:text-[26px]">{label}</span>
        <span className="text-[13px] text-muted-text">{sub}</span>
      </span>
      <span className="w-10 flex-none" />
    </>
  );
}

/** TitleMenu board: Continue, Create, Load and Settings. */
export function TitleMenu() {
  const campaigns = useQuery(api.campaigns.list);
  const settings = useQuery(api.settings.get);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const latest = campaigns?.[0];

  return (
    <main className="flex min-h-screen flex-col items-center bg-ink px-6 pt-16 pb-12 text-parchment">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <LogoMark size={110} />
        <h1 className="font-display text-[clamp(28px,8.4vw,104px)] leading-none font-black tracking-[0.08em]">
          DAGGERHEART
        </h1>
        <div className="flex items-center gap-4 font-display text-[13px] tracking-[0.3em] text-brand sm:text-[16px] sm:tracking-[0.4em]">
          <span className="h-px w-8 bg-brand sm:w-16" />
          Campaign Ledger
          <span className="h-px w-8 bg-brand sm:w-16" />
        </div>
      </div>

      <nav aria-label="Main menu" className="mt-[72px] flex w-full max-w-[440px] flex-col gap-1.5">
        {latest ? (
          <Link href={`/campaigns/${latest._id}`} className={ITEM}>
            <MenuItem
              icon={<Play className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />}
              label="Continue"
              sub={`${latest.name} · ${frameName(latest.frameId)}${latest.role === "player" ? " · Player" : ""}`}
            />
          </Link>
        ) : null}
        <Link href="/new" className={ITEM}>
          <MenuItem
            icon={
              <span className="flex size-[30px] items-center justify-center rounded-full border border-[#5c4d2e]">
                <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              </span>
            }
            label="Create New Campaign"
            sub="Frame or custom · start at session zero"
          />
        </Link>
        <Link href="/campaigns" className={ITEM}>
          <MenuItem
            icon={<BookOpen className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />}
            label="Load Campaign"
            sub={
              campaigns === undefined
                ? "…"
                : campaigns.length === 0
                  ? "No saved campaigns"
                  : plural(campaigns.length, "saved campaign")
            }
          />
        </Link>
        <button type="button" className={ITEM} aria-haspopup="dialog" onClick={() => setJoinOpen(true)}>
          <MenuItem
            icon={<Users className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />}
            label="Join Campaign"
            sub="Play in a friend's game with their code"
          />
        </button>
        <button
          type="button"
          className={ITEM}
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
        >
          <MenuItem
            icon={<Sun className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />}
            label="Settings"
            sub="Table, display & account"
          />
        </button>
      </nav>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <JoinDialog open={joinOpen} onClose={() => setJoinOpen(false)} />

      <div className="mt-auto pt-12 text-[13px] tracking-[0.1em] text-faint">
        {settings?.tableName || "Daggerheart Campaign Ledger"}
      </div>
    </main>
  );
}
