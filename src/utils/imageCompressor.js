/**
 * Client-side high-speed image & PDF optimizer for ID card scans, PDFs & webcam snapshots.
 * Supports PDF document uploads by converting page 1 to high-resolution image,
 * and automatically crops white flatbed margins for ultra-clean presentation.
 */

let pdfjsPromise = null;
async function getPdfJs() {
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    return window.pdfjsLib;
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (pdfjs && pdfjs.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
        }
        return pdfjs;
      } catch (err) {
        console.warn('Failed to dynamically load pdfjs-dist:', err);
        return null;
      }
    })();
  }
  return pdfjsPromise;
}

/**
 * Converts a PDF file or ArrayBuffer page 1 to a high-resolution image data URL.
 */
export async function convertPdfToDataUrl(fileOrBuffer) {
  try {
    const pdfjs = await getPdfJs();
    if (!pdfjs) throw new Error('PDF processing library not loaded');

    let data;
    if (fileOrBuffer instanceof ArrayBuffer) {
      data = fileOrBuffer;
    } else if (fileOrBuffer instanceof Blob) {
      data = await fileOrBuffer.arrayBuffer();
    } else if (fileOrBuffer && typeof fileOrBuffer.arrayBuffer === 'function') {
      data = await fileOrBuffer.arrayBuffer();
    } else {
      throw new Error('Unsupported PDF file input format');
    }

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data),
      disableFontFace: false
    });
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);

    const scale = 2.0; // Render at 2x scale for sharp text and ID numbers
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.90);
  } catch (err) {
    console.error('convertPdfToDataUrl error:', err);
    throw err;
  }
}

/**
 * Auto-crops empty scanner white flatbed margins from document images
 * so the actual document content fills the frame with maximal clarity.
 */
export function autoCropWhiteBorders(imgOrCanvas) {
  try {
    let canvas, w, h;
    if (typeof HTMLCanvasElement !== 'undefined' && imgOrCanvas instanceof HTMLCanvasElement) {
      canvas = imgOrCanvas;
      w = canvas.width;
      h = canvas.height;
    } else {
      w = imgOrCanvas.naturalWidth || imgOrCanvas.width;
      h = imgOrCanvas.naturalHeight || imgOrCanvas.height;
      if (!w || !h || w < 80 || h < 80) return typeof imgOrCanvas.src === 'string' ? imgOrCanvas.src : null;
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgOrCanvas, 0, 0);
    }

    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Detect white/light background flatbed pixels
    const isContentPixel = (r, g, b) => {
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC - minC;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum < 205 || saturation >= 18;
    };

    let minY = 0, maxY = h - 1, minX = 0, maxX = w - 1;

    // Scan top downwards (up to 45% of height)
    topLoop: for (let y = 0; y < Math.floor(h * 0.45); y++) {
      let contentPixels = 0;
      for (let x = 0; x < w; x += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > (w / 3) * 0.02) {
            minY = Math.max(0, y - 4);
            break topLoop;
          }
        }
      }
    }

    // Scan bottom upwards (up to 45% of height)
    bottomLoop: for (let y = h - 1; y > Math.floor(h * 0.55); y--) {
      let contentPixels = 0;
      for (let x = 0; x < w; x += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > (w / 3) * 0.02) {
            maxY = Math.min(h - 1, y + 4);
            break bottomLoop;
          }
        }
      }
    }

    // Scan left to right (up to 45% of width)
    leftLoop: for (let x = 0; x < Math.floor(w * 0.45); x++) {
      let contentPixels = 0;
      for (let y = minY; y <= maxY; y += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > ((maxY - minY) / 3) * 0.02) {
            minX = Math.max(0, x - 4);
            break leftLoop;
          }
        }
      }
    }

    // Scan right to left (up to 45% of width)
    rightLoop: for (let x = w - 1; x > Math.floor(w * 0.55); x--) {
      let contentPixels = 0;
      for (let y = minY; y <= maxY; y += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > ((maxY - minY) / 3) * 0.02) {
            maxX = Math.min(w - 1, x + 4);
            break rightLoop;
          }
        }
      }
    }

    const cropWidth = maxX - minX;
    const cropHeight = maxY - minY;

    if (cropWidth > 50 && cropHeight > 50 && (cropWidth < w * 0.98 || cropHeight < h * 0.98)) {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = cropWidth;
      outCanvas.height = cropHeight;
      const outCtx = outCanvas.getContext('2d');
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';
      outCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return outCanvas.toDataURL('image/jpeg', 0.88);
    }
  } catch (e) {
    console.warn('Auto-crop border error:', e);
  }
  return null;
}

/**
 * Auto-crops document base64 data URL and returns cropped base64 data URL.
 */
export function autoCropDocument(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return resolve(dataUrl);
    }
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      const cropped = autoCropWhiteBorders(img);
      resolve(cropped || dataUrl);
    };
    img.src = dataUrl;
  });
}

/**
 * Optimizes an uploaded file (Image or PDF), auto-crops flatbed borders,
 * and compresses it to high-definition ~200-300KB JPEG.
 */
export async function compressImageFile(file, maxDimension = 1400, quality = 0.85) {
  if (!file) return null;

  // Handle PDF files: convert page 1 to image and auto crop
  const isPdf = file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'));
  if (isPdf) {
    try {
      const pdfDataUrl = await convertPdfToDataUrl(file);
      if (pdfDataUrl) {
        const cropped = await autoCropDocument(pdfDataUrl);
        return compressBase64Image(cropped || pdfDataUrl, maxDimension, quality);
      }
    } catch (pdfErr) {
      console.error('PDF conversion failed, falling back to standard file read:', pdfErr);
    }
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = async () => {
        // Auto-crop white margins first
        const croppedDataUrl = autoCropWhiteBorders(img) || dataUrl;

        // Load the cropped image to resize and compress
        const finalImg = new Image();
        finalImg.onerror = () => resolve(croppedDataUrl);
        finalImg.onload = () => {
          let width = finalImg.naturalWidth || finalImg.width;
          let height = finalImg.naturalHeight || finalImg.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(finalImg, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        finalImg.src = croppedDataUrl;
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Optimizes raw base64 data URLs produced by hardware scanners (e.g. 1700x2338 raw scans),
 * auto-crops flatbed borders, and compresses down to crisp ~250KB-400KB JPEGs.
 */
export function compressBase64Image(dataUrl, maxDimension = 1400, quality = 0.85) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return resolve(dataUrl);
    }
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      // Auto crop borders from scanner bed
      const croppedDataUrl = autoCropWhiteBorders(img) || dataUrl;

      const finalImg = new Image();
      finalImg.onerror = () => resolve(croppedDataUrl);
      finalImg.onload = () => {
        let width = finalImg.naturalWidth || finalImg.width;
        let height = finalImg.naturalHeight || finalImg.height;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(finalImg, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      finalImg.src = croppedDataUrl;
    };
    img.src = dataUrl;
  });
}
