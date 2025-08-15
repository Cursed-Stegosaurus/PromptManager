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
  outExtension: { '.js': '.js' },
  entryNames: '[name]'
});

// Copy static files
function copyDir(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}
copyDir("public", outdir);

// Copy data files
const dataSrc = resolve("public", "data");
const dataDest = resolve(outdir, "data");
if (existsSync(dataSrc)) {
  cpSync(dataSrc, dataDest, { recursive: true });
}

// Move background.js to root if it's in a subdirectory
const backgroundSrc = resolve(outdir, "background", "background.js");
const backgroundDest = resolve(outdir, "background.js");
if (existsSync(backgroundSrc)) {
  cpSync(backgroundSrc, backgroundDest);
  rmSync(resolve(outdir, "background"), { recursive: true, force: true });
}

// Move options.js to options folder
const optionsSrc = resolve(outdir, "options.js");
const optionsDest = resolve(outdir, "options", "options.js");
if (existsSync(optionsSrc)) {
  cpSync(optionsSrc, optionsDest);
  rmSync(optionsSrc, { force: true });
}

// Patch manifest to point to built files
const manifestPath = resolve(outdir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
manifest.background.service_worker = "background.js";
manifest.side_panel.default_path = "sidepanel/index.html";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log("Build complete →", outdir);
