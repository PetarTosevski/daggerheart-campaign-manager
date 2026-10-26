#!/usr/bin/env node
/**
 * `pnpm lorekeeper:ingest <bookKey> <textFile> [options]`: loads a rulebook's extracted text into the Lorekeeper's
 * library on a Convex deployment (D13 L2; Q1, Q6). The text stays on your machine and in your deployment, never in
 * git: the script refuses files inside the repository (except tests/fixtures) and prints nothing of the text.
 *
 * Steps: chunk the text with the L1 chunker (src/lib/lorekeeper/chunk.ts), then through `convex run` (the Convex
 * CLI, with the deployment's admin rights: your login for .env.local's deployment, or CONVEX_DEPLOY_KEY) call the
 * internal mutations lorekeeperLibrary:ingestBook (register the book), :clearChunks (delete the old chunks, repeated)
 * and :ingestChunks (batches of at most 100 chunks). Re-running replaces the book's chunks. No public function can
 * write books or chunks.
 *
 * `--remove` (dcm-bxp.82.10) deletes a book instead, after a confirmation: :findBook, then :clearChunks (repeated),
 * :clearSwitches (every campaign's on/off switch, repeated) and :deleteBook.
 *
 * The deployment: .env.local's CONVEX_DEPLOYMENT by default (or CONVEX_DEPLOY_KEY when set); --prod,
 * --deployment <name> and --env-file <file> pass through to the CLI; --e2e targets the local e2e backend
 * (scripts/convex-e2e.mjs). The deployment must already run the D13 functions (`npx convex dev` / deploy).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const USAGE = `Usage: pnpm lorekeeper:ingest <bookKey> <textFile> [options]
       pnpm lorekeeper:ingest <bookKey> --remove [--yes] [target]

  bookKey   core | hopeFear | frame:<frameId> | houseRules
  textFile  text extracted from your own PDF ("===== PAGE N =====" blocks), kept outside the repository;
            not needed for houseRules (registers the 'House rules (notes)' switch only)

Options
  --pages a-b          only these printed pages (a frame book cut from the core rulebook);
                       frame:witherwild defaults to 254-261
  --title <text>       library name (default: the board's name for the key)
  --subtitle <text>    library subtitle
  --cover <token>      cover token (core | hopeFear | frame | houseRules)
  --dry-run            chunk and print the counts; send nothing
  --remove             delete the book (its text, every campaign's switch, its library row); asks first
  --yes                with --remove: skip the question (for scripts)
  --prod               the project's production deployment
  --deployment <name>  a named deployment
  --env-file <file>    read CONVEX_DEPLOYMENT / CONVEX_DEPLOY_KEY from this file instead of .env.local
  --e2e                the local e2e backend (.env.e2e.local, scripts/convex-e2e.mjs)

Examples
  pnpm lorekeeper:ingest core ~/books/core.txt
  pnpm lorekeeper:ingest hopeFear ~/books/hopefear.txt
  pnpm lorekeeper:ingest frame:witherwild ~/books/core.txt
  pnpm lorekeeper:ingest hopeFear --remove --prod`;

/** The plan's page range per frame book cut from the core rulebook (core pp. 254-261 = The Witherwild). */
/** @type {Record<string, PageRange>} */
export const FRAME_PAGES = { "frame:witherwild": { from: 254, to: 261 } };

/** Chunks per ingestChunks call (lorekeeperLibrary.INGEST_BATCH). */
export const BATCH_CHUNKS = 100;
/** JSON bytes per call: one command-line argument stays under Linux's 128 KiB MAX_ARG_STRLEN. */
export const BATCH_BYTES = 100_000;

const KEY_PATTERN = /^(core|hopeFear|houseRules|frame:[a-z0-9-]+)$/;

/**
 * @typedef {{ from: number, to: number }} PageRange
 * @typedef {{
 *   positional: string[], dryRun: boolean, e2e: boolean, cli: string[], help?: boolean, remove: boolean, yes: boolean,
 *   bookKey?: string, textFile?: string, pages?: PageRange, title?: string, subtitle?: string, cover?: string
 * }} IngestOptions
 * @typedef {{ page: number, section: string, text: string, ord: number }} ChunkRow
 */

/**
 * Parses the command line; throws an Error with a short message on misuse.
 * @param {string[]} argv
 * @returns {IngestOptions}
 */
