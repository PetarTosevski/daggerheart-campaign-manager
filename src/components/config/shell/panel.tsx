"use client";

import "../config.css";

import { BookOpen, Check, Clock, Library, ScrollText, Table2, Users, X, type LucideIcon } from "lucide-react";
import { Suspense, useEffect, useId, useRef, type ComponentType } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";

import type { CampaignSummary } from "../../../../convex/campaigns";
import { ExpansionsSection } from "../sections/expansions";
import { LorekeeperSection } from "../sections/lorekeeper";
import { PlayersSection } from "../sections/players";
import { HouseRulesSection } from "../sections/rules";
import { SessionsSection } from "../sections/sessions";
import { TableSection } from "../sections/table";
import { SETTINGS_FOOTER, SETTINGS_SECTIONS, SETTINGS_TITLE, type SettingsSection, type SettingsSectionProps } from "../slots";
import { closeSettings, openSettings, useSettingsSection } from "./url";

/** The board's section icons (table, book, people, Lorekeeper book, clock). */
const SECTION_ICON: Record<SettingsSection, LucideIcon> = {
  table: Table2,
  rules: ScrollText,
  expansions: Library,
  players: Users,
  lorekeeper: BookOpen,
  sessions: Clock,
};

/** Each section's slot (../slots.ts): the tracer that owns the file fills it. */
const SECTION_SLOT: Record<SettingsSection, ComponentType<SettingsSectionProps>> = {
  table: TableSection,
  rules: HouseRulesSection,
  expansions: ExpansionsSection,
  players: PlayersSection,
  lorekeeper: LorekeeperSection,
  sessions: SessionsSection,
};

/**
 * Campaign settings (design `.setp`): the GM's slide-over on the right, open while the URL has `?settings=`. A native
 * modal `<dialog>`: the browser traps focus, Escape closes it (its `close` event removes the param), the backdrop click
 * closes it, and focus goes back to the button that opened it. It stays in the shell's DOM, so it inherits
 * `data-viewer` and its glass buttons take the GM's colours. Mount it once, for the GM only.
 */
export function CampaignSettingsPanel({ campaign }: { campaign: CampaignSummary }) {
  return (
    <Suspense fallback={null}>
      <Panel campaign={campaign} />
    </Suspense>
  );
}

function Panel({ campaign }: { campaign: CampaignSummary }) {
  const section = useSettingsSection();
  const open = section !== null;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Keeps the native dialog in step with the URL (a DOM sync, as brand/modal.tsx does; no state is copied).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start on the current section's nav item, not the ✕.
      dialog.querySelector<HTMLElement>('[data-settings-nav] [aria-current="true"]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="cfg-setp"
      data-testid="campaign-settings"
      onClose={closeSettings}
      onClick={(event) => {
        if (event.target === ref.current) closeSettings();
      }}
    >
      {section ? (
        <>
          <div className="cfg-setp-h">
            <div>
              <div className="cfg-kick">{campaign.name} · GM only</div>
              <h2 id={titleId} className="cfg-setp-title">
                {SETTINGS_TITLE}
              </h2>
            </div>
            <BrandButton variant="cancel" icon round aria-label="Close campaign settings" onClick={closeSettings} className="flex-none">
              <X aria-hidden="true" />
            </BrandButton>
          </div>
          <div className="cfg-setp-b">
            <nav className="cfg-snav" aria-label="Settings sections" data-settings-nav="">
              {SETTINGS_SECTIONS.map(({ id, label }) => {
                const Icon = SECTION_ICON[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className="cfg-sn"
                    aria-current={id === section ? "true" : undefined}
                    onClick={() => openSettings(id)}
                  >
                    <Icon size={16} strokeWidth={2} aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </nav>
            <SectionView section={section} campaign={campaign} />
          </div>
          <div className="cfg-setp-f">
            <Check size={16} strokeWidth={2} aria-hidden="true" />
            {SETTINGS_FOOTER}
          </div>
        </>
      ) : null}
    </dialog>
  );
}

function SectionView({ section, campaign }: { section: SettingsSection; campaign: CampaignSummary }) {
  const headingId = useId();
  const { title } = SETTINGS_SECTIONS.find((s) => s.id === section)!;
  const Slot = SECTION_SLOT[section];
  return (
    <section className="cfg-secs" aria-labelledby={headingId} data-section={section}>
      <h3 id={headingId} className="cfg-sec-title">
        {title}
      </h3>
      {/* One boundary per section (CL1); keyed by the section id (not live content) so a failed one resets on switch. */}
      <SlotBoundary
        key={section}
        fallback={
          <p role="alert" className="cfg-muted">
            This section could not load. Close the settings and open them again.
          </p>
        }
      >
        <Slot campaign={campaign} />
      </SlotBoundary>
    </section>
  );
}
