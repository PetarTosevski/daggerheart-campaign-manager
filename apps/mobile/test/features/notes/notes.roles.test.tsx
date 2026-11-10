import { beforeEach, expect, test } from "@jest/globals";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { JournalsList } from "../../../src/features/notes/journals";
import { JournalDataProvider } from "../../../src/features/journal/data";
import type { NotesSlotProps } from "../../../src/features/notes/slots";
import { renderAsGm, renderAsPlayer } from "../../harness";
import type { Id } from "../../../src/convex";

beforeEach(() => {
  resetMotionTest();
});

const campaignId = "campaign-1" as Id<"campaigns">;

const baseSlot: Omit<NotesSlotProps, "access"> = {
  campaignId,
  journalId: null,
  pageId: null,
  view: "page",
  search: "",
  matchingPageIds: null,
  onPage: () => undefined,
  onView: () => undefined,
  onSearch: () => undefined,
};

function journalsTree(isGm: boolean) {
  const slot: NotesSlotProps = { ...baseSlot, access: { isGm } };
  return (
    <JournalDataProvider campaignId={campaignId}>
      <JournalsList {...slot} />
    </JournalDataProvider>
  );
}

test("a player journals list never subscribes to playerJournals", async () => {
  const screen = await renderAsPlayer(journalsTree(false), {
    queries: {
      "notesJournals:pastJournals": [],
    },
  });
  expect(screen.client.subscribed).not.toContain("notesJournals:playerJournals");
  expect(screen.client.subscribed).toContain("notesJournals:pastJournals");
});

test("the GM journals list subscribes to playerJournals", async () => {
  const screen = await renderAsGm(journalsTree(true), {
    queries: {
      "notesJournals:playerJournals": [{ journalId: "j-1", name: "Ash", sub: "Player journal · Druid", pageCount: 2 }],
      "notesJournals:pastJournals": [],
    },
  });
  expect(screen.client.subscribed).toContain("notesJournals:playerJournals");
});
