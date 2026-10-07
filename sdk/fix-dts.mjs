// tsc rewrites relative .ts imports in emitted .js, but not in .d.ts. Make declarations point at .js.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".d.ts")) {
      const s = readFileSync(p, "utf8");
      const out = s.replace(/(from\s+["']\.{1,2}\/[^"']+?)\.ts(["'])/g, "$1.js$2").replace(/(import\(["']\.{1,2}\/[^"']+?)\.ts(["']\))/g, "$1.js$2");
      if (out !== s) writeFileSync(p, out);
    }
  }
}
walk(join(import.meta.dirname, "dist"));
