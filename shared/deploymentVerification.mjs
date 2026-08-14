import { SECURITY_HEADERS, cacheControlFor } from "../worker.js";

function describe(actual) {
  return actual === null ? "no header" : `"${actual}"`;
}

export function evaluateDeployedResponse(request, response) {
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
