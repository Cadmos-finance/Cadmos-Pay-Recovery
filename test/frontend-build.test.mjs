import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(repositoryRoot, "frontend", "app.js"), "utf8");
const html = await readFile(path.join(repositoryRoot, "dist", "index.html"), "utf8");
const styles = await readFile(path.join(repositoryRoot, "dist", "styles.css"), "utf8");
const manifest = JSON.parse(
  await readFile(path.join(repositoryRoot, "dist", "build-manifest.json"), "utf8"),
);
const bundle = await readFile(path.join(repositoryRoot, "dist", manifest.bundle));
const bundleText = bundle.toString("utf8");

test("viem is imported from the pinned local package", () => {
  assert.match(source, /from ["']viem["'];/);
  assert.doesNotMatch(source, /from ["']https?:\/\//);
  assert.equal(manifest.dependencies.viem, "2.55.15");
});

test("the recovery page executes only its content-hashed local bundle", () => {
  assert.match(
    html,
    new RegExp(
      `<script type="module" src="\\./${manifest.bundle.replaceAll(".", "\\.")}"></script>`,
    ),
  );
  assert.match(manifest.bundle, /^assets\/app-[A-Z0-9]+\.js$/);

  const resourceUrls = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map(
    (match) => match[1],
  );
  assert.ok(resourceUrls.length > 0);
  for (const resourceUrl of resourceUrls) {
    assert.doesNotMatch(resourceUrl, /^(?:https?:)?\/\//);
  }

  assert.doesNotMatch(styles, /@import\s/i);
  assert.doesNotMatch(styles, /url\(\s*["']?(?:https?:)?\/\//i);
});

test("the production bundle has no remote module imports", () => {
  assert.doesNotMatch(bundleText, /esm\.sh/i);
  assert.doesNotMatch(bundleText, /\bfrom\s*["']https?:\/\//i);
  assert.doesNotMatch(bundleText, /\bimport\s*\(\s*["']https?:\/\//i);
});

test("the manifest authenticates the exact production bundle", () => {
  const actualSha256 = createHash("sha256").update(bundle).digest("hex");
  assert.equal(manifest.sha256, actualSha256);
});
