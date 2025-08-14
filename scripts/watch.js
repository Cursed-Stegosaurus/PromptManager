import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const outdir = resolve("dist");
if (!existsSync(outdir)) {
  mkdirSync(outdir, { recursive: true });
}

// Build function
async function buildExtension() {
  try {
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

    // Move background.js to root if it's in a subdirectory
    const backgroundSrc = resolve(outdir, "background", "background.js");
    const backgroundDest = resolve(outdir, "background.js");
    if (existsSync(backgroundSrc)) {
      cpSync(backgroundSrc, backgroundDest);
      rmSync(resolve(outdir, "background"), { recursive: true, force: true });
    }

    // Patch manifest to point to built files
    const manifestPath = resolve(outdir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.background.service_worker = "background.js";
    manifest.side_panel.default_path = "sidepanel/index.html";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log("Build complete →", outdir);
  } catch (error) {
    console.error("Build failed:", error);
  }
}

// Initial build
await buildExtension();

// Watch mode
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
  entryNames: '[name]',
  watch: {
    onRebuild(error, result) {
      if (error) {
        console.error("Watch build failed:", error);
      } else {
        console.log("Watch build succeeded");
        // Copy static files and patch manifest
        copyDir("public", outdir);
        const backgroundSrc = resolve(outdir, "background", "background.js");
        const backgroundDest = resolve(outdir, "background.js");
        if (existsSync(backgroundSrc)) {
          cpSync(backgroundSrc, backgroundDest);
          rmSync(resolve(outdir, "background"), { recursive: true, force: true });
        }
        const manifestPath = resolve(outdir, "manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        manifest.background.service_worker = "background.js";
        manifest.side_panel.default_path = "sidepanel/index.html";
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    },
  },
});

console.log("Watch mode started. Press Ctrl+C to stop.");
