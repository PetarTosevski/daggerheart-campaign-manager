"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import {
  CheckCircle2,
  Construction,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";

import {
  updateCharacterAction,
  type CharacterActionState,
} from "@/app/(app)/characters/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CharacterSheetTab } from "@/components/character-sheet/character-sheet-tab";
import type { CharacterSheetRuntimeData } from "@/lib/data/character-sheet";
import type { CharacterWorkspaceData } from "@/lib/data/characters";
import {
  CHARACTER_STATUSES,
  CHARACTER_WORKSPACE_SECTIONS,
  DEFAULT_WORKSPACE_SECTION,
  type CharacterWorkspaceSectionKey,
} from "@/lib/domain/characters";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { CHARACTER_NOTES_MAX_LENGTH } from "@/lib/validation/characters";

const initialState: CharacterActionState = { status: "idle" };
const fieldClassName =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:cursor-not-allowed disabled:opacity-60";

function StatusMessage({ state }: { state: CharacterActionState }) {
  if (state.status === "idle") {
    return null;
  }
  return (
    <div
      role={state.status === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
        state.status === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {state.status === "success" ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{state.message}</span>
    </div>
  );
}

export function CharacterWorkspace({
  data,
  sheetData,
}: {
  data: CharacterWorkspaceData;
  sheetData: CharacterSheetRuntimeData | null;
}) {
  const hydrated = useHydrated();
  const { character } = data;

  const [section, setSection] = useState<CharacterWorkspaceSectionKey>(
    DEFAULT_WORKSPACE_SECTION,
  );

  // Shared editable state so the Overview and Notes forms never clobber each
  // other: each submits the full set through the single update path.
  const [name, setName] = useState(character.name);
  const [status, setStatus] = useState(character.status);
  const [notes, setNotes] = useState(character.notes ?? "");

  const [overviewState, saveOverview, overviewPending] = useActionState(
    updateCharacterAction,
    initialState,
  );
  const [notesState, saveNotes, notesPending] = useActionState(
    updateCharacterAction,
    initialState,
  );

  useEffect(() => {
    if (overviewState.status === "success" || notesState.status === "success") {
      window.location.reload();
    }
  }, [overviewState, notesState]);

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Character sections" className="lg:sticky lg:top-24 lg:self-start">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {CHARACTER_WORKSPACE_SECTIONS.map((item) => {
            const active = item.key === section;
            return (
              <li key={item.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setSection(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-700/40",
                    active
                      ? "bg-[#3f1e25] text-amber-50"
                      : "text-stone-600 hover:bg-stone-900/5 hover:text-stone-900",
                  ].join(" ")}
                >
                  <span>{item.label}</span>
                  {!item.implemented ? (
                    <span
                      className={`text-[10px] font-semibold tracking-wide uppercase ${
                        active ? "text-amber-200/80" : "text-stone-400"
                      }`}
                    >
                      Soon
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0">
        {section === "overview" ? (
          <div className="space-y-6">
            <Card className="border-stone-200 bg-white/90">
              <CardHeader>
                <CardTitle className="text-lg">Overview</CardTitle>
                <CardDescription>
                  Edit the character&apos;s identity and status. Class and
                  template are fixed at creation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
                      Class
                    </dt>
                    <dd className="mt-1 text-sm text-stone-900">
                      {data.class?.name ?? (
                        <span className="text-stone-400">No class</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
                      Sheet template
                    </dt>
                    <dd className="mt-1 text-sm text-stone-900">
                      {data.template?.name ?? (
                        <span className="text-stone-400">No template</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <form action={saveOverview} className="space-y-4">
                  <input
                    type="hidden"
                    name="characterId"
                    value={character.id}
                  />
                  <input type="hidden" name="notes" value={notes} />

                  <div className="space-y-1.5">
                    <label
                      htmlFor="overview-name"
                      className="text-sm font-medium text-stone-800"
                    >
                      Name
                    </label>
                    <input
                      id="overview-name"
                      name="name"
                      required
                      maxLength={100}
                      disabled={overviewPending}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className={fieldClassName}
                      aria-invalid={Boolean(overviewState.fieldErrors?.name)}
                    />
                    {overviewState.fieldErrors?.name?.[0] ? (
                      <p className="text-xs text-red-700">
                        {overviewState.fieldErrors.name[0]}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="overview-status"
                      className="text-sm font-medium text-stone-800"
                    >
                      Status
                    </label>
                    <select
                      id="overview-status"
                      name="status"
                      disabled={overviewPending}
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                      className={fieldClassName}
                    >
                      {CHARACTER_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {value[0].toUpperCase() + value.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <StatusMessage state={overviewState} />

                  <Button
                    type="submit"
                    disabled={!hydrated || overviewPending}
                    className="bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
                  >
                    {overviewPending ? (
                      <LoaderCircle className="animate-spin" />
                    ) : null}
                    {overviewPending ? "Saving…" : "Save overview"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {section === "notes" ? (
          <Card className="border-stone-200 bg-white/90">
            <CardHeader>
              <CardTitle className="text-lg">Notes</CardTitle>
              <CardDescription>
                Private GM notes for this character. Saved to the campaign.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={saveNotes} className="space-y-4">
                <input type="hidden" name="characterId" value={character.id} />
                <input type="hidden" name="name" value={name} />
                <input type="hidden" name="status" value={status} />

                <div className="space-y-1.5">
                  <label htmlFor="character-notes" className="sr-only">
                    Notes
                  </label>
                  <Textarea
                    id="character-notes"
                    name="notes"
                    maxLength={CHARACTER_NOTES_MAX_LENGTH}
                    disabled={notesPending}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="min-h-48 border-stone-300 bg-white text-stone-900"
                    placeholder="Record plot hooks, secrets, and reminders."
                  />
                </div>

                <StatusMessage state={notesState} />

                <Button
                  type="submit"
                  disabled={!hydrated || notesPending}
                  className="bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
                >
                  {notesPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : null}
                  {notesPending ? "Saving…" : "Save notes"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {section === "sheet" ? <CharacterSheetTab data={sheetData} /> : null}

        {section !== "overview" &&
        section !== "notes" &&
        section !== "sheet" ? (
          <PlaceholderSection sectionKey={section} />
        ) : null}
      </div>
    </div>
  );
}

function PlaceholderSection({
  sectionKey,
}: {
  sectionKey: CharacterWorkspaceSectionKey;
}) {
  const label =
    CHARACTER_WORKSPACE_SECTIONS.find((item) => item.key === sectionKey)
      ?.label ?? "Section";

  return (
    <Card className="border-dashed border-stone-300 bg-white/60">
      <CardHeader>
        <div className="flex items-center gap-2 text-stone-500">
          <Construction className="size-4" />
          <Badge
            variant="outline"
            className="border-stone-300 bg-stone-100 text-stone-600"
          >
            Coming soon
          </Badge>
        </div>
        <CardTitle className="mt-1 text-lg text-stone-800">{label}</CardTitle>
        <CardDescription>
          {label} is planned for a future task and is intentionally not yet
          implemented.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
