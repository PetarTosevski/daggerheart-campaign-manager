"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useCampaign } from "./campaign-shell";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="m-0 font-display text-[26px] font-bold tracking-[0.02em] text-parchment">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-[#33444a] px-6 py-6 text-center text-[15px] text-[#c9d2cf]">
      {children}
    </div>
  );
}

/** CampaignHub board. D1 shows the layout; Fear, countdowns and time controls arrive in D2. */
export default function DashboardPage() {
  const campaign = useCampaign();

  return (
    <main className="mx-auto grid max-w-[1344px] grid-cols-1 gap-6 px-4 py-7 sm:px-12 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-8">
        <Section title="The Party">
          <EmptyState>
            No characters yet.{" "}
            <Link href={`/campaigns/${campaign._id}/party`} className="text-brand underline underline-offset-4">
              Open the Party tab
            </Link>{" "}
            to create the first hero.
          </EmptyState>
        </Section>
        <Section title="Countdowns">
          <EmptyState>No countdowns running.</EmptyState>
        </Section>
        <section className="flex flex-col gap-3 rounded-2xl border border-[#2a3a40] bg-[#141e22] p-6">
          <h2 className="m-0 font-display text-[24px] font-bold text-parchment">Last Session</h2>
          <p className="m-0 font-serif text-[18px] leading-relaxed text-[#c9d2cf]">
            No sessions played yet. Write a recap in a session’s Wrap-up stage and it will appear here.
          </p>
        </section>
      </div>

      <aside
        aria-label="GM Fear"
        className="flex flex-col gap-4 self-start rounded-2xl border border-[#3b2f5c] bg-[radial-gradient(circle_at_50%_40%,#2a1a55_0%,#120c20_75%)] p-6"
      >
        <h2 className="m-0 font-display text-[24px] font-bold text-[#e3d8ff]">GM Fear</h2>
        <p className="m-0 flex items-baseline gap-2 text-fear">
          <strong className="font-display text-[56px] leading-none text-[#e3d8ff]">{campaign.fear}</strong>
          <span className="text-[15px]">of 12</span>
        </p>
      </aside>
    </main>
  );
}
