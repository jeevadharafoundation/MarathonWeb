// Cloudflare Pages Function: GET /api/media/*
// Streams files stored in Cloudflare R2 (hero slides, gallery images, receipts, etc.)
// Works in both local development (wrangler pages dev) and live Cloudflare Pages production.

export async function onRequestGet(context) {
  const { request, env, params } = context;

  try {
    const url = new URL(request.url);
    let key = url.searchParams.get("key");

    if (!key && params && params.path) {
      key = Array.isArray(params.path) ? params.path.join("/") : String(params.path);
    }

    if (!key) {
      return new Response(JSON.stringify({ error: "No object key specified" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Clean key (remove leading slashes or accidental full URLs)
    key = decodeURIComponent(key).replace(/^\/+/, "");
    if (key.includes(".r2.dev/")) {
      key = key.split(".r2.dev/")[1];
    }

    if (!env.R2_BUCKET) {
      return new Response(JSON.stringify({ error: "R2_BUCKET binding not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const object = await env.R2_BUCKET.get(key);

    if (!object) {
      return new Response(JSON.stringify({ error: "File not found", key }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    const headers = new Headers();
    if (typeof object.writeHttpMetadata === "function") {
      object.writeHttpMetadata(headers);
    }

    if (object.httpEtag) {
      headers.set("etag", object.httpEtag);
    }

    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");

    // Fallback Content-Type detection based on file extension
    const ext = key.split(".").pop().toLowerCase();
    const mimeMap = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      svg: "image/svg+xml",
      pdf: "application/pdf"
    };

    if (!headers.get("content-type") || headers.get("content-type") === "application/octet-stream") {
      headers.set("content-type", mimeMap[ext] || "image/jpeg");
    }

    return new Response(object.body, {
      status: 200,
      headers
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Failed to retrieve R2 object" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range"
    }
  });
}

export const onRequestHead = onRequestGet;
