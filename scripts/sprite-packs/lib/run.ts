/**
 * One import run: process the chosen folders, encode, and either write the
 * draft to the review folder (sprites:cut) or the WebPs and the manifest to
 * the repo (sprites:build). Both write the review report.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { builtinManifestSchema, type BuiltinManifest, MANIFEST_SCHEMA_VERSION } from "../../../src/lib/sprite-packs/manifest";
import { encodeItem, folderManifest, manifestSource, type Encoded } from "./encode";
import { MANIFEST_FILE, OVERRIDES_FILE, PUBLIC_DIR, type Options } from "./options";
import { loadOverrides } from "./overrides";
import { processFolder, type FolderResult, type Item } from "./pipeline";
import { writeReport } from "./report";

async function currentManifest(): Promise<BuiltinManifest> {
  if (!existsSync(MANIFEST_FILE)) return { schemaVersion: MANIFEST_SCHEMA_VERSION, folders: {} };
  const mod = (await import(pathToFileURL(MANIFEST_FILE).href)) as { BUILTIN_MANIFEST: BuiltinManifest };
  return builtinManifestSchema.parse(mod.BUILTIN_MANIFEST);
}

export async function run(opts: Options, mode: "cut" | "build"): Promise<void> {
  const started = Date.now();
  const overrides = loadOverrides(OVERRIDES_FILE);
  console.log(`sprites:${mode}: ${opts.folders.length} folder(s) from ${opts.src}`);
  const folders: FolderResult[] = [];
  const encoded = new Map<Item, Encoded>();
  for (const folder of opts.folders) {
    const t = Date.now();
    const result = await processFolder(opts.src, folder, overrides);
    for (const item of result.items) encoded.set(item, await encodeItem(item));
    folders.push(result);
    console.log(`  ${folder}: ${result.items.length} files, ${result.missing.length} missing (${Date.now() - t} ms)`);
  }

  const base = opts.partial ? await currentManifest() : { schemaVersion: MANIFEST_SCHEMA_VERSION, folders: {} };
  const manifest: BuiltinManifest = { schemaVersion: MANIFEST_SCHEMA_VERSION, folders: { ...base.folders } };
  for (const f of folders) {
    const sprites = folderManifest(f, encoded);
    if (sprites.length > 0) manifest.folders[f.folder] = sprites;
    else delete manifest.folders[f.folder];
  }
  // Keep catalog order across folders.
  const ordered: BuiltinManifest = { schemaVersion: MANIFEST_SCHEMA_VERSION, folders: {} };
  const { CATALOG } = await import("../../../src/lib/sprite-packs/catalog");
  for (const folder of Object.keys(CATALOG)) {
    const sprites = manifest.folders[folder];
    if (sprites) ordered.folders[folder] = sprites;
  }
  builtinManifestSchema.parse(ordered);

  if (mode === "build") {
    for (const f of folders) {
      const dir = join(PUBLIC_DIR, f.folder);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
    }
    if (!opts.partial && existsSync(PUBLIC_DIR))
      for (const name of readdirSync(PUBLIC_DIR)) if (!ordered.folders[name]) rmSync(join(PUBLIC_DIR, name), { recursive: true, force: true });
    for (const e of encoded.values()) writeFileSync(join(PUBLIC_DIR, e.file), e.bytes);
    mkdirSync(join(MANIFEST_FILE, ".."), { recursive: true });
    writeFileSync(MANIFEST_FILE, manifestSource(ordered));
  } else {
    mkdirSync(opts.out, { recursive: true });
    writeFileSync(join(opts.out, "manifest-draft.json"), `${JSON.stringify(ordered, null, 2)}\n`);
  }

  const { summary, contactSheets } = await writeReport({ out: opts.out, folders, encoded, built: mode === "build" });
  console.log(summary.join("\n"));
  console.log(`report: ${join(opts.out, "report.html")}`);
  console.log(`contact sheets:\n  ${contactSheets.join("\n  ")}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
