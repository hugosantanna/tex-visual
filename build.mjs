import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const media = path.join(root, 'media');
fs.rmSync(media, { recursive: true, force: true });
fs.mkdirSync(path.join(media, 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/webview/main.js')],
  outfile: path.join(media, 'main.js'),
  bundle: true, format: 'iife', minify: true, target: 'es2022', logLevel: 'warning',
});
await build({
  entryPoints: [path.join(root, 'src/webview/pdf.js')],
  outfile: path.join(media, 'pdf.mjs'),
  bundle: true, format: 'esm', minify: true, target: 'es2022', logLevel: 'error',
});

const katexDist = path.join(root, 'node_modules/katex/dist');
fs.copyFileSync(path.join(katexDist, 'katex.min.css'), path.join(media, 'katex.min.css'));
for (const f of fs.readdirSync(path.join(katexDist, 'fonts'))) {
  if (f.endsWith('.woff2')) fs.copyFileSync(path.join(katexDist, 'fonts', f), path.join(media, 'fonts', f));
}
fs.copyFileSync(path.join(root, 'src/webview/app.css'), path.join(media, 'app.css'));
fs.cpSync(path.join(root, 'node_modules/pdfjs-dist/standard_fonts'), path.join(media, 'standard_fonts'), { recursive: true });

const size = (f) => (fs.statSync(path.join(media, f)).size / 1024).toFixed(0) + ' KB';
console.log(`built media/main.js ${size('main.js')}, media/pdf.mjs ${size('pdf.mjs')}`);
