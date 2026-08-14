#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deployedBundleFailures,
  deployedPageFailures,
  evaluateDeployedResponse,
  summarizeDeploymentChecks,
} from "../shared/deploymentVerification.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "https://recovery.cadmos.dev";

async function checkPathname(baseUrl, pathname, inspectContent = null) {
  const request = new Request(`${baseUrl}${pathname}`, { redirect: "manual" });
  const response = await fetch(request);
  const body = Buffer.from(await response.arrayBuffer());
  const contentFailures =
    inspectContent && response.ok ? inspectContent(body) : [];
  return evaluateDeployedResponse(request, response, contentFailures);
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

  const checks = [
    ["/", (body) => deployedPageFailures(manifest, body.toString("utf8"))],
    ["/build-manifest.json", null],
    [`/${manifest.bundle}`, (body) => deployedBundleFailures(manifest, body)],
    ["/styles.css", null],
    ["/__deployment-check-not-found", null],
  ];

  const results = [];
  for (const [pathname, inspectContent] of checks) {
    results.push(await checkPathname(baseUrl, pathname, inspectContent));
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
    `\n${summary.passed}/${summary.checked} checked URLs served the reviewed build under the recovery security policy.`,
  );
  console.log(`Reviewed bundle: ${manifest.bundle} sha256 ${manifest.sha256}`);

  if (!summary.ok) {
    console.error(
      `\nDeployment check failed for ${summary.failed} URL(s):\n` +
        summary.failedUrls.map((url) => `  ${url}`).join("\n") +
        "\n\nThe deployed site is not serving the reviewed worker.js policy, or the delivered " +
        "bytes are not the reviewed build. Confirm that [assets] run_worker_first is enabled, " +
        "that the Worker owns this hostname, and that the deployed commit matches this checkout.",
    );
    process.exitCode = 1;
  }
}

await main();
