import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@jest/globals";
import ts from "typescript";

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const webRoot = path.join(repoRoot, "src");
const srcLibRoot = path.join(webRoot, "lib");
const sourceRoots = [path.join(appRoot, "app"), path.join(appRoot, "src")];
const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function listSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...listSources(full));
      continue;
    }
    if (extensions.some((ext) => entry.name.endsWith(ext))) files.push(full);
  }
  return files;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

type FoundImport = { specifier: string; typeOnly: boolean };

function importsIn(source: string): FoundImport[] {
  const text = stripComments(source);
  const found: FoundImport[] = [];
  const fromPattern =
    /\b(?:import|export)\s+(type\s+)?(?:[^'"\n]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(fromPattern)) {
    const specifier = match[2];
    if (!specifier) continue;
    const clause = match[0];
    const typeOnly =
      Boolean(match[1]) ||
      (/^import\s+\{/.test(clause) &&
        !/\{[^}]*\b(?!type\b)[A-Za-z_$]/.test(clause.replace(/\btype\s+/g, "")));
    found.push({ specifier, typeOnly });
  }
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1];
    if (specifier) found.push({ specifier, typeOnly: false });
  }
  for (const match of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1];
    if (specifier) found.push({ specifier, typeOnly: false });
  }
  return found;
}

function resolveFile(base: string): string | null {
  const candidates = [base, ...extensions.map((ext) => base + ext)];
  for (const ext of extensions) candidates.push(path.join(base, `index${ext}`));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else if (specifier.startsWith("@/")) base = path.join(repoRoot, "src", specifier.slice(2));
  else return null;
  return resolveFile(base);
}

function isForbidden(specifier: string): boolean {
  if (specifier === "react" || specifier.startsWith("react/")) return true;
  if (specifier === "next" || specifier.startsWith("next/")) return true;
  if (specifier === "convex/react" || specifier.startsWith("convex/react/")) return true;
  if (specifier === "@" || specifier.startsWith("@/")) return true;
  return false;
}

function srcLibReached(): string[] {
  const reached = new Set<string>();
  const seen = new Set<string>();
  const queue = sourceRoots.flatMap((root) => listSources(root));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const insideLib = file.startsWith(srcLibRoot + path.sep);
    if (insideLib) reached.add(file);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const found of importsIn(text)) {
      if (found.typeOnly) continue;
      const resolved = resolveSpecifier(file, found.specifier);
      if (!resolved || resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;
      const inApp = resolved.startsWith(appRoot + path.sep);
      const inLib = resolved.startsWith(srcLibRoot + path.sep);
      const inRepo = resolved.startsWith(repoRoot + path.sep);
      if ((inApp || inLib || inRepo) && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...reached].sort();
}

test("src/lib modules this app reaches stay free of react, next, convex/react, and @/", () => {
  const violations: string[] = [];
  for (const file of srcLibReached()) {
    const text = fs.readFileSync(file, "utf8");
    for (const found of importsIn(text)) {
      if (!isForbidden(found.specifier)) continue;
      violations.push(`${path.relative(repoRoot, file)} imports ${found.specifier}`);
    }
  }
  expect(violations).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// No copied models (dcm-gdzi.30): shared logic comes from the website's src/lib, never a copy in the app. A top-level
// function in the app whose body matches one in the website's src/ (formatting, comments and trailing commas aside)
// is a copy: move it into src/lib (framework-free) and import it from both.

/** Bodies shorter than this (normalized) are too small to call a copy (`return a + b;`). */
const MIN_BODY = 80;

const printer = ts.createPrinter({ removeComments: true });

function normalize(node: ts.Node, sourceFile: ts.SourceFile): string {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, sourceFile)
    .replace(/\s+/g, "")
    .replace(/;/g, "")
    .replace(/,(?=[)\]}])/g, "");
}

type FunctionBody = { name: string; body: string };

function hasJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return ts.forEachChild(node, hasJsx) ?? false;
}

/**
 * Top-level functions (declarations, and `const f = ` arrow or function expressions) with their normalized bodies.
 * Components (bodies with JSX) and hooks (`use*`) are skipped: they are UI, and src/lib stays framework-free, so a
 * parallel React Native version of a web component is not a copied model.
 */
function functionBodies(file: string): FunctionBody[] {
  const text = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const found: FunctionBody[] = [];
  const add = (name: string, body: ts.Node) => {
    if (/^use[A-Z]/.test(name) || hasJsx(body)) return;
    found.push({ name, body: normalize(body, sourceFile) });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && statement.name) {
      add(statement.name.text, statement.body);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (!init || !ts.isIdentifier(declaration.name)) continue;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) add(declaration.name.text, init.body);
      }
    }
  }
  return found.filter((entry) => entry.body.length >= MIN_BODY);
}

/**
 * Copies that later phone tracers remove (plan .omc/plans/phone.yaml), as `<app file> <function>`. This list only
 * shrinks: a new copy fails the test, and so does an entry whose copy is gone (delete the entry).
 */
