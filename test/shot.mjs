// Headless-Chrome harness: loads the webview bundle with a mock VS Code host, renders a
// .tex file, and either takes a screenshot or runs a scenario against it.
//
//   node test/shot.mjs <file.tex> <outdir> [test/x.scenario.mjs] [--dark]
//
// Needs Chrome, Chromium or Edge; set CHROME_PATH if it is somewhere unusual.
// TV_VIEWPORT=WxHxScale changes the window (default 980x1250x1.5).
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const texFile = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const dark = process.argv.includes('--dark');
const texDir = path.dirname(texFile);
fs.mkdirSync(outDir, { recursive: true });
// aux labels, bibliography and \\input tables, gathered exactly as the extension host does
const project = createRequire(import.meta.url)('../lib/project.js');
const external = await project.gatherExternal(texFile, fs.readFileSync(texFile, 'utf8'));

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (url === '/') {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/media/katex.min.css"><link rel="stylesheet" href="/media/app.css">
${dark ? '<style>:root{--tv-fg:#d4d4d4;--tv-bg:#1e1e1e;--tv-dim:#8b949e;--tv-accent:#58a6ff;--tv-sel:#264f78}</style>' : ''}
</head><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="editor"></div>
<script>
window.__TV__ = { pdfModule: '/media/pdf.mjs', standardFonts: '/media/standard_fonts/' };
// Mock host: keeps a document + version, applies edits like the extension does.
window.__host = { text: window.__TEX__, version: 1, log: [], rejectNext: false };
window.acquireVsCodeApi = () => ({
  getState: () => null, setState: () => {},
  postMessage(m) {
    const h = window.__host; h.log.push(m);
    const send = (x) => setTimeout(() => window.postMessage(x, '*'), 5);
    if (m.type === 'ready') send(Object.assign({ type: 'init', text: h.text, version: h.version, baseUri: '/doc' }, window.__EXT__));
    if (m.type === 'edit') {
      if (m.baseVersion !== h.version) { send({ type: 'reject', seq: m.seq, version: h.version, text: h.text }); return; }
      let t = h.text;
      for (const c of [...m.changes].reverse()) t = t.slice(0, c.from) + c.insert + t.slice(c.to);
      h.text = t; h.version++;
      send({ type: 'ack', seq: m.seq, version: h.version });
    }
  },
});
window.__remote = (from, to, insert) => { const h = window.__host; h.text = h.text.slice(0, from) + insert + h.text.slice(to); h.version++; window.postMessage({ type: 'sync', text: h.text, version: h.version }, '*'); };
</script>
<script src="/media/main.js"></script></body></html>`);
    return;
  }
  if (url.startsWith('/media/')) file = path.join(root, url);
  else if (url.startsWith('/doc/')) file = path.join(texDir, url.slice(5));
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('nope'); return; }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => p && fs.existsSync(p));
if (!chrome) { console.error('No Chrome/Chromium found; set CHROME_PATH.'); process.exit(2); }
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--no-first-run', '--hide-scrollbars', ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])],
});
const page = await browser.newPage();
const [vw, vh, vs] = (process.env.TV_VIEWPORT || '980x1250x1.5').split('x').map(Number);
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: vs });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
await page.evaluateOnNewDocument((t, ext) => { window.__TEX__ = t; window.__EXT__ = ext; }, fs.readFileSync(texFile, 'utf8'), external);
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tv && window.__tv.view, { timeout: 10000 });
await page.evaluate(() => document.fonts.ready);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);

let failures = 0;
const api = {
  page, sleep, outDir,
  shot: async (name) => { await sleep(150); await page.screenshot({ path: path.join(outDir, name + '.png') }); },
  assert: (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) failures++; },
  waitFor: async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(200); } },
  state: () => page.evaluate(() => { const s = window.__tv.debugState(); s.textLen = s.text.length; delete s.text; return s; }),
  // put the cursor at the first occurrence of needle (+offset) and scroll there
  goto: (needle, offset = 0, where = 'center') => page.evaluate((needle, offset, where) => {
    const v = window.__tv.view; const i = v.state.doc.toString().indexOf(needle);
    if (i < 0) throw new Error('not found: ' + needle);
    v.dispatch({ selection: { anchor: i + offset }, effects: v.constructor.scrollIntoView(i + offset, { y: where }) });
    v.focus(); return i + offset;
  }, needle, offset, where),
  scrollTo: (needle, where = 'start') => page.evaluate((needle, where) => {
    const v = window.__tv.view; const i = v.state.doc.toString().indexOf(needle);
    if (i < 0) throw new Error('not found: ' + needle);
    v.dispatch({ effects: v.constructor.scrollIntoView(i, { y: where, yMargin: 20 }) });
  }, needle, where),
};

const scenario = process.argv.find((a) => a.endsWith('.scenario.mjs'));
try {
  if (scenario) {
    await (await import(path.resolve(scenario))).default(api);
  } else {
    await api.shot('01-top');
    console.log(JSON.stringify(await api.state()));
  }
} catch (e) {
  console.error('scenario threw: ' + (e && e.stack || e));
  failures++;
}
const pageErrors = logs.filter((l) => l.startsWith('[pageerror]'));
const noise = (l) => l.includes('favicon') || l.includes('404');
if (logs.some((l) => !noise(l))) console.log('--- browser log ---\n' + logs.filter((l) => !noise(l)).join('\n'));
await browser.close();
server.close();
if (failures || pageErrors.length) { console.error(`${failures} failed check(s), ${pageErrors.length} page error(s)`); process.exit(1); }
