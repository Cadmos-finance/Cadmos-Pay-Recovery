import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = await readFile(
  path.join(repositoryRoot, "wrangler.toml"),
  "utf8",
);

function tomlEntries(source, sectionName = null) {
  const lines = source.split("\n").map((line) => line.trim());
  const start = sectionName === null ? 0 : lines.indexOf(`[${sectionName}]`) + 1;
  if (start === 0 && sectionName !== null) return null;

  const entries = new Map();
  for (const line of lines.slice(start)) {
    if (line.startsWith("[")) break;
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    entries.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return entries;
}

test("every asset response is produced by the security Worker", () => {
  const assets = tomlEntries(wranglerConfig, "assets");

  assert.ok(assets, "wrangler.toml must configure an [assets] section");
  assert.equal(
    assets.get("run_worker_first"),
    "true",
    "Cloudflare serves matching static assets directly and never invokes worker.js unless " +
      "run_worker_first is enabled, which publishes the recovery page without its security headers",
  );
});

test("the Worker serves the reproducible build output", () => {
  const root = tomlEntries(wranglerConfig);
  const assets = tomlEntries(wranglerConfig, "assets");

  assert.equal(root.get("main"), '"worker.js"');
  assert.equal(
    assets.get("directory"),
    '"./dist"',
    "the deployed directory must be the verified build output, never unbundled source",
  );
  assert.equal(assets.get("binding"), '"ASSETS"');
});
