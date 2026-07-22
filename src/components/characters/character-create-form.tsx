"use client";

import { useState } from "react";
import { useActionState } from "react";
import { LoaderCircle, TriangleAlert, UserPlus } from "lucide-react";

import {
  createCharacterAction,
  type CharacterActionState,
} from "@/app/(app)/characters/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  CharacterClassOption,
  SheetTemplateOption,
} from "@/lib/data/characters";
import { suggestTemplateId } from "@/lib/domain/characters";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { CHARACTER_NOTES_MAX_LENGTH } from "@/lib/validation/characters";

const initialState: CharacterActionState = { status: "idle" };
const fieldClassName =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:cursor-not-allowed disabled:opacity-60";

const NO_TEMPLATE_VALUE = "";

export function CharacterCreateForm({
  campaignId,
  classes,
  templates,
}: {
  campaignId: string;
  classes: CharacterClassOption[];
  templates: SheetTemplateOption[];
}) {
  const hydrated = useHydrated();
  const [state, formAction, pending] = useActionState(
    createCharacterAction,
    initialState,
  );

  const initialClassId = classes[0]?.id ?? "";
  const [name, setName] = useState("");
  const [classId, setClassId] = useState<string>(initialClassId);
  const [templateId, setTemplateId] = useState<string>(
    () =>
      suggestTemplateId(
        classes.find((option) => option.id === initialClassId) ?? null,
        templates,
      ) ?? "",
  );

  const selectedClass =
    classes.find((option) => option.id === classId) ?? null;

  // When the class changes, re-suggest its default template (falling back to the
  // blank template). Doing this in the change handler keeps the suggestion in
  // sync without a state-syncing effect. The GM can still override it below.
  function handleClassChange(nextClassId: string) {
    setClassId(nextClassId);
    const nextClass =
      classes.find((option) => option.id === nextClassId) ?? null;
    setTemplateId(suggestTemplateId(nextClass, templates) ?? "");
  }

  const selectedTemplate = templates.find((option) => option.id === templateId);
  const suggestedId = suggestTemplateId(selectedClass, templates) ?? "";
  const isOverridden = templateId !== suggestedId;

  if (classes.length === 0) {
    return (
      <Card className="border-stone-200 bg-white/85">
        <CardHeader>
          <CardTitle className="text-xl">No classes available</CardTitle>
          <CardDescription>
            A character needs an active class before it can be created. Classes
            are seeded per campaign; add one to this campaign to begin.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-stone-200/80 bg-white/90 shadow-[0_18px_55px_-38px_rgba(41,37,36,0.5)]">
      <CardHeader>
        <div className="flex items-center gap-2 text-amber-800">
          <UserPlus className="size-4" />
          <span className="text-xs font-semibold tracking-[0.16em] uppercase">
            New character
          </span>
        </div>
        <CardTitle className="text-xl text-stone-900">Create a character</CardTitle>
        <CardDescription>
          Set the identity, choose a class, and confirm the suggested sheet
          template. You can override the template before creating.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="campaignId" value={campaignId} />

          {/* Step 1 — Identity */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
              1 · Identity
            </legend>
            <label
              htmlFor="character-name"
              className="text-sm font-medium text-stone-800"
            >
              Name
            </label>
            <input
              id="character-name"
              name="name"
              required
              maxLength={100}
              disabled={pending}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={fieldClassName}
              placeholder="Kodak the Steadfast"
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
            {state.fieldErrors?.name?.[0] ? (
              <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>
            ) : null}
          </fieldset>

          {/* Step 2 — Class selection */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
              2 · Class
            </legend>
            <label
              htmlFor="character-class"
              className="text-sm font-medium text-stone-800"
            >
              Class
            </label>
            <select
              id="character-class"
              name="classId"
              required
              disabled={pending}
              value={classId}
              onChange={(event) => handleClassChange(event.target.value)}
              className={fieldClassName}
              aria-invalid={Boolean(state.fieldErrors?.classId)}
            >
              {classes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            {selectedClass?.description ? (
              <p className="text-xs text-stone-500">{selectedClass.description}</p>
            ) : null}
            {state.fieldErrors?.classId?.[0] ? (
              <p className="text-xs text-red-700">
                {state.fieldErrors.classId[0]}
              </p>
            ) : null}
          </fieldset>

          {/* Step 3 — Template suggestion (overridable) */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
              3 · Sheet template
            </legend>
            <label
              htmlFor="character-template"
              className="text-sm font-medium text-stone-800"
            >
              Template{" "}
              {isOverridden ? (
                <span className="font-normal text-amber-700">(overridden)</span>
              ) : (
                <span className="font-normal text-stone-500">(suggested)</span>
              )}
            </label>
            <select
              id="character-template"
              name="sheetTemplateId"
              disabled={pending || templates.length === 0}
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className={fieldClassName}
            >
              <option value={NO_TEMPLATE_VALUE}>No template</option>
              {templates.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.is_blank_template ? " · blank" : ""}
                  {option.id === suggestedId ? " · suggested" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-stone-500">
              A character keeps this template permanently. Later class or template
              changes will not alter it.
            </p>
          </fieldset>

          {/* Notes */}
          <div className="space-y-1.5">
            <label
              htmlFor="character-notes"
              className="text-sm font-medium text-stone-800"
            >
              Notes <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <Textarea
              id="character-notes"
              name="notes"
              maxLength={CHARACTER_NOTES_MAX_LENGTH}
              disabled={pending}
              className="min-h-20 border-stone-300 bg-white text-stone-900"
              placeholder="Private GM notes about this character."
            />
          </div>

          {/* Step 4 — Review */}
          <div className="rounded-lg border border-stone-200 bg-stone-50/70 px-4 py-3">
            <p className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
              4 · Review
            </p>
            <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-stone-500">Name</dt>
              <dd className="text-stone-900">
                {name.trim() || (
                  <span className="text-stone-400">Not set</span>
                )}
              </dd>
              <dt className="text-stone-500">Class</dt>
              <dd className="text-stone-900">
                {selectedClass?.name ?? (
                  <span className="text-stone-400">Not set</span>
                )}
              </dd>
              <dt className="text-stone-500">Template</dt>
              <dd className="text-stone-900">
                {selectedTemplate?.name ?? (
                  <span className="text-stone-400">No template</span>
                )}
              </dd>
            </dl>
          </div>

          {state.status === "error" ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{state.message}</span>
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={!hydrated || pending}
            className="w-full bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
          >
            {pending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <UserPlus />
            )}
            {pending ? "Creating…" : "Create character"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
