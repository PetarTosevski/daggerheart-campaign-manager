"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  Archive,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Pencil,
  TriangleAlert,
  Upload,
} from "lucide-react";

import {
  archiveTemplateVersionAction,
  uploadTemplateVersionAction,
  type TemplateVersionActionState,
} from "@/app/(app)/characters/templates/actions";
import { PdfTemplateViewer } from "@/components/sheet-templates/pdf-template-viewer";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  SheetTemplateDetailData,
  TemplateVersionSummary,
} from "@/lib/data/sheet-templates";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { cn } from "@/lib/utils";

const initialState: TemplateVersionActionState = { status: "idle" };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TemplateManager({
  data,
}: {
  data: SheetTemplateDetailData;
}) {
  const hydrated = useHydrated();
  const { template, versions, activeVersion } = data;

  const [uploadState, uploadAction, uploadPending] = useActionState(
    uploadTemplateVersionAction,
    initialState,
  );

  useEffect(() => {
    if (uploadState.status === "success") {
      window.location.reload();
    }
  }, [uploadState]);

  return (
    <div className="space-y-6">
      <Card className="border-stone-200/80 bg-white/90">
        <CardHeader>
          <div className="flex items-center gap-2 text-amber-800">
            <Upload className="size-4" />
            <span className="text-xs font-semibold tracking-[0.16em] uppercase">
              Upload PDF
            </span>
          </div>
          <CardTitle className="text-lg text-stone-900">
            New template version
          </CardTitle>
          <CardDescription>
            Upload a PDF (max 25 MB). Each upload creates a new immutable version
            and becomes the active preview. Existing versions are never
            overwritten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {template.status === "active" ? (
            <form action={uploadAction} className="space-y-4">
              <input type="hidden" name="templateId" value={template.id} />
              <input
                type="file"
                name="file"
                accept="application/pdf"
                required
                disabled={uploadPending}
                className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#3f1e25] file:px-3 file:py-2 file:text-sm file:font-medium file:text-amber-50 hover:file:bg-[#542832] disabled:opacity-60"
              />

              {uploadState.status !== "idle" ? (
                <div
                  role={uploadState.status === "error" ? "alert" : "status"}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                    uploadState.status === "error"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {uploadState.status === "success" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span>{uploadState.message}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={!hydrated || uploadPending}
                className="bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
              >
                {uploadPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Upload />
                )}
                {uploadPending ? "Uploading…" : "Upload version"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-stone-500">
              This template is archived. Restore it before uploading new
              versions.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-lg text-stone-900">Preview</CardTitle>
          <CardDescription>
            {activeVersion
              ? `Active version ${activeVersion.version_number} · ${activeVersion.page_count} page${
                  activeVersion.page_count === 1 ? "" : "s"
                }`
              : "No active version yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeVersion?.signedUrl ? (
            <PdfTemplateViewer
              signedUrl={activeVersion.signedUrl}
              pageCount={activeVersion.page_count}
              label={template.name}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
              <FileText className="mx-auto size-8 text-stone-400" />
              <p className="mt-3 font-medium text-stone-800">
                No PDF to preview
              </p>
              <p className="mt-1 text-sm text-stone-500">
                Upload a PDF to render its pages here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {versions.length > 0 ? (
        <Card className="border-stone-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-lg text-stone-900">Versions</CardTitle>
            <CardDescription>
              Every uploaded version is retained. The active version cannot be
              deleted while it is in use.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-stone-200">
              {versions.map((version) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  templateId={template.id}
                  isActive={version.id === template.active_version_id}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function VersionRow({
  version,
  templateId,
  isActive,
}: {
  version: TemplateVersionSummary;
  templateId: string;
  isActive: boolean;
}) {
  const hydrated = useHydrated();
  const [state, archiveAction, pending] = useActionState(
    archiveTemplateVersionAction,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") {
      window.location.reload();
    }
  }, [state]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-stone-900">
            Version {version.version_number}
          </span>
          {isActive ? (
            <Badge
              variant="outline"
              className="border-emerald-700/20 bg-emerald-50 text-emerald-800"
            >
              Active
            </Badge>
          ) : null}
          {version.status === "archived" ? (
            <Badge
              variant="outline"
              className="border-stone-300 bg-stone-100 text-stone-500"
            >
              Archived
            </Badge>
          ) : null}
          {version.layout_status === "published" ? (
            <Badge
              variant="outline"
              className="border-sky-700/20 bg-sky-50 text-sky-800"
            >
              Published
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-700/20 bg-amber-50 text-amber-800"
            >
              Draft
            </Badge>
          )}
        </div>
        <p className="truncate text-sm text-stone-500">
          {version.original_filename} · {version.page_count} page
          {version.page_count === 1 ? "" : "s"} · {formatBytes(version.size_bytes)}
        </p>
        {state.status === "error" ? (
          <p className="mt-1 text-xs text-red-700">{state.message}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/characters/templates/${templateId}/edit/${version.id}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "border-stone-300",
          )}
        >
          <Pencil className="size-3.5" />
          {version.layout_status === "published" ? "Open editor" : "Edit fields"}
        </Link>
        {version.status === "active" ? (
          <form action={archiveAction}>
            <input type="hidden" name="versionId" value={version.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!hydrated || pending}
              className="border-stone-300"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Archive />
              )}
              Archive
            </Button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
