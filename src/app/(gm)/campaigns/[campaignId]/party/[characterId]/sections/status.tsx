"use client";

import "./status.css";

import { useState } from "react";

import { SheetBox } from "@/components/party/sheet-ui";

import { useSheet, type CharacterStatus } from "../sheet-context";

// Status controls (Active / Dead / Retired) at the end of page 1, owner and GM only. Restyled by S9.

const STATUS_LABEL: Record<CharacterStatus, string> = { active: "Active", dead: "Dead", retired: "Retired" };

export function StatusControls() {
  const { character, canEdit, setStatus } = useSheet();
  const [confirm, setConfirm] = useState<CharacterStatus | null>(null);
  if (!canEdit) return null;
  return (
    <SheetBox title="Status">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Character status">
        {(Object.keys(STATUS_LABEL) as CharacterStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`cs-pill ${character.status === s ? "cs-solid" : ""}`}
            aria-pressed={character.status === s}
            onClick={() => (s === "active" || s === character.status ? void setStatus(s) : setConfirm(s))}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {confirm ? (
        <div role="alertdialog" aria-label={`Confirm ${STATUS_LABEL[confirm].toLowerCase()}`} className="cs-take">
          <p className="cs-small m-0">
            Mark {character.sheet.name} as {STATUS_LABEL[confirm].toLowerCase()}? You can set them active again later.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="cs-pill cs-solid"
              onClick={() => {
                void setStatus(confirm);
                setConfirm(null);
              }}
            >
              Mark {STATUS_LABEL[confirm].toLowerCase()}
            </button>
            <button type="button" className="cs-pill" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </SheetBox>
  );
}
