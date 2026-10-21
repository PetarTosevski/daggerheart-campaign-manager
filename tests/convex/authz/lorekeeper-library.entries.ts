import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the Lorekeeper's library (D13 L2, docs/tasks/TASK-D13-L2.md). Members (view) read the library and a
 * page of an enabled book; only the GM switches books. The setup inserts a core book with one chunk on page 2 (books
 * and chunks have no public writer: the ingest is internal).
 */
const area: Area = {
  area: "lorekeeper-library",
  setup: async (w) => {
    const bookId = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("lorekeeperBooks", {
        key: "core",
        title: "Core",
        subtitle: "Rules",
        cover: "core",
        pages: 1,
        chunkCount: 1,
        ingestedAt: 0,
        schemaVersion: 1,
      });
      await ctx.db.insert("lorekeeperChunks", { bookId: id, page: 2, section: "Rules → Dice", text: "Invented rule text.", ord: 0 });
      return id;
    });
    w.set("bookId", bookId);
  },
  entries: [
    { fn: api.lorekeeperLibrary.list, access: "view", expect: { otherPlayer: "ok" } },
    { fn: api.lorekeeperLibrary.pageText, access: "view", args: () => ({ page: 2 }), expect: { otherPlayer: "ok" } },
    { fn: api.lorekeeperLibrary.setEnabled, access: "gm", args: () => ({ enabled: false }), expect: { otherPlayer: "FORBIDDEN" } },
  ],
  pending: [],
};
export default area;
