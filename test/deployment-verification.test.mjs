import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateDeployedResponse,
  summarizeDeploymentChecks,
} from "../shared/deploymentVerification.mjs";
import worker from "../worker.js";

const BASE_URL = "https://recovery.cadmos.dev";

function assetEnvironment({ contentType, status = 200 } = {}) {
  return {
    ASSETS: {
      async fetch() {
        return new Response("asset body", {
          status,
          headers: { "content-type": contentType },
        });
      },
    },
  };
}

async function workerResponse(pathname, options) {
  const request = new Request(`${BASE_URL}${pathname}`);
  const response = await worker.fetch(request, assetEnvironment(options));
  return { request, response };
}

// The exact response recovery.cadmos.dev returned on 14 August 2026 for asset paths,
// when Cloudflare served static assets directly and never invoked worker.js.
function bypassedAssetResponse(pathname, contentType) {
  return {
    request: new Request(`${BASE_URL}${pathname}`),
    response: new Response("asset body", {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=0, must-revalidate",
      },
    }),
  };
}

test("a response produced by the Worker satisfies the deployed policy", async () => {
  const { request, response } = await workerResponse("/", {
    contentType: "text/html; charset=utf-8",
  });

  const result = evaluateDeployedResponse(request, response);

  assert.deepEqual(result.failures, []);
  assert.equal(result.passed, true);
  assert.equal(result.url, `${BASE_URL}/`);
  assert.equal(result.status, 200);
});

test("an asset served without the Worker fails the check", () => {
  const { request, response } = bypassedAssetResponse(
    "/assets/app-CC6VAHWT.js",
    "text/javascript",
  );

  const result = evaluateDeployedResponse(request, response);

  assert.equal(result.passed, false);
  assert.ok(
    result.failures.some((failure) => failure.startsWith("content-security-policy:")),
    "a missing Content-Security-Policy must be reported",
  );
  assert.ok(
    result.failures.some((failure) =>
      failure.startsWith("strict-transport-security:"),
    ),
    "a missing Strict-Transport-Security header must be reported",
  );
  assert.ok(
    result.failures.some((failure) => failure.startsWith("cache-control:")),
    "the content-hashed bundle must be reported as missing immutable caching",
  );
});

test("the recovery page is reported when it becomes cacheable", () => {
  const request = new Request(`${BASE_URL}/`);
  const response = new Response("<!doctype html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  const result = evaluateDeployedResponse(request, response);

  assert.equal(result.passed, false);
  assert.ok(
    result.failures.some(
      (failure) => failure.startsWith("cache-control:") && failure.includes("no-store"),
    ),
    `expected a no-store cache-control failure, received ${JSON.stringify(result.failures)}`,
  );
});

test("a weakened policy directive fails even when every header is present", async () => {
  const { request, response } = await workerResponse("/styles.css", {
    contentType: "text/css",
  });
  const weakened = new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
  weakened.headers.set(
    "content-security-policy",
    "default-src 'none'; script-src 'self' 'unsafe-inline'",
  );

  const result = evaluateDeployedResponse(request, weakened);

  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0].startsWith("content-security-policy:"));
});

test("a summary fails closed and names every failing URL", () => {
  const summary = summarizeDeploymentChecks([
    { url: `${BASE_URL}/`, status: 200, passed: true, failures: [] },
    {
      url: `${BASE_URL}/assets/app-CC6VAHWT.js`,
      status: 200,
      passed: false,
      failures: ["content-security-policy: expected the recovery policy, received no header"],
    },
  ]);

  assert.equal(summary.ok, false);
  assert.equal(summary.checked, 2);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.failedUrls, [`${BASE_URL}/assets/app-CC6VAHWT.js`]);
});

test("a summary of passing checks reports success", () => {
  const summary = summarizeDeploymentChecks([
    { url: `${BASE_URL}/`, status: 200, passed: true, failures: [] },
  ]);

  assert.equal(summary.ok, true);
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.failedUrls, []);
});

test("an empty check list never reports success", () => {
  const summary = summarizeDeploymentChecks([]);

  assert.equal(summary.ok, false);
  assert.equal(summary.checked, 0);
});
