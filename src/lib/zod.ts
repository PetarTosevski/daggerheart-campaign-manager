// Zod for app code: `import * as z from "<relative>/zod"` (or "@/lib/zod") instead of `import { z } from "zod"`.
//
// Why (dcm-uh6r): `import { z } from "zod"` hands esbuild zod's whole namespace object, so every Convex function bundle
// that touches a schema carried all of zod, its JSON-schema code and its ~40 locales (~440 KB, ~30 ms to load per
// uncached call). A namespace import of this module lets esbuild keep only the parts a bundle uses (~110 KB).
//
// The English messages zod sets up as a side effect of its full namespace are configured here instead, so error text
// stays the same ("Invalid input: expected string, received number"). This file is listed under "sideEffects" in
// src/lib/package.json so bundlers keep the `config` call.
import { config } from "zod";
import { en } from "zod/locales";

config(en());

export * from "zod";
