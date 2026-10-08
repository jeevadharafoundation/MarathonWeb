// Cloudflare Pages Function: POST /api/upload
// Handles direct upload of compressed payment receipts & student IDs into Cloudflare R2

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return new Response(JSON.stringify({ error: "Content-Type must be multipart/form-data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const folder = formData.get("folder") || "receipts";

    if (!file || typeof file === "string") {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Safety checks: max 10MB (client-side compressed files are typically ~150KB)
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File exceeds 10MB limit" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const extMatch = file.name ? file.name.match(/\.([a-zA-Z0-9]+)$/) : null;
    const ext = extMatch ? extMatch[1].toLowerCase() : (file.type === "application/pdf" ? "pdf" : "jpg");
    
    // Generate unique file key: folder/YYYY-MM/timestamp-random.ext
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const randomHex = crypto.randomUUID().slice(0, 8);
    const key = `${folder}/${monthPrefix}/${Date.now()}-${randomHex}.${ext}`;

    // Cloudflare R2 Bucket Binding
    if (!env.R2_BUCKET) {
      return new Response(JSON.stringify({ 
        error: "R2_BUCKET binding not found. Please ensure R2 bucket is bound in Cloudflare Pages." 
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Put object into R2
    await env.R2_BUCKET.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "image/jpeg",
        cacheControl: "public, max-age=31536000"
      }
    });

    const publicBase = env.R2_PUBLIC_DOMAIN || "https://pub-7d6ecd8f80cc49d193ba7ce1c1f72c97.r2.dev";
    const fileUrl = `${publicBase.replace(/\/+$/, '')}/${key}`;

    return new Response(JSON.stringify({
      success: true,
      key: key,
      url: fileUrl,
      size: file.size,
      mimeType: file.type
    }), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Failed to upload file to R2" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
