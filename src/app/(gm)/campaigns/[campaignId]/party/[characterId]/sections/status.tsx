"use client";

import "./status.css";

import { useState } from "react";

import { Pill } from "@/components/party/sheet-ui";

import { useSheet, type CharacterStatus } from "../sheet-context";

// Status controls (Active / Dead / Retired) at the end of page 1, owner and GM only. The board has no home for
// them (it marks death from the roster card), so they are a small paper row of outline pills under a rule,
// not a box; Dead and Retired ask first in an inline alertdialog.

const STATUS_LABEL: Record<CharacterStatus, string> = { active: "Active", dead: "Dead", retired: "Retired" };

export function StatusControls() {
  const { character, canEdit, setStatus } = useSheet();
  const [confirm, setConfirm] = useState<CharacterStatus | null>(null);
  if (!canEdit) return null;
  return (
    <section className="st-row" aria-labelledby="sheet-status-title">
      <div className="st-line">
        <h3 id="sheet-status-title" className="sh-lbl m-0">
          Status
        </h3>
        <div className="st-pills" role="group" aria-label="Character status">
          {(Object.keys(STATUS_LABEL) as CharacterStatus[]).map((s) => (
            <Pill
              key={s}
              variant={character.status === s ? "solid" : "mark"}
              aria-pressed={character.status === s}
              onClick={() => (s === "active" || s === character.status ? void setStatus(s) : setConfirm(s))}
            >
              {STATUS_LABEL[s]}
            </Pill>
          ))}
        </div>
      </div>
      {confirm ? (
        <div role="alertdialog" aria-label={`Confirm ${STATUS_LABEL[confirm].toLowerCase()}`} aria-describedby="sheet-status-confirm" className="st-confirm">
          <p id="sheet-status-confirm" className="sh-small m-0">
            Mark {character.sheet.name} as {STATUS_LABEL[confirm].toLowerCase()}? You can set them active again later.
          </p>
          <div className="st-pills">
            <Pill
              variant="solid"
              onClick={() => {
                void setStatus(confirm);
                setConfirm(null);
              }}
            >
              Mark {STATUS_LABEL[confirm].toLowerCase()}
            </Pill>
            <Pill onClick={() => setConfirm(null)}>Cancel</Pill>
          </div>
        </div>
      ) : null}
    </section>
  );
}
