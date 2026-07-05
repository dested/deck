// Temporary verification harness for the Library server modules. Runs against
// the real repo root WITHOUT touching the live Deck server. Deleted after use.
import { loadState } from "./state.js";
import { projectRegistry } from "./projects/registry.js";
import { inspectProject } from "./projects/inspector.js";
import { portWatcher } from "./projects/ports.js";
import { screenshotService } from "./projects/screenshots.js";

loadState();
projectRegistry.rescan();
const all = projectRegistry.getAll();
console.log("[1] projects discovered:", all.length);

// ---- inspector crash-test over every project ----
let withBlurb = 0;
let withScripts = 0;
let withPorts = 0;
let withFw = 0;
const t0 = Date.now();
for (const p of all) {
  const i = inspectProject(p.id, p.path);
  if (i.blurb) withBlurb++;
  if (i.scripts.length) withScripts++;
  if (i.staticPorts.length) withPorts++;
  if (i.frameworks.length) withFw++;
}
console.log(
  `[2] inspected ${all.length} projects in ${Date.now() - t0}ms — ` +
    `blurb:${withBlurb} scripts:${withScripts} staticPorts:${withPorts} frameworks:${withFw}`,
);
const cached = Date.now();
for (const p of all) inspectProject(p.id, p.path);
console.log(`[2b] warm cache pass: ${Date.now() - cached}ms`);
console.log(
  "[2c] sample (agentcommunity):",
  JSON.stringify(inspectProject("agentcommunity", "G:\\code\\agentcommunity")),
);

// ---- live port detection (the running Deck on 12345 should match) ----
portWatcher.start();
await new Promise((r) => setTimeout(r, 10_000));
console.log("[3] live ports:", JSON.stringify(portWatcher.getLive()));
portWatcher.stop();

// ---- headless screenshot of the live Deck UI ----
screenshotService.forceCapture("agentcommunity", 12345);
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (screenshotService.shotAt("agentcommunity")) break;
}
const at = screenshotService.shotAt("agentcommunity");
console.log("[4] screenshot mtime:", at, at ? "OK" : "FAILED");
process.exit(0);