const KNOWN_COPIES: readonly string[] = [
  // PX9 (party and sheet on shared web models)
  "apps/mobile/src/features/party/create/wizard-logic.ts assignTrait",
  "apps/mobile/src/features/party/create/wizard-logic.ts classItemsFor",
  "apps/mobile/src/features/party/create/wizard-logic.ts domainCardOptions",
  "apps/mobile/src/features/party/create/wizard-logic.ts portraitAsset",
  "apps/mobile/src/features/party/create/wizard-logic.ts portraitOptions",
  "apps/mobile/src/features/party/create/wizard-logic.ts primaryWeaponsFor",
  "apps/mobile/src/features/party/create/wizard-logic.ts secondaryWeaponsFor",
  "apps/mobile/src/features/party/create/wizard-logic.ts stillNeeded",
  "apps/mobile/src/features/party/create/wizard-logic.ts suggestedLoadout",
  "apps/mobile/src/features/party/create/wizard-logic.ts suggestedTraits",
  "apps/mobile/src/features/party/create/wizard-logic.ts toggleCard",
  "apps/mobile/src/features/party/create/wizard-logic.ts toggleExperience",
  "apps/mobile/src/features/party/create/wizard-logic.ts traitsComplete",
  "apps/mobile/src/features/sheet/dice/roll-copy.ts earlierText",
  "apps/mobile/src/features/sheet/dice/roll-copy.ts outcomeColor",
  "apps/mobile/src/features/sheet/dice/roll-copy.ts partsText",
  "apps/mobile/src/features/sheet/dice/roll-copy.ts rollHeadline",
  "apps/mobile/src/features/sheet/features/class-features.tsx costLabel",
  "apps/mobile/src/features/sheet/features/class-features.tsx inputMissing",
  "apps/mobile/src/features/sheet/features/lunar.tsx bumpBlocked",
  "apps/mobile/src/features/sheet/incoming/model.ts damageLine",
  "apps/mobile/src/features/sheet/incoming/model.ts playableCards",
  "apps/mobile/src/features/sheet/incoming/model.ts reactionCard",
  "apps/mobile/src/features/sheet/incoming/model.ts stepText",
  "apps/mobile/src/features/sheet/level-up/draft.tsx advancementsChosen",
  "apps/mobile/src/features/sheet/level-up/draft.tsx cardsChosen",
  "apps/mobile/src/features/sheet/level-up/draft.tsx issueTarget",
  "apps/mobile/src/features/sheet/level-up/draft.tsx stepIds",
  "apps/mobile/src/features/sheet/level-up/ribbon.tsx targetNames",
  "apps/mobile/src/features/sheet/level-up/shared.ts fullSheet",
  // Journal (sessions and notes)
  "apps/mobile/src/features/notes/export-download.ts journalFileName",
  "apps/mobile/src/features/notes/mentions.tsx displayName",
  "apps/mobile/src/features/notes/shared.tsx byOwner",
  "apps/mobile/src/features/notes/sharing.tsx chipText",
  "apps/mobile/src/features/notes/slots.ts toPageRef",
  "apps/mobile/src/features/notes/use-journal.ts selectedPage",
  "apps/mobile/src/features/sessions/live-card.tsx hhmm",
  "apps/mobile/src/features/sessions/play-stage.tsx clock",
  // Combat map and sprite packs
  "apps/mobile/src/features/combat-map/edit/edit-actions.ts placementOf",
  "apps/mobile/src/features/combat-map/fog-paint.ts fogImage",
  "apps/mobile/src/features/combat-map/fog-paint.ts maskAt",
  "apps/mobile/src/features/combat-map/fog-paint.ts mix",
  "apps/mobile/src/features/combat-map/fog-paint.ts sampleColour",
  "apps/mobile/src/features/combat-map/fog-paint.ts unionMask",
  "apps/mobile/src/features/combat-map/play/card-use.ts playableUses",
  "apps/mobile/src/features/combat-map/play/weapons.ts equippedWeapons",
  "apps/mobile/src/features/packs/uploader.tsx relabel",
];

function copiedFunctions(): string[] {
  const website = new Map<string, string>();
  for (const file of listSources(webRoot)) {
    if (/\.(test|spec)\.tsx?$/.test(file)) continue;
    for (const { name, body } of functionBodies(file)) {
      if (!website.has(body)) website.set(body, `${path.relative(repoRoot, file)} ${name}`);
    }
  }
  const copies: string[] = [];
  for (const file of sourceRoots.flatMap((root) => listSources(root))) {
    for (const { name, body } of functionBodies(file)) {
      const original = website.get(body);
      if (original) copies.push(`${path.relative(repoRoot, file)} ${name} copies ${original}`);
    }
  }
  return copies.sort();
}

test("the app copies no function from the website (import it from src/lib instead)", () => {
  const copies = copiedFunctions();
  const key = (copy: string) => copy.split(" copies ")[0];
  expect(copies.filter((copy) => !KNOWN_COPIES.includes(key(copy)))).toEqual([]);
  const stillCopied = new Set(copies.map(key));
  expect(KNOWN_COPIES.filter((entry) => !stillCopied.has(entry))).toEqual([]);
});


test("the copy check sees through formatting, comments, semicolons and trailing commas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-imports-"));
  try {
    const web = path.join(dir, "web.ts");
    const app = path.join(dir, "app.ts");
    fs.writeFileSync(
      web,
      [
        "export function askerNames(roster: Roster | undefined): ReadonlyMap<string, string> {",
        "  const names = new Map<string, string>();",
        "  if (roster === undefined) return names;",
        "  names.set(roster.gm.userId, roster.gm.name);",
        "  for (const player of roster.players) names.set(player.userId, player.name);",
        "  return names;",
        "}",
      ].join("\n"),
    );
    fs.writeFileSync(
      app,
      [
        "/** copied */",
        "export const askerNames = (",
        "  roster: { gm: Member; players: Member[] } | undefined,",
        ") => {",
        "  // the roster as names",
        "  const names = new Map<string, string>()",
        "  if (roster === undefined) return names",
        "  names.set(",
        "    roster.gm.userId,",
        "    roster.gm.name,",
        "  )",
        "  for (const player of roster.players) names.set(player.userId, player.name)",
        "  return names",
        "}",
      ].join("\n"),
    );
    const webBodies = functionBodies(web).map((entry) => entry.body);
    expect(webBodies).toHaveLength(1);
    expect(functionBodies(app).map((entry) => entry.body)).toEqual(webBodies);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
