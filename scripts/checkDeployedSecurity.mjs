#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateDeployedResponse,
  summarizeDeploymentChecks,
} from "../shared/deploymentVerification.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "https://recovery.cadmos.dev";

async function checkPathname(baseUrl, pathname) {
  const request = new Request(`${baseUrl}${pathname}`, { redirect: "manual" });
  const response = await fetch(request);
  await response.arrayBuffer();
  return evaluateDeployedResponse(request, response);
}

async function main() {
  const baseUrl = (
    process.argv[2] ??
    process.env.RECOVERY_BASE_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, "dist", "build-manifest.json"), "utf8"),
  );

  const pathnames = [
    "/",
    "/build-manifest.json",
    `/${manifest.bundle}`,
    "/styles.css",
    "/__deployment-check-not-found",
  ];

  const results = [];
  for (const pathname of pathnames) {
    results.push(await checkPathname(baseUrl, pathname));
  }

  for (const result of results) {
    if (result.passed) {
      console.log(`ok    ${result.status} ${result.url}`);
      continue;
    }
    console.log(`FAIL  ${result.status} ${result.url}`);
    for (const failure of result.failures) {
      console.log(`        ${failure}`);
    }
  }

  const summary = summarizeDeploymentChecks(results);
  console.log(
    `\n${summary.passed}/${summary.checked} checked URLs served the recovery security policy.`,
  );

  if (!summary.ok) {
    console.error(
      `\nDeployment check failed for ${summary.failed} URL(s):\n` +
        summary.failedUrls.map((url) => `  ${url}`).join("\n") +
        "\n\nThe deployed site is not serving the reviewed worker.js policy. " +
        "Confirm that [assets] run_worker_first is enabled and that the Worker owns this hostname.",
    );
    process.exitCode = 1;
  }
}

await main();
