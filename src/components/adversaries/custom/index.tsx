"use client";

import "../catalogue/catalogue.css";
import "./custom.css";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { blank, fromSrd, validateCustom, type CustomAdversaryInput, type CustomTier } from "@/lib/adversaries/custom";
import { typeLabel } from "@/lib/adversaries/catalogue";
import { errorMessage } from "@/lib/convex-errors";
import { ADVERSARIES } from "@/lib/srd/adversaries";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { StatBlock, type StatBlockAdversary } from "../catalogue/stat-block";
import type { CatalogueEntryRef, CustomProps } from "../slots";
import { AddCustomToEncounter } from "./add-to-encounter";
import { CustomEditor, type EditorTarget } from "./editor";

export { AddCustomToEncounter } from "./add-to-encounter";

/** The id of the custom section, so "Duplicate & edit" can bring the saved block into view. */
export const CUSTOM_SECTION_ID = "adv-custom";

/** The "Custom" book pill (the board's Hope & Fear pill shape in the accent colour). */
export function CustomPill({ large }: { large?: boolean }) {
  return <span className={large ? "adx-pill adx-pill-lg" : "adx-pill"}>Custom</span>;
}

function inputOf(row: Doc<"customAdversaries">): CustomAdversaryInput {
  return validateCustom({
    name: row.name,
    tier: row.tier,
    type: row.type,
    ...(row.hordePerHp !== undefined ? { hordePerHp: row.hordePerHp } : {}),
    description: row.description,
    motives: row.motives,
    difficulty: row.difficulty,
    thresholds: row.thresholds,
    hp: row.hp,
    stress: row.stress,
    attack: row.attack,
    experiences: row.experiences,
    features: row.features,
  });
}

const statBlockOf = (row: Doc<"customAdversaries">): StatBlockAdversary => ({ ...row, tier: row.tier as CustomTier });

function scrollToCustom() {
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(CUSTOM_SECTION_ID)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

/**
 * "Duplicate & edit" for a catalogue stat block's actions: opens the editor on a copy of the SRD entry; the saved copy
 * is a custom adversary of this campaign (`onSaved` selects it in the custom section).
 */
export function DuplicateAdversary({
  campaignId,
  adversary,
  onSaved,
}: {
  campaignId: Id<"campaigns">;
  adversary: CatalogueEntryRef;
  onSaved?: (customId: Id<"customAdversaries">) => void;
}) {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const def = ADVERSARIES.find((a) => a.id === adversary.id);
  if (!def) return null;
  function open() {
    const { basedOn, ...initial } = fromSrd(def!);
    setTarget({ mode: "new", initial, basedOn });
  }
  return (
    <>
      <button type="button" className="adx-btn" onClick={open} aria-label={`Duplicate and edit ${adversary.name}`}>
        Duplicate &amp; edit
      </button>
      <CustomEditor
        campaignId={campaignId}
        target={target}
        onClose={() => setTarget(null)}
        onSaved={(id) => {
          onSaved?.(id);
          scrollToCustom();
        }}
      />
    </>
  );
}

function DeleteCustom({ campaignId, custom, onDeleted }: { campaignId: Id<"campaigns">; custom: Doc<"customAdversaries">; onDeleted: () => void }) {
  const remove = useMutation(api.customAdversaries.remove);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function click() {
    if (!confirming) return setConfirming(true);
    try {
      await remove({ campaignId, customId: custom._id });
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
    }
  }
  return (
    <>
      <button type="button" className="adx-btn adx-danger" onClick={() => void click()} onBlur={() => setConfirming(false)}>
        {confirming ? "Confirm delete" : "Delete"}
      </button>
      {error ? (
        <p role="alert" className="adx-error">
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * The campaign's custom adversaries (D8 A5), under the catalogue: a list with the "Custom" pill and the selected
 * block on parchment with Edit, Duplicate & edit, Delete and Add to encounter; "New adversary" starts a blank block
 * prefilled with the improvised statistics (CB p.208). `selectedId` / `onSelect` let the page select a block saved
 * from a catalogue duplicate.
 */
export function CustomAdversaries({
  campaignId,
  selectedId,
  onSelect,
}: CustomProps & { selectedId: string | null; onSelect: (customId: string) => void }) {
  const rows = useQuery(api.customAdversaries.list, { campaignId });
  const [target, setTarget] = useState<EditorTarget | null>(null);

  if (rows === undefined) {
    return (
      <p role="status" className="adx-count">
        Loading custom adversaries…
      </p>
    );
  }

  const selected = rows.find((r) => r._id === selectedId) ?? rows[0] ?? null;

  return (
    <section id={CUSTOM_SECTION_ID} className="adx-section" aria-labelledby="adx-title">
      <div className="adx-head">
        <h2 id="adx-title" className="adx-title">
          Custom adversaries
        </h2>
        <CustomPill large />
        <span className="adx-count">
          {rows.length === 0 ? "None yet" : `${rows.length} ${rows.length === 1 ? "adversary" : "adversaries"}`} · only in this campaign
        </span>
        <button type="button" className="adx-primary" onClick={() => setTarget({ mode: "new", initial: blank(1, "Standard"), blank: true })}>
          New adversary
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="adx-empty">
          Use “Duplicate &amp; edit” on any stat block above, or start a new adversary from the improvised statistics by tier (Core Rulebook p. 208).
        </p>
      ) : (
        <div className="adc-grid">
          <div className="adc-list" role="list" aria-label="Custom adversary list">
            {rows.map((row) => (
              <div role="listitem" key={row._id}>
                <button
                  type="button"
                  className="adc-item"
                  aria-current={row._id === selected?._id ? "true" : undefined}
                  onClick={() => onSelect(row._id)}
                >
                  <span className="adc-item-main">
                    <span className="adc-nm">
                      {row.name}
                      <CustomPill />
                    </span>
                    <span className="adc-sub">{row.motives || `Tier ${row.tier}`}</span>
                  </span>
                  <span className="adc-type">{typeLabel(row)}</span>
                  <span className="adc-num" aria-hidden="true">
                    <span>
                      <strong>{row.difficulty}</strong>Diff
                    </span>
                    <span>
                      <strong>{row.hp}</strong>HP
                    </span>
                    <span>
                      <strong>{row.stress}</strong>Stress
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="adc-detail" aria-label="Custom stat block" role="region">
            {selected ? (
              <StatBlock
                adversary={statBlockOf(selected)}
                actions={
                  <>
                    <CustomPill large />
                    <AddCustomToEncounter campaignId={campaignId} custom={selected} />
                    <button type="button" className="adx-btn" onClick={() => setTarget({ mode: "edit", customId: selected._id, initial: inputOf(selected) })}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="adx-btn"
                      onClick={() => setTarget({ mode: "new", initial: inputOf(selected), ...(selected.basedOn ? { basedOn: selected.basedOn } : {}) })}
                    >
                      Duplicate &amp; edit
                    </button>
                    <DeleteCustom key={selected._id} campaignId={campaignId} custom={selected} onDeleted={() => onSelect("")} />
                  </>
                }
              />
            ) : null}
          </div>
        </div>
      )}
      <CustomEditor campaignId={campaignId} target={target} onClose={() => setTarget(null)} onSaved={(id) => onSelect(id)} />
    </section>
  );
}
