import type { NotesSlotProps } from "./slots";
import { NotesSlotBoundary } from "./query-boundary";
import { BinView } from "./bin";
import { JournalPage } from "./page";
import { SharedPageView } from "./shared";
import { JournalView } from "./journals";
import { ThreadsView } from "./threads";

export function PaperColumn(slot: NotesSlotProps) {
  switch (slot.view) {
    case "threads":
      return (
        <NotesSlotBoundary label="Open threads">
          <ThreadsView {...slot} />
        </NotesSlotBoundary>
      );
    case "shared-players":
    case "shared-gm":
      return (
        <NotesSlotBoundary label="The shared page">
          <SharedPageView {...slot} />
        </NotesSlotBoundary>
      );
    case "journal":
      return (
        <NotesSlotBoundary label="The journal">
          <JournalView {...slot} />
        </NotesSlotBoundary>
      );
    case "bin":
      return (
        <NotesSlotBoundary label="The torn-out page">
          <BinView {...slot} />
        </NotesSlotBoundary>
      );
    case "page":
      return (
        <NotesSlotBoundary label="The page">
          <JournalPage {...slot} />
        </NotesSlotBoundary>
      );
  }
}
