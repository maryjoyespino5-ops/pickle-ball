// One-off dev patch: apply a literal string replacement to a file.
// Usage: node scripts/patch.mjs <patch.json>
// patch.json: { "file": "...", "replacements": [{ "old": "...", "new": "..." }] }
import { readFileSync, writeFileSync } from "node:fs";

const [, , patchFile] = process.argv;
const patch = JSON.parse(readFileSync(patchFile, "utf8"));
const path = patch.file;
let text = readFileSync(path, "utf8");

let ok = 0;
for (const { old, new: replacement } of patch.replacements) {
  if (!text.includes(old)) {
    console.error(`NOT FOUND: ${JSON.stringify(old.slice(0, 70))}`);
    continue;
  }
  text = text.split(old).join(replacement);
  ok += 1;
}
writeFileSync(path, text, "utf8");
console.log(`patched ${ok}/${patch.replacements.length} in ${path}`);
process.exit(ok === patch.replacements.length ? 0 : 1);