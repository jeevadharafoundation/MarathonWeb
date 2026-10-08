/**
 * Client-Side Image Compressor using HTML5 Canvas
 * Reduces 3MB-8MB smartphone screenshots down to ~120KB-180KB,
 * keeping transaction text sharp while preserving 100% free tier storage limits.
 */
window.compressImage = function(file, options = {}) {
  const maxWidth = options.maxWidth || 1280;
  const maxHeight = options.maxHeight || 1280;
  const quality = options.quality !== undefined ? options.quality : 0.80;

  return new Promise((resolve, reject) => {
    // If it's a PDF, we cannot compress via canvas, return directly
    if (file.type === "application/pdf") {
      return resolve(file);
    }

    if (!file.type.startsWith("image/")) {
      return resolve(file);
    }

    const reader = new FileReader();
    reader.onerror = (err) => reject(err);
    reader.onload = function(e) {
      const img = new Image();
      img.onerror = (err) => reject(err);
      img.onload = function() {
        let width = img.width;
        let height = img.height;

        // Calculate scaling
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        // Smooth image rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          function(blob) {
            if (!blob) {
              return resolve(file);
            }
            // Generate clean name ending in .jpg
            const baseName = file.name.replace(/\.[^/.]+$/, "");
            const compressedFile = new File([blob], `${baseName}.jpg`, {
              type: "image/jpeg",
              lastModified: Date.now()
            });

            console.log(
              `[Image Compressor] Original: ${(file.size / 1024).toFixed(1)} KB -> Compressed: ${(compressedFile.size / 1024).toFixed(1)} KB`
            );
            resolve(compressedFile);
          },
          "image/jpeg",
          quality
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};
