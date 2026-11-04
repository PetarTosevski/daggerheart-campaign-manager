"use client";

import { useMutation, useQuery } from "convex/react";
import { X } from "lucide-react";
import { Component, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";

export const UPLOAD_REJECTED = "That file isn't a real PNG/JPEG/WebP/GIF image, so it was removed.";

type Props = {
  /** The upload screen's file kind. */
  kind: Doc<"uploadNotices">["kind"];
  /** The id the screen knows: the character (portrait), codex entry, combat map, sprite pack, else the campaign (`uploadNotices.scope`). */
  scope: string;
  className?: string;
};

/**
 * Tells the uploader that the server's byte check removed their file (dcm-vqs0): one line per notice until they
 * dismiss it. Shows nothing while there is none, and nothing if the notices fail to load (its own error boundary,
 * rule 11: a broken notice must not take the upload screen with it).
 */
export function UploadNotice(props: Props) {
  return (
    <NoticeBoundary>
      <Notices {...props} />
    </NoticeBoundary>
  );
}

function Notices({ kind, scope, className }: Props) {
  const notices = useQuery(api.uploadNotices.mine, { kind, scope });
  const dismiss = useMutation(api.uploadNotices.dismiss).withOptimisticUpdate((store, { noticeId }) => {
    for (const { args, value } of store.getAllQueries(api.uploadNotices.mine))
      if (value !== undefined)
        store.setQuery(
          api.uploadNotices.mine,
          args,
          value.filter((n) => n._id !== noticeId),
        );
  });
  if (!notices || notices.length === 0) return null;
  return (
    <div role="alert" className={cn("flex flex-col gap-1", className)}>
      {notices.map((notice) => (
        <p
          key={notice._id}
          className="m-0 flex items-start gap-2 rounded-[8px] border border-danger-line bg-danger-bg px-2.5 py-1.5 text-[13px] text-danger"
        >
          <span className="flex-1">{UPLOAD_REJECTED}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-current hover:bg-white/10"
            onClick={() => void dismiss({ noticeId: notice._id })}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </p>
      ))}
    </div>
  );
}

class NoticeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Upload notices failed to load", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
