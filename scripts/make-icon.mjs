// Renders icon.png (256x256) with headless Chrome. Run: node scripts/make-icon.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => p && fs.existsSync(p));
const font = fs.readFileSync(path.join(root, 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2')).toString('base64');
const mathFont = fs.readFileSync(path.join(root, 'node_modules/katex/dist/fonts/KaTeX_Math-Italic.woff2')).toString('base64');
const html = `<!doctype html><html><head><style>
@font-face { font-family: KM; src: url(data:font/woff2;base64,${font}); }
@font-face { font-family: KI; src: url(data:font/woff2;base64,${mathFont}); }
html, body { margin: 0; background: transparent; }
.i { width: 256px; height: 256px; border-radius: 56px; background: linear-gradient(140deg, #2b7de9 0%, #123a7a 100%);
     display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
.t { color: #fff; font: 150px/1 KI; margin: 6px 0 0 -30px; white-space: nowrap; }
.t sup { font: 76px/1 KM; vertical-align: baseline; position: relative; top: -60px; margin-left: 6px; }
.c { position: absolute; right: 44px; top: 58px; width: 9px; height: 140px; border-radius: 4px; background: #ffd866; }
</style></head><body><div class="i"><div class="t">x<sup>2</sup></div><div class="c"></div></div></body></html>`;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(root, 'icon.png'), omitBackground: true });
await browser.close();
console.log('wrote icon.png');
