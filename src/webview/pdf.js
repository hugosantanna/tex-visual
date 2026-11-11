// Loaded on demand (as an ES module) the first time a PDF figure needs rendering.
// The worker code is bundled in and run on the main thread, so no Worker/blob URLs
// are needed inside the webview sandbox.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs';

globalThis.pdfjsWorker = pdfWorker;

export async function renderPdf(data, targetWidthPx, opts = {}) {
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: opts.fonts,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.max(1, Math.min(5, targetWidthPx / vp1.width));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return { url: canvas.toDataURL('image/png'), w: vp1.width, h: vp1.height };
  } finally {
    doc.destroy();
  }
}
