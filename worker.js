const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join("; ");

export const SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const CONTENT_HASHED_ASSET = /^\/assets\/[^/]+-[a-z0-9]{8,}\.[a-z0-9]+$/i;

export function cacheControlFor(request, response) {
  const { pathname } = new URL(request.url);
  const contentType = response.headers.get("content-type") ?? "";

  if (
    !response.ok ||
    pathname === "/" ||
    pathname.endsWith(".html") ||
    pathname === "/build-manifest.json" ||
    contentType.toLowerCase().includes("text/html")
  ) {
    return "no-store";
  }

  if (CONTENT_HASHED_ASSET.test(pathname)) {
    return "public, max-age=31536000, immutable";
  }

  return "no-cache";
}

export function secureAssetResponse(request, assetResponse) {
  const headers = new Headers(assetResponse.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set("Cache-Control", cacheControlFor(request, assetResponse));

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const assetResponse = await env.ASSETS.fetch(request);
    return secureAssetResponse(request, assetResponse);
  },
};
