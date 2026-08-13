import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(repositoryRoot, "frontend");
const outputDirectory = path.join(repositoryRoot, "dist");
const outputAssetsDirectory = path.join(outputDirectory, "assets");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputAssetsDirectory, { recursive: true });

await Promise.all([
  cp(path.join(sourceDirectory, "assets"), outputAssetsDirectory, { recursive: true }),
  cp(path.join(sourceDirectory, "styles.css"), path.join(outputDirectory, "styles.css")),
]);

const buildResult = await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  charset: "utf8",
  entryNames: "app-[hash]",
  entryPoints: ["frontend/app.js"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  minify: true,
  outdir: "dist/assets",
  platform: "browser",
  target: ["es2022"],
  plugins: [
    {
      name: "reject-remote-imports",
      setup(buildContext) {
        buildContext.onResolve({ filter: /^https?:\/\// }, (args) => ({
          errors: [{ text: `Remote executable dependency is forbidden: ${args.path}` }],
        }));
      },
    },
  ],
});

const entryOutput = Object.entries(buildResult.metafile.outputs).find(
  ([, metadata]) => metadata.entryPoint === "frontend/app.js",
);

if (!entryOutput) {
  throw new Error("Could not locate the bundled recovery entry point");
}

const [entryOutputPath, entryMetadata] = entryOutput;
const externalImports = entryMetadata.imports.filter((dependency) => dependency.external);
if (externalImports.length > 0) {
  throw new Error(
    `Recovery bundle contains external imports: ${externalImports
      .map((dependency) => dependency.path)
      .join(", ")}`,
  );
}

const bundleFilename = path.basename(entryOutputPath);
const sourceHtml = await readFile(path.join(sourceDirectory, "index.html"), "utf8");
const outputHtml = sourceHtml.replace(
  '<script type="module" src="./app.js"></script>',
  `<script type="module" src="./assets/${bundleFilename}"></script>`,
);

if (outputHtml === sourceHtml) {
  throw new Error("Could not replace the recovery source entry point in index.html");
}

await writeFile(path.join(outputDirectory, "index.html"), outputHtml);

const bundleBytes = await readFile(path.resolve(repositoryRoot, entryOutputPath));
const viemPackage = JSON.parse(
  await readFile(path.join(repositoryRoot, "node_modules", "viem", "package.json"), "utf8"),
);
const manifest = {
  bundle: `assets/${bundleFilename}`,
  sha256: createHash("sha256").update(bundleBytes).digest("hex"),
  dependencies: {
    viem: viemPackage.version,
  },
};

await writeFile(
  path.join(outputDirectory, "build-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
