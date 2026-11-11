// \includegraphics widgets. Raster/SVG files load directly; PDFs are rasterized once with
// pdf.js (loaded lazily) and cached as PNG data URLs.
import { WidgetType } from '@codemirror/view';
import { esc } from './render.js';

const pending = new Map();
const done = new Map();
const failed = new Set();
const versions = new Map();
const RASTER = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;
const TEXTWIDTH_PT = 468;

let pdfP = null;
function pdfModule() {
  if (!pdfP) pdfP = import(window.__TV__.pdfModule);
  return pdfP;
}

function candidates(path, dirs) {
  const exts = /\.[a-zA-Z0-9]{2,4}$/.test(path) ? [''] : ['.pdf', '.png', '.jpg', '.jpeg', '.svg'];
  const out = [];
  for (const d of ['', ...dirs]) for (const e of exts) out.push(d + path + e);
  return out;
}

function probeImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ url, w: img.naturalWidth * 0.75, h: img.naturalHeight * 0.75 });
    img.onerror = () => reject(new Error('not found'));
    img.src = url;
  });
}

async function load(base, path, dirs, gen) {
  let last = new Error('file not found');
  for (const c of candidates(path, dirs)) {
    const url = base.replace(/\/$/, '') + '/' + c.split('/').map(encodeURIComponent).join('/') + (gen ? '?v=' + gen : '');
    try {
      if (RASTER.test(c)) return Object.assign(await probeImage(url), { file: c });
      if (/\.pdf$/i.test(c)) {
        const res = await fetch(url);
        if (!res.ok) { last = new Error('file not found'); continue; }
        const data = new Uint8Array(await res.arrayBuffer());
        const mod = await pdfModule();
        return Object.assign(await mod.renderPdf(data, 1700, { fonts: window.__TV__.standardFonts }), { file: c });
      }
      last = new Error('unsupported format');
    } catch (e) { last = e; }
  }
  throw last;
}

function widthFromOpt(opt) {
  let m = /width\s*=\s*([\d.]*)\s*\\(textwidth|linewidth|columnwidth|hsize)/.exec(opt);
  if (m) return { frac: m[1] === '' ? 1 : parseFloat(m[1]) };
  m = /width\s*=\s*([\d.]+)\s*(cm|in|pt|mm)/.exec(opt);
  if (m) {
    const pt = parseFloat(m[1]) * { cm: 28.45, in: 72.27, pt: 1, mm: 2.845 }[m[2]];
    return { frac: Math.min(1, pt / TEXTWIDTH_PT) };
  }
  m = /scale\s*=\s*([\d.]+)/.exec(opt);
  if (m) return { scale: parseFloat(m[1]) };
  return {};
}

export class FigureWidget extends WidgetType {
  constructor(path, opt, base, dirs, gen, block) {
    super();
    this.path = path; this.opt = opt || ''; this.base = base || ''; this.dirs = dirs || [];
    this.gen = gen; this.block = block;
    this.key = [path, this.opt, this.base, gen, block].join('|');
    this.cacheKey = [this.base, path].join('|');
  }
  eq(o) { return o.key === this.key; }
  toDOM(view) {
    const el = document.createElement(this.block ? 'div' : 'span');
    el.className = 'tv-figure';
    const w = widthFromOpt(this.opt);
    const show = (info) => {
      const img = document.createElement('img');
      img.src = info.url;
      img.alt = this.path;
      const frac = w.frac != null ? w.frac : Math.min(1, (info.w * (w.scale || 1)) / TEXTWIDTH_PT);
      img.style.width = Math.round(frac * 1000) / 10 + '%';
      if (info.w && info.h) img.style.aspectRatio = `${info.w} / ${info.h}`;
      el.replaceChildren(img);
      view.requestMeasure();
    };
    const info = done.get(this.cacheKey);
    if (info) { show(info); return el; }
    el.innerHTML = `<span class="tv-figure-ph">${esc(this.path)}</span>`;
    let p = pending.get(this.cacheKey);
    if (!p) pending.set(this.cacheKey, p = load(this.base, this.path, this.dirs, versions.get(this.cacheKey) || 0));
    p.then((res) => { done.set(this.cacheKey, res); failed.delete(this.cacheKey); show(res); }, (err) => {
      failed.add(this.cacheKey);
      el.innerHTML = `<span class="tv-figure-ph tv-missing">${esc(this.path)} — ${esc(err && err.message || err)}</span>`;
      view.requestMeasure();
    });
    return el;
  }
  get estimatedHeight() {
    const info = done.get(this.cacheKey);
    return this.block ? (info ? 360 : 60) : -1;
  }
  ignoreEvent() { return false; }
}

/** Files changed on disk (paths relative to the document). Returns true if any figure must reload. */
export function invalidateAssets(paths) {
  const changed = new Set(paths.map((p) => p.replace(/^\.\//, '')));
  let hit = false;
  const drop = (k) => { done.delete(k); pending.delete(k); failed.delete(k); versions.set(k, (versions.get(k) || 0) + 1); hit = true; };
  for (const [k, info] of [...done]) if (changed.has(String(info.file).replace(/^\.\//, ''))) drop(k);
  for (const k of [...failed]) drop(k); // a missing figure may have just been generated
  return hit;
}

export function figureStats() {
  return { rendered: done.size, pending: pending.size - done.size };
}
