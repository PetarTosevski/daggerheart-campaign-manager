import { api } from "../../../convex/_generated/api";
import type { TableNames } from "../../../convex/_generated/dataModel";
import type { Area } from "./harness";

/**
 * Authz matrix: a campaign's own books (config LB1, docs/tasks/TASK-CONFIG-LB1.md). The GM and co-GMs (N7 a) list,
 * upload and remove; players are refused. The setup stores a file with no recorded type (convex-test records none),
 * so a granted `add` is refused as a result (`BOOK_NOT_PDF`): access granted. It also inserts one book of the world's
 * campaign for `remove`.
 */
const area: Area = {
  area: "config-books",
  setup: async (w) => {
    const ids = await w.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["%PDF-1.4"]));
      const bookId = await ctx.db.insert("lorekeeperBooks", {
        key: `campaign:${w.campaignId}:1`,
        title: "The Salt Roads",
        subtitle: "Uploaded by the GM",
        cover: "frame",
        pages: 1,
        chunkCount: 1,
        ingestedAt: 0,
        schemaVersion: 1,
        campaignId: w.campaignId,
        uploadedBy: w.users.gm,
        sizeBytes: 100,
      });
      await ctx.db.insert("lorekeeperChunks", { bookId, page: 1, section: "Roads", text: "Invented road text.", ord: 0 });
      return { storageId, bookId };
    });
    w.set("pdfStorageId", ids.storageId);
    // `use` is typed for user tables; synthesis looks the chosen id up before touching the table.
    w.use("_storage" as TableNames, ids.storageId);
    w.set("campaignBookId", ids.bookId);
  },
  entries: [
    { fn: api.campaignBooks.list, access: "gm", expect: { otherPlayer: "FORBIDDEN" } },
    { fn: api.campaignBooks.uploadUrl, access: "gm", expect: { otherPlayer: "FORBIDDEN" } },
    {
      fn: api.campaignBooks.add,
      access: "gm",
      args: (w) => ({ storageId: w.ids.pdfStorageId, title: "The Salt Roads", firstPrintedPage: 1 }),
      expect: { otherPlayer: "FORBIDDEN" },
    },
    {
      fn: api.campaignBooks.remove,
      access: "gm",
      args: (w) => ({ bookId: w.ids.campaignBookId }),
      expect: { otherPlayer: "FORBIDDEN" },
    },
  ],
};
export default area;
