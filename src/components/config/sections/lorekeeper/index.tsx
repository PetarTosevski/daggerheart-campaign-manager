"use client";

import "./lorekeeper.css";

import { useMutation, useQuery } from "convex/react";
import { Lock } from "lucide-react";
import { useState, type ReactNode } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { setEnabledLocally } from "@/components/lorekeeper/side/optimistic";
import type { LorekeeperAsk } from "@/lib/config/campaign-settings";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { TableSettingChange } from "../../../../../convex/campaignSettings";
import { BOOK_KEY_HOUSE_RULES, isCampaignBookKey } from "../../../../../convex/lib/validators/lorekeeper";
import type { LibraryBook } from "../../../../../convex/lorekeeperLibrary";
import type { SettingsSectionProps } from "../../slots";
import { LorekeeperCampaignBooks } from "./books";
import { LorekeeperLimits } from "./limits";

/** The board's text for the Lorekeeper rows (reference/designs/config/Settings.dc.html, `.s-lore`). */
export const LORE_TEXT = {
  sources: "Sources it may search",
  indexed: "Indexed",
  off: "Off",
  notes: (campaignName: string) => `Your ${campaignName} notes`,
  notesHint: "Your notes pages shared with everyone",
  rulings: { label: "Table rulings & house rules", hint: "This page" },
  gmNotes: { label: "GM-only notes", hint: "Never shown to players" },
  web: { label: "Search the internet when the books don’t say", hint: "Results are marked “From the internet · unofficial”." },
  whoCanAsk: "Who can ask",
  alwaysOn: "Always on",
  alwaysOff: "Always off",
} as const;

const ASK_LABEL: Record<LorekeeperAsk, string> = { everyone: "Everyone", gm: "GM only" };

/**
 * Campaign settings, Lorekeeper (plan config U4, design `.s-lore`):
 * - 'Sources it may search': every book of `lorekeeperLibrary.list` with its switch (`setEnabled`, the same optimistic
 *   update as the Lorekeeper's Library card) and the 'Indexed' / 'Off' pill. The House rules (notes) book keeps its own
 *   row, named after the campaign (Q24: the GM's notes pages shared with everyone);
 * - `LorekeeperCampaignBooks` (AU8, Q24 b) and `LorekeeperLimits` (AU3, Q21) are empty slots;
 * - 'Table rulings & house rules' locked on and 'GM-only notes' locked off (no setting: the Lorekeeper's context always
 *   quotes the rulings and never reads GM-only pages);
 * - internet search (`lorekeeperWeb`) and who can ask (`lorekeeperAsk`) write `campaignSettings.set`, one field per call,
 *   and read the live `campaigns.get` settings (`props.campaign`). The server enforces both (L1).
 */
export function LorekeeperSection(props: SettingsSectionProps): ReactNode {
  const { campaign } = props;
  const campaignId = campaign._id;
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  const setEnabled = useMutation(api.lorekeeperLibrary.setEnabled).withOptimisticUpdate(setEnabledLocally);
  const setSetting = useMutation(api.campaignSettings.set).withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.campaigns.get, { campaignId });
    if (current) store.setQuery(api.campaigns.get, { campaignId }, { ...current, settings: { ...current.settings, [change.key]: change.value } });
  });
  const [error, setError] = useState<string | null>(null);

  async function run(write: () => Promise<unknown>) {
    setError(null);
    try {
      await write();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const change = (c: TableSettingChange) => void run(() => setSetting({ campaignId, change: c }));
  const toggleBook = (book: LibraryBook) => void run(() => setEnabled({ campaignId, bookId: book.bookId, enabled: !book.enabled }));
  const { settings } = campaign;

  // The GM's own books (AU8) have their own rows in `LorekeeperCampaignBooks`.
  const books = library?.books.filter((book) => book.key !== BOOK_KEY_HOUSE_RULES && !isCampaignBookKey(book.key)) ?? [];
  const notes = library?.books.find((book) => book.key === BOOK_KEY_HOUSE_RULES);

  return (
    <div data-testid="settings-lorekeeper">
      <div className="cfg-lbl">{LORE_TEXT.sources}</div>
      {library === undefined ? (
        <p role="status" className="cfg-muted">
          Loading …
        </p>
      ) : (
        <>
          {books.map((book) => (
            <div key={book.bookId} className="cfg-row">
              <div className="cfg-row-t">
                <b>{book.title}</b>
                <span className="cfg-lk-pill" data-on={book.enabled}>
                  {book.enabled ? LORE_TEXT.indexed : LORE_TEXT.off}
                </span>
              </div>
              <Switch label={book.title} checked={book.enabled} onChange={() => toggleBook(book)} />
            </div>
          ))}
          {notes ? (
            <div className="cfg-row">
              <RowText label={LORE_TEXT.notes(campaign.name)} hint={LORE_TEXT.notesHint} />
              <Switch label={LORE_TEXT.notes(campaign.name)} checked={notes.enabled} onChange={() => toggleBook(notes)} />
            </div>
          ) : null}
        </>
      )}
      <LorekeeperCampaignBooks {...props} />
      <LockedRow {...LORE_TEXT.rulings} on />
      <LockedRow {...LORE_TEXT.gmNotes} on={false} />
      <div className="cfg-row">
        <RowText {...LORE_TEXT.web} />
        <Switch label={LORE_TEXT.web.label} checked={settings.lorekeeperWeb} onChange={(value) => change({ key: "lorekeeperWeb", value })} />
      </div>
      <div className="cfg-row cfg-col">
        <RowText label={LORE_TEXT.whoCanAsk} />
        <div className="cfg-seg" role="group" aria-label={LORE_TEXT.whoCanAsk}>
          {(Object.keys(ASK_LABEL) as LorekeeperAsk[]).map((value) => (
            <button
              key={value}
              type="button"
              className={glassButtonClass({ role: "neutral" })}
              aria-pressed={settings.lorekeeperAsk === value}
              onClick={() => {
                if (settings.lorekeeperAsk !== value) change({ key: "lorekeeperAsk", value });
              }}
            >
              {ASK_LABEL[value]}
            </button>
          ))}
        </div>
      </div>
      <LorekeeperLimits {...props} />
      <p aria-live="polite" className="cfg-muted cfg-lk-err">
        {error}
      </p>
    </div>
  );
}

function RowText({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="cfg-row-t">
      <b>{label}</b>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

/** A row with no setting: the switch is disabled and the lock says why. */
function LockedRow({ label, hint, on }: { label: string; hint: string; on: boolean }) {
  return (
    <div className="cfg-row">
      <RowText label={label} hint={hint} />
      <span className="cfg-muted cfg-lk-lock">
        <Lock size={16} aria-hidden="true" />
        {on ? LORE_TEXT.alwaysOn : LORE_TEXT.alwaysOff}
      </span>
      <Switch label={label} checked={on} disabled />
    </div>
  );
}

/** The design's `.sw`: a button with role switch (the shared `cfg-sw` class). */
function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange?: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="cfg-sw" disabled={disabled} onClick={() => onChange?.(!checked)}>
      <i />
    </button>
  );
}
