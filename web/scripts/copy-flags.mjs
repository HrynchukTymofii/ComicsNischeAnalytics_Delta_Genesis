// Copy the flag SVGs for every country in public/data/country_by_app.json into public/flags/.
// Flags: flag-icons (MIT, https://github.com/lipis/flag-icons). Run: npm run flags (after make build-data).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(web, "node_modules", "flag-icons", "flags", "4x3");
const dst = join(web, "public", "flags");
const data = JSON.parse(readFileSync(join(web, "public", "data", "country_by_app.json"), "utf-8"));

const codes = new Set(Object.values(data.apps).flatMap((countries) => Object.keys(countries)));
mkdirSync(dst, { recursive: true });
const missing = [];
for (const code of codes) {
  const file = `${code.toLowerCase()}.svg`;
  if (existsSync(join(src, file))) copyFileSync(join(src, file), join(dst, file));
  else missing.push(code);
}
writeFileSync(join(dst, "LICENSE.txt"), readFileSync(join(web, "node_modules", "flag-icons", "LICENSE")));
console.log(`flags: ${codes.size - missing.length} copied to public/flags/` + (missing.length ? `; no flag for ${missing.join(", ")}` : ""));
