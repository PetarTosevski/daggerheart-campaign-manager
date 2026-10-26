// Regenerates src/lib/design-assets.generated.json: design asset id -> public
// path. Run after adding files to public/design-assets/ (downloaded from the
// Claude Design artifact; see docs/design-port-roadmap.md).
import { readdirSync, writeFileSync } from "node:fs";

const dir = "public/design-assets";
const map = {};
for (const file of readdirSync(dir).sort()) {
  const match = /^([0-9a-f]{32})\.(jpg|jpeg|png|webp|gif|svg)$/.exec(file);
  if (match) map[match[1]] = `/design-assets/${file}`;
}
writeFileSync("src/lib/design-assets.generated.json", JSON.stringify(map, null, 1) + "\n");
console.log(`${Object.keys(map).length} design assets`);