export function parseArgs(argv) {
  /** @type {IngestOptions} */
  const opts = { positional: [], dryRun: false, e2e: false, cli: [], remove: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--pages") opts.pages = parsePages(value());
    else if (arg === "--title") opts.title = value();
    else if (arg === "--subtitle") opts.subtitle = value();
    else if (arg === "--cover") opts.cover = value();
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--e2e") opts.e2e = true;
    else if (arg === "--remove") opts.remove = true;
    else if (arg === "--yes") opts.yes = true;
    else if (arg === "--prod") opts.cli.push("--prod");
    else if (arg === "--deployment" || arg === "--env-file") opts.cli.push(arg, value());
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
    else opts.positional.push(arg);
  }
  if (opts.help) return opts;
  const [bookKey, textFile, ...rest] = opts.positional;
  if (!bookKey) throw new Error("Give a book key.");
  if (!KEY_PATTERN.test(bookKey)) throw new Error(`Unknown book key "${bookKey}".`);
  if (rest.length > 0) throw new Error("Too many arguments.");
  if (opts.e2e && opts.cli.length > 0) throw new Error("--e2e cannot be combined with --prod, --deployment or --env-file.");
  if (opts.yes && !opts.remove) throw new Error("--yes only goes with --remove.");
  if (opts.remove) {
    if (textFile) throw new Error("--remove takes no text file.");
    if (opts.dryRun || opts.pages || opts.title || opts.subtitle || opts.cover) {
      throw new Error("--remove cannot be combined with --dry-run, --pages, --title, --subtitle or --cover.");
    }
    opts.bookKey = bookKey;
    return opts;
  }
  if (bookKey !== "houseRules" && !textFile) throw new Error("Give the text file to ingest.");
  if (bookKey === "houseRules" && textFile) throw new Error("houseRules takes no text file (it reads the Notes tab).");
  opts.bookKey = bookKey;
  opts.textFile = textFile;
  opts.pages ??= FRAME_PAGES[bookKey];
  return opts;
}

/** "254-261" -> { from: 254, to: 261 }. */
export function parsePages(text) {
  const match = /^(\d+)-(\d+)$/.exec(text);
  if (!match) throw new Error(`--pages takes a range such as 254-261, not "${text}".`);
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from > to) throw new Error(`--pages ${text}: the first page comes after the last.`);
  return { from, to };
}

/** Whether `child` is `parent` or lies inside it. */
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Refuses a text file inside a repository root (book text never goes near git) unless it is under that root's
 * tests/fixtures (the invented test book). Returns the file's real path.
 */
export function checkTextPath(file, repoRoots) {
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const real = realpathSync(file);
  const inRepo = repoRoots.some((root) => inside(real, root));
  const inFixtures = repoRoots.some((root) => inside(real, path.join(root, "tests", "fixtures")));
  if (inRepo && !inFixtures) {
    throw new Error("Keep book text outside the repository (only tests/fixtures may hold test text).");
  }
  return real;
}

/**
 * Splits chunks into batches of at most `maxChunks` chunks and `maxBytes` bytes of JSON.
 * @template T
 * @param {T[]} chunks
 * @returns {T[][]}
 */
