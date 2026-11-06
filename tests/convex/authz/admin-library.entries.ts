import { api } from "../../../convex/_generated/api";
import type { TableNames } from "../../../convex/_generated/dataModel";
import type { Area } from "./harness";

/**
 * Authz matrix: the shared book library (plan config AD8, docs/tasks/TASK-CONFIG-AD8.md). Every function is the app
 * owner's only: every other role, the campaign's GM included, is refused. The owner's `ingest` row gets a stored file
 * with no recorded type (convex-test records none), so it is refused as a result (`BOOK_NOT_PDF`): access granted.
 */
const area: Area = {
  area: "admin-library",
  setup: async (w) => {
    const storageId = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4"])));
    w.set("pdfStorageId", storageId);
    // `use` is typed for user tables; synthesis looks the chosen id up before touching the table.
    w.use("_storage" as TableNames, storageId);
  },
  entries: [
    { fn: api.adminLibrary.list, access: "appOwner" },
    { fn: api.adminLibrary.ingestStatus, access: "appOwner", args: () => ({ bookKey: "core" }) },
    { fn: api.adminLibrary.uploadUrl, access: "appOwner" },
    {
      fn: api.adminLibrary.ingest,
      access: "appOwner",
      args: (w) => ({ storageId: w.ids.pdfStorageId, bookKey: "core", firstPrintedPage: 1 }),
    },
  ],
};
export default area;
