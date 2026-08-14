import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.js";

function assetEnvironment({
  body = "asset body",
  contentType = "text/plain",
  status = 200,
  headers = {},
} = {}) {
  return {
    ASSETS: {
      async fetch() {
        return new Response(body, {
          status,
          headers: {
            "content-type": contentType,
            ...headers,
          },
        });
      },
    },
  };
}

async function fetchAsset(pathname, options) {
  return worker.fetch(
    new Request(`https://recovery.cadmos.dev${pathname}`),
    assetEnvironment(options),
  );
}

test("the Worker applies the recovery security policy to every response", async () => {
  const response = await fetchAsset("/missing", {
    status: 404,
    headers: {
      "content-security-policy": "default-src *",
      "x-content-type-options": "unsafe-value",
    },
  });

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "asset body");
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=63072000; includeSubDomains; preload",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("permissions-policy"),
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  assert.equal(
    response.headers.get("cross-origin-opener-policy"),
    "same-origin-allow-popups",
  );
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");

  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
});

test("HTML and the build manifest are never stored", async () => {
  const html = await fetchAsset("/", { contentType: "text/html; charset=utf-8" });
  const manifest = await fetchAsset("/build-manifest.json", {
    contentType: "application/json",
  });

  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.equal(manifest.headers.get("cache-control"), "no-store");
});

test("only content-hashed production assets receive immutable caching", async () => {
  const hashedBundle = await fetchAsset("/assets/app-GBS556OW.js", {
    contentType: "text/javascript",
  });
  const unhashedStyles = await fetchAsset("/styles.css", { contentType: "text/css" });
  const unhashedLogo = await fetchAsset("/assets/CADMOS%20logo-01.svg", {
    contentType: "image/svg+xml",
  });

  assert.equal(
    hashedBundle.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(unhashedStyles.headers.get("cache-control"), "no-cache");
  assert.equal(unhashedLogo.headers.get("cache-control"), "no-cache");
});
