// The recipe runner behind build-on-save (lib/build.js): which commands LaTeX Workshop's
// settings turn into for a root file, and how they are run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import build from '../lib/build.js';

const tools = [
  { name: 'latexmk', command: '/Library/TeX/texbin/latexmk', args: ['-xelatex', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', '%DOC%'] },
  { name: 'xelatex', command: 'xelatex', args: ['-synctex=1', '-output-directory=%OUTDIR%', '%DOCFILE_EXT%'], env: { TEXINPUTS: '%DIR%/sty:' } },
  { name: 'biber', command: 'biber', args: ['%DOCFILE%'] },
];
const recipes = [
  { name: 'latexmk (xelatex)', tools: ['latexmk'] },
  { name: 'by hand', tools: ['xelatex', 'biber', 'xelatex'] },
];
const root = path.join(path.sep, 'p', 'paper', 'main.tex');
const dir = path.dirname(root);

test('the first recipe by default; "lastUsed" cannot be known here and means the first too', () => {
  for (const recipeDefault of [undefined, 'first', 'lastUsed']) {
    const p = build.plan(root, { recipes, tools, recipeDefault });
    assert.equal(p.recipe, 'latexmk (xelatex)');
    assert.equal(p.cwd, dir);
    assert.deepEqual(p.steps, [{ name: 'latexmk', command: '/Library/TeX/texbin/latexmk', env: {},
      args: ['-xelatex', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', path.join(dir, 'main').split(path.sep).join('/')] }]);
  }
});

test('a recipe named by latex.recipe.default or by a magic comment; placeholders in arguments and environment', () => {
  const named = build.plan(root, { recipes, tools, recipeDefault: 'by hand', outDir: '%DIR%/build' });
  const out = dir.split(path.sep).join('/') + '/build';
  assert.deepEqual(named.steps.map((s) => s.name), ['xelatex', 'biber', 'xelatex']);
  assert.deepEqual(named.steps[0].args, ['-synctex=1', '-output-directory=' + out, 'main.tex']);
  assert.deepEqual(named.steps[0].env, { TEXINPUTS: dir.split(path.sep).join('/') + '/sty:' });
  assert.deepEqual(named.steps[1].args, ['main']);
  const magic = '% !TEX root = main.tex\n%!LW recipe = by hand\n\\documentclass{article}\n% !LW recipe = ignored, too late\n';
  assert.equal(build.plan(root, { recipes, tools }, magic).recipe, 'by hand');
  assert.equal(build.plan(root, { recipes, tools, magic: false }, magic).recipe, 'latexmk (xelatex)');
  const ex = build.expander(root, { outDir: '%DIR%/out', auxDir: '%OUTDIR%/aux', workspaceDir: path.join(path.sep, 'p') });
  assert.equal(ex('%AUXDIR%|%OUTDIR%|%RELATIVE_DOC%|%UNKNOWN%'), `${dir.split(path.sep).join('/')}/out/aux|${dir.split(path.sep).join('/')}/out|paper/main|%UNKNOWN%`);
});

test('settings that do not describe a build are reported, not run', () => {
  assert.match(build.plan(root, {}).error, /no LaTeX Workshop recipe/);
  assert.match(build.plan(root, { recipes: [{ name: 'r', tools: ['nope'] }], tools }).error, /not defined: nope/);
});

test('steps run in order in the working folder and stop at the first failure', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-build-'));
  const node = (code) => ({ name: 'node', command: process.execPath, args: ['-e', code], env: { TV_MARK: 'x' } });
  const log = [];
  const ok = await build.run({ cwd: tmp, steps: [
    node("require('fs').writeFileSync('a.txt', process.env.TV_MARK); console.log('one')"),
    node("require('fs').appendFileSync('a.txt', 'y'); console.log('two')"),
  ] }, (s) => log.push(s));
  assert.deepEqual(ok, { ok: true });
  assert.equal(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8'), 'xy');
  assert.ok(log.join('').includes('one') && log.join('').includes('two'));
  const bad = await build.run({ cwd: tmp, steps: [
    node('process.exit(3)'),
    node("require('fs').writeFileSync('never.txt', '')"),
  ] });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 3);
  assert.ok(!fs.existsSync(path.join(tmp, 'never.txt')));
  const missing = await build.run({ cwd: tmp, steps: [{ name: 'ghost', command: path.join(tmp, 'no-such-program'), args: [], env: {} }] });
  assert.equal(missing.ok, false);
  assert.equal(missing.step, 'ghost');
  assert.ok(missing.error);
  fs.rmSync(tmp, { recursive: true, force: true });
});
