import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = readJson("manifest.json");
const packageMetadata = readJson("package.json");

const extensionFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "errors.js",
  "gemini.js",
  "sidepanel.html",
  "sidepanel.js",
  "styles.css",
  "smartwatch_icon.png",
  "transcript.js",
  "transcript-cache.js",
  "transcript-processing.js",
  "transcript-workflow.js"
];

assert(manifest.manifest_version === 3, "manifest.json must use Manifest V3.");
assert(typeof manifest.version === "string" && manifest.version, "Manifest version is missing.");
assert(
  manifest.version === packageMetadata.version,
  `Version mismatch: manifest.json is ${manifest.version}, package.json is ${packageMetadata.version}.`
);

for (const file of extensionFiles) {
  assert(existsSync(resolve(projectRoot, file)), `Required extension file is missing: ${file}`);
}

const distDirectory = resolve(projectRoot, "dist");
const archivePath = resolve(distDirectory, `smartwatch-${manifest.version}.zip`);
mkdirSync(distDirectory, { recursive: true });
rmSync(archivePath, { force: true });

run("zip", ["-X", "-q", archivePath, ...extensionFiles]);
run("unzip", ["-tqq", archivePath]);

const archiveEntries = run("unzip", ["-Z1", archivePath], { captureOutput: true })
  .split(/\r?\n/)
  .filter(Boolean)
  .sort();
const expectedEntries = [...extensionFiles].sort();

assert(
  JSON.stringify(archiveEntries) === JSON.stringify(expectedEntries),
  `Archive contents differ from the approved file list.\nExpected: ${expectedEntries.join(", ")}\nActual: ${archiveEntries.join(", ")}`
);
assert(
  archiveEntries.every(
    (entry) =>
      !entry.startsWith(".git/") &&
      !entry.startsWith("__MACOSX/") &&
      !entry.split("/").includes(".DS_Store")
  ),
  "Archive contains development or macOS metadata files."
);

const sizeKiB = (statSync(archivePath).size / 1024).toFixed(1);
console.log(`Created and verified ${archivePath} (${sizeKiB} KiB).`);

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), "utf8"));
}

function run(command, args, { captureOutput = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  if (result.error) {
    throw new Error(`Could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status}.${result.stderr ? `\n${result.stderr}` : ""}`
    );
  }

  return captureOutput ? result.stdout : "";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
