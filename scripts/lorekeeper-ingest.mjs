#!/usr/bin/env node
/**
 * `pnpm lorekeeper:ingest <bookKey> <textFile> [--pages a-b]`: loads a rulebook's extracted text into the
 * Lorekeeper's library on a Convex deployment (D13, Q1, Q6). The text stays on your machine and in your deployment,
 * never in git.
 *
 * D13 L0 ships the usage message only; tracer L2 implements the ingest.
 */
const USAGE = `Usage: pnpm lorekeeper:ingest <bookKey> <textFile> [--pages a-b]

  bookKey   core | hopeFear | frame:<frameId>
  textFile  text extracted from your own PDF (for example with pdftotext), kept outside the repository
  --pages   only these printed pages (a frame book from the core rulebook)

Not implemented yet: the ingest lands with D13 tracer L2.`;

console.log(USAGE);
process.exit(process.argv.length > 2 ? 1 : 0);
