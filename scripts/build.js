import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const outdir = resolve("dist");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// Bundle TS entry points
await build({
  entryPoints: [
    "src/background/background.ts",
    "src/content/content.ts",
    "src/sidepanel/main.ts",
    "src/options/options.ts",
    "src/lib/searchWorker.ts"
  ],
  outdir,
  bundle: true,
  format: "esm",
  sourcemap: true,
  target: ["chrome114"],
});

// Copy static files
function copyDir(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}
copyDir("public", outdir);

// Patch manifest to point to built files
const manifestPath = resolve(outdir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
manifest.background.service_worker = "background.js";
manifest.side_panel.default_path = "sidepanel/index.html";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log("Build complete →", outdir);
