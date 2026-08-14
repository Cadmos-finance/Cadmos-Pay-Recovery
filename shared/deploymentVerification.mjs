import { createHash } from "node:crypto";

import { SECURITY_HEADERS, cacheControlFor } from "../worker.js";

function describe(actual) {
  return actual === null ? "no header" : `"${actual}"`;
}

export function deployedBundleFailures(manifest, bytes) {
  const served = createHash("sha256").update(bytes).digest("hex");
  if (served === manifest.sha256) return [];

  return [
    `sha256: expected "${manifest.sha256}", received "${served}". ` +
      "The delivered bundle is not the reviewed build.",
  ];
}

export function deployedPageFailures(manifest, html) {
  const failures = [];

  const reviewedModuleScript = new RegExp(
    `<script type="module" src="\\./${manifest.bundle.replaceAll(".", "\\.")}"></script>`,
  );
  if (!reviewedModuleScript.test(html)) {
    failures.push(
      `bundle reference: expected the page to load "./${manifest.bundle}" as its only module script`,
    );
  }

  for (const [, resourceUrl] of html.matchAll(
    /\b(?:src|href)=["']([^"']+)["']/gi,
  )) {
    if (/^(?:https?:)?\/\//.test(resourceUrl)) {
      failures.push(`cross-origin resource: "${resourceUrl}"`);
    }
  }

  return failures;
}

export function evaluateDeployedResponse(request, response, contentFailures = []) {
  const failures = [];

  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const actual = response.headers.get(name);
    if (actual !== expected) {
      failures.push(
        `${name.toLowerCase()}: expected "${expected}", received ${describe(actual)}`,
      );
    }
  }

  const expectedCacheControl = cacheControlFor(request, response);
  const actualCacheControl = response.headers.get("cache-control");
  if (actualCacheControl !== expectedCacheControl) {
    failures.push(
      `cache-control: expected "${expectedCacheControl}", received ${describe(actualCacheControl)}`,
    );
  }

  failures.push(...contentFailures);

  return {
    url: request.url,
    status: response.status,
    passed: failures.length === 0,
    failures,
  };
}

export function summarizeDeploymentChecks(results) {
  const failing = results.filter((result) => !result.passed);

  return {
    checked: results.length,
    passed: results.length - failing.length,
    failed: failing.length,
    failedUrls: failing.map((result) => result.url),
    ok: results.length > 0 && failing.length === 0,
  };
}
