"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Modal dialog on the native <dialog> element: focus trapping, Escape and the
 * backdrop come from the browser. Styled like the boards' Settings dialog.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-32px)] max-w-[620px] rounded-2xl border border-line-2 bg-[#15131d] p-7 text-parchment shadow-[0_24px_70px_rgba(0,0,0,0.6)]",
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col gap-[22px]">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="m-0 font-display text-[30px] font-bold tracking-[0.06em]">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title.toLowerCase()}`}
              className="flex size-11 flex-none cursor-pointer items-center justify-center rounded-full border border-line-2 hover:bg-raised"
            >
              <X className="size-[18px]" aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
