import { Migrations } from "@convex-dev/migrations";

import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

/**
 * The one `Migrations` instance (CD5). Define each data migration with
 * `migrations.define` in `convex/migrations/<domain>.ts` (batched,
 * resumable, idempotent) and run it through `convex/migrations/run.ts`, which
 * documents dry run, resume and status.
 */
export const migrations = new Migrations<DataModel>(components.migrations);