export function batches(chunks, maxChunks = BATCH_CHUNKS, maxBytes = BATCH_BYTES) {
  const out = [];
  let current = [];
  let bytes = 0;
  for (const chunk of chunks) {
    const size = Buffer.byteLength(JSON.stringify(chunk), "utf8") + 1;
    if (current.length > 0 && (current.length === maxChunks || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(chunk);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * The chunker's output as ingestChunks rows, and the number of printed pages they cover.
 * @param {ChunkRow[]} bookChunks
 * @returns {{ rows: ChunkRow[], pages: number }}
 */
export function toRows(bookChunks) {
  const rows = bookChunks.map(({ page, section, text, ord }) => ({ page, section, text, ord }));
  return { rows, pages: new Set(rows.map((row) => row.page)).size };
}

/** The JSON value `convex run` printed (it prints the function's return value last): an object, or null. */
export function parseRunOutput(stdout) {
  if (/(^|\n)null\s*$/.test(stdout)) return null;
  const start = stdout.indexOf("{");
  if (start === -1) throw new Error("convex run printed no result.");
  return JSON.parse(stdout.slice(start));
}

/** The repository roots: this checkout and, in a git worktree, the main checkout. */
function repoRoots(root) {
  const roots = [realpathSync(root)];
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const main = path.dirname(common);
    if (existsSync(main)) roots.push(realpathSync(main));
  } catch {
    // Not a git checkout: the script's own root is enough.
  }
  return roots;
}

/** Loads the L1 chunker (TypeScript, run by Node's type stripping) without Node's module-type notice. */
async function loadChunker(root) {
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const code = typeof rest[0] === "object" ? rest[0]?.code : rest[1];
    if (code === "MODULE_TYPELESS_PACKAGE_JSON" || String(warning).includes("Type Stripping")) return;
    emit.call(process, warning, ...rest);
  };
  try {
    return await import(pathToFileURL(path.join(root, "src", "lib", "lorekeeper", "chunk.ts")).href);
  } finally {
    process.emitWarning = emit;
  }
}

/** Runs one internal function through the Convex CLI and returns its result. */
function makeRunner(root, opts) {
  const require = createRequire(import.meta.url);
  const convexBin = path.join(path.dirname(require.resolve("convex/package.json")), "bin", "main.js");
  return (fn, args) => {
    const runArgs = ["run", fn, JSON.stringify(args), "--typecheck", "disable", "--codegen", "disable"];
    const argv = opts.e2e
      ? [path.join(root, "scripts", "convex-e2e.mjs"), ...runArgs]
      : [convexBin, ...runArgs, ...opts.cli];
    try {
      const stdout = execFileSync(process.execPath, argv, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return parseRunOutput(stdout);
    } catch (error) {
      const stderr = String(error.stderr ?? "").trim();
      throw new Error(`convex run ${fn} failed.${stderr ? `\n${stderr.slice(-2000)}` : ""}`);
    }
  };
}

/** Which deployment a run targets, in words, for the --remove question. */
export function targetLabel(opts) {
  if (opts.e2e) return "the local e2e backend";
  if (opts.cli.length > 0) return `the deployment chosen by ${opts.cli.join(" ")}`;
  return process.env.CONVEX_DEPLOY_KEY ? "the deployment of CONVEX_DEPLOY_KEY" : "the deployment in .env.local";
}

/**
 * `--remove`: finds the book, asks `confirm` (resolves true to go on), then deletes its chunks, every campaign's
 * switch and its row, each step repeated until done. `run` calls one internal function (makeRunner); `log` prints.
 * Returns the exit code.
 * @param {(fn: string, args: object) => any} run  sync (the CLI) or async (tests): each result is awaited
 * @param {string} bookKey
 * @param {(question: string) => Promise<boolean>} confirm
 * @param {string} target
 * @param {(line: string) => void} log
 */
export async function removeBook(run, bookKey, confirm, target, log = console.log) {
  const book = await run("lorekeeperLibrary:findBook", { bookKey });
  if (book === null) {
    log(`${bookKey}: no such book on ${target}. Nothing removed.`);
    return 1;
  }
  const ok = await confirm(
    `Remove "${book.title}" (${bookKey}, ${book.chunkCount} chunks) and every campaign's switch for it from ${target}? Type ${bookKey} to confirm: `,
  );
  if (!ok) {
    log("Cancelled. Nothing removed.");
    return 1;
  }
  let chunks = 0;
  for (;;) {
    const { deleted, done } = await run("lorekeeperLibrary:clearChunks", { bookId: book.bookId });
    chunks += deleted;
    if (done) break;
  }
  let switches = 0;
  let cursor = null;
  for (;;) {
    const page = await run("lorekeeperLibrary:clearSwitches", { bookId: book.bookId, cursor });
    switches += page.deleted;
    cursor = page.cursor;
    if (page.done) break;
  }
  await run("lorekeeperLibrary:deleteBook", { bookId: book.bookId });
  log(`Done: removed ${bookKey} (${chunks} chunks, ${switches} campaign switches).`);
  return 0;
}

/** Asks on the terminal; true only when the answer is exactly `expected`. */
async function askTerminal(question, expected) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim() === expected;
  } finally {
    rl.close();
  }
}

export async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  if (opts.help || argv.length === 0) {
    console.log(USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  if (opts.remove) {
    const bookKey = /** @type {string} */ (opts.bookKey);
    if (!opts.yes && !process.stdin.isTTY) {
      console.error("--remove asks for a confirmation on the terminal; add --yes to run it without one.");
      return 1;
    }
    const confirm = opts.yes ? async () => true : (question) => askTerminal(question, bookKey);
    return removeBook(makeRunner(root, opts), bookKey, confirm, targetLabel(opts));
  }

  let rows = [];
  let pages = 0;
  if (opts.textFile) {
    const file = checkTextPath(path.resolve(opts.textFile), repoRoots(root));
    const { chunkBook } = await loadChunker(root);
    const chunks = chunkBook(readFileSync(file, "utf8"), opts.pages ? { pages: opts.pages } : {});
    ({ rows, pages } = toRows(chunks));
    if (rows.length === 0) {
      console.error('No chunks: the file has no "===== PAGE N =====" blocks (or none in --pages).');
      return 1;
    }
  }
  const plan = batches(rows);
  const range = opts.pages ? ` (printed pages ${opts.pages.from}-${opts.pages.to})` : "";
  console.log(`${opts.bookKey}: ${rows.length} chunks over ${pages} pages${range}, ${plan.length} batches.`);
  if (opts.dryRun) return 0;

  const run = makeRunner(root, opts);
  if (opts.bookKey === "houseRules") {
    run("lorekeeperLibrary:ensureHouseRulesBook", {});
    console.log("Done: the 'House rules (notes)' switch is in every campaign's library (off until the GM turns it on).");
    return 0;
  }
  const { bookId } = run("lorekeeperLibrary:ingestBook", {
    bookKey: opts.bookKey,
    pages,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
    ...(opts.cover ? { cover: opts.cover } : {}),
  });
  let removed = 0;
  for (;;) {
    const { deleted, done } = run("lorekeeperLibrary:clearChunks", { bookId });
    removed += deleted;
    if (done) break;
  }
  if (removed > 0) console.log(`Removed ${removed} old chunks.`);
  let chunkCount = 0;
  for (const [i, batch] of plan.entries()) {
    ({ chunkCount } = run("lorekeeperLibrary:ingestChunks", { bookId, chunks: batch }));
    process.stdout.write(`\rSent batch ${i + 1}/${plan.length}`);
  }
  if (plan.length > 0) process.stdout.write("\n");
  console.log(`Done: ${opts.bookKey} has ${chunkCount} chunks.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
