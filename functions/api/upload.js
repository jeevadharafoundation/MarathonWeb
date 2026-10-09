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

    const extMatch = file.name ? file.name.match(/\.([a-zA-Z0-9]+)$/) : null;
    const ext = extMatch ? extMatch[1].toLowerCase() : (file.type === "application/pdf" ? "pdf" : "jpg");

    // File type and size verification
    if (folder === "receipts") {
      const allowedReceiptExts = ["jpg", "jpeg", "png", "webp"];
      const allowedReceiptMimes = ["image/jpeg", "image/png", "image/webp"];
      const isMimeValid = !file.type || allowedReceiptMimes.includes(file.type);
      const isExtValid = allowedReceiptExts.includes(ext);

      if (!isExtValid && !isMimeValid) {
        return new Response(JSON.stringify({ error: "Invalid file type. Payment screenshot must be a JPG, PNG, or WebP image." }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Strict 1 MB size limit for payment receipts
      if (file.size > 1 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: `Payment screenshot exceeds 1 MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB). Please select an image under 1 MB.` }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    } else {
      // Safety check for other uploads (e.g. student IDs): max 5MB
      if (file.size > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "File exceeds 5MB limit" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
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
