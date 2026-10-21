import type { Area } from "./harness";

/** Authz matrix: notes (notes, notesBin, notesEntries, notesJournals, notesSharing, notesThreads). Filled by tracer H13 (.omc/plans/d12-hardening.yaml). */
const area: Area = {
  area: "notes",
  entries: [],
  pending: [
    "notes:createPage",
    "notes:cycleTape",
    "notes:journal",
    "notes:renamePage",
    "notes:setSession",
    "notesBin:bin",
    "notesBin:binPage",
    "notesBin:restorePage",
    "notesEntries:add",
    "notesEntries:cycle",
    "notesEntries:entries",
    "notesEntries:migrateOpen",
    "notesEntries:moveUp",
    "notesEntries:remove",
    "notesEntries:setText",
    "notesEntries:toggleStar",
    "notesJournals:journalView",
    "notesJournals:pastJournals",
    "notesJournals:playerJournals",
    "notesSharing:addRecipient",
    "notesSharing:recipients",
    "notesSharing:removeRecipient",
    "notesSharing:setVisibility",
    "notesSharing:shared",
    "notesThreads:exportPage",
    "notesThreads:search",
    "notesThreads:threads",
  ],
};

export default area;
