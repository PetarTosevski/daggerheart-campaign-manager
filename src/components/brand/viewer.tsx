"use client";

import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Who is looking, for the glass buttons' colours (glass-button.css): the GM confirms in Fear and backs out in Hope, a
 * player the other way round. The campaign shell puts `data-viewer` on its root element and provides the value here,
 * so every page and native `<dialog>` inside a campaign inherits it from the DOM. Outside a campaign there is no
 * viewer and the player's colours apply.
 */
export type Viewer = "gm" | "player";

/** The viewer of a campaign member's role: the GM is "gm", everyone else "player". */
export function viewerFor(role: string): Viewer {
  return role === "gm" ? "gm" : "player";
}

const ViewerContext = createContext<Viewer | null>(null);

/** Provides the viewer to portalled content (the campaign shell wraps its pages in it). */
export function ViewerProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

/** The current viewer, or null outside a campaign. */
export function useViewer(): Viewer | null {
  return useContext(ViewerContext);
}

/**
 * Content rendered outside the shell's DOM (`createPortal(…, document.body)`) loses the inherited `data-viewer`; wrap
 * it in this to give it back. `display: contents`, so it adds no box. Outside a campaign it adds no attribute.
 */
export function ViewerScope({ children, className }: { children: ReactNode; className?: string }) {
  const viewer = useViewer();
  return (
    <div data-viewer={viewer ?? undefined} className={cn("contents", className)}>
      {children}
    </div>
  );
}
