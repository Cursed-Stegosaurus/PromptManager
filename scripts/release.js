import { createWriteStream } from "node:fs";
import { createReadStream } from "node:fs";
import { createWriteStream as createZipStream } from "node:fs";
import { archiver } from "archiver";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Read package.json for version
const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
const version = packageJson.version;
const zipName = `prompt-library-${version}.zip`;

// Create zip file
const output = createWriteStream(zipName);
const archive = archiver("zip", {
  zlib: { level: 9 } // Sets the compression level
});

output.on("close", () => {
  console.log(`Release package created: ${zipName}`);
  console.log(`Total size: ${archive.pointer()} bytes`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);

// Add dist folder contents
archive.directory("dist/", false);

archive.finalize();
