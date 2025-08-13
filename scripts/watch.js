import { spawn } from "node:child_process";
import { watch } from "node:fs";

let proc;
function run() {
  if (proc) proc.kill();
  proc = spawn("node", ["scripts/build.js"], { stdio: "inherit" });
}
run();

watch("src", { recursive: true }, run);
watch("public", { recursive: true }, run);
