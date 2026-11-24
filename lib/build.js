// Compiling from the visual editor. LaTeX Workshop builds only while a text editor is the active
// editor ("Cannot start to build because the active editor is undefined"), so a save made from the
// visual editor would compile nothing. This runs the recipe it would have run: its configured
// tools, one after another, with its %PLACEHOLDERS%. No VS Code dependency.
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const slash = (s) => s.split(path.sep).join('/');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sub = (s, map) => String(s).replace(/%([A-Z0-9_]+)%/g, (m, k) => (has(map, k) ? map[k] : m));

/**
 * LaTeX Workshop's placeholders for one root file, as a function that expands them in a string.
 * cfg: { outDir, auxDir, workspaceDir, cwd, tmpDir } (its latex.outDir / latex.auxDir settings).
 */
function expander(rootFile, cfg = {}) {
  const p = path.parse(rootFile);
  const dirW32 = path.normalize(p.dir), dir = slash(dirW32);
  const docW32 = path.join(dirW32, p.name), doc = slash(docW32);
  const docExtW32 = path.join(dirW32, p.base);
  const ws = slash(cfg.workspaceDir || '');
  const cwd = cfg.cwd || dirW32;
  const base = {
    DOC: doc, DOC_W32: docW32, DOC_EXT: slash(docExtW32), DOC_EXT_W32: docExtW32,
    DOCFILE_EXT: p.base, DOCFILE: p.name, DIR: dir, DIR_W32: dirW32,
    TMPDIR: cfg.tmpDir || os.tmpdir(), WORKSPACE_FOLDER: ws,
    RELATIVE_DIR: slash(path.relative(ws, dir)), RELATIVE_DOC: slash(path.relative(ws, doc)),
    RELATIVE_CWD_DIR: slash(path.relative(cwd, dir)), RELATIVE_CWD_DOC: slash(path.relative(cwd, doc)),
  };
  // the output directory is itself written with placeholders; the aux directory defaults to it
  const outDirW32 = path.normalize(sub(cfg.outDir || '%DIR%', base));
  const out = { OUTDIR: slash(outDirW32), OUTDIR_W32: outDirW32 };
  const aux = { AUXDIR: slash(path.normalize(sub(cfg.auxDir || '%OUTDIR%', base))) };
  return (arg) => sub(sub(sub(arg, base), aux), out);
}

/** `% !LW recipe = name` in the comment lines that open the root file, or undefined. */
function magicRecipe(rootText) {
  let head = '';
  for (const line of String(rootText || '').split('\n')) {
    if (!line.startsWith('%') && line.trim().length > 0) break;
    head += line + '\n';
  }
  const m = /^%\s*!\s*LW\s+recipe\s*=\s*(.*?)\s*$/mi.exec(head);
  return m && m[1] ? m[1] : undefined;
}

/**
 * The recipe LaTeX Workshop would pick: the one a magic comment or latex.recipe.default names,
 * else the first. (Its "lastUsed" lives in its own memory; here that means the first one.)
 */
function pickRecipe(cfg, rootText) {
  const recipes = Array.isArray(cfg.recipes) ? cfg.recipes : [];
  let name = cfg.magic !== false ? magicRecipe(rootText) : undefined;
  if (!name && cfg.recipeDefault && cfg.recipeDefault !== 'first' && cfg.recipeDefault !== 'lastUsed') name = cfg.recipeDefault;
  return (name && recipes.find((r) => r && r.name === name)) || recipes[0] || null;
}

/**
 * The commands to run for `rootFile`: { recipe, cwd, steps: [{ name, command, args, env }] },
 * or { error } when the settings do not describe a build.
 * cfg: { recipes, tools, recipeDefault, magic, outDir, auxDir, workspaceDir, cwd }.
 */
function plan(rootFile, cfg = {}, rootText = '') {
  const recipe = pickRecipe(cfg, rootText);
  if (!recipe || !Array.isArray(recipe.tools) || !recipe.tools.length) return { error: 'no LaTeX Workshop recipe is configured' };
  const cwd = cfg.cwd || path.dirname(rootFile);
  const expand = expander(rootFile, Object.assign({}, cfg, { cwd }));
  const tools = Array.isArray(cfg.tools) ? cfg.tools : [];
  const steps = [];
  for (const t of recipe.tools) {
    const tool = typeof t === 'string' ? tools.find((x) => x && x.name === t) : t;
    if (!tool || !tool.command) return { error: `recipe "${recipe.name}" names a tool that is not defined: ${typeof t === 'string' ? t : JSON.stringify(t)}` };
    const env = {};
    for (const k in tool.env || {}) env[k] = expand(tool.env[k]);
    steps.push({ name: tool.name || tool.command, command: expand(tool.command), args: (tool.args || []).map(expand), env });
  }
  return { recipe: recipe.name, cwd, steps };
}

/**
 * Run the steps in order and stop at the first that fails.
 * Resolves to { ok, step, code, error }; `write` receives what the tools print.
 */
async function run(p, write = () => {}, hooks = {}) {
  for (const s of p.steps) {
    write(`\n> ${s.command} ${s.args.join(' ')}\n`);
    const res = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(s.command, s.args, { cwd: p.cwd, env: Object.assign({}, process.env, s.env), stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { resolve({ error: e }); return; }
      if (hooks.onSpawn) hooks.onSpawn(child);
      child.stdout.on('data', (d) => write(d.toString()));
      child.stderr.on('data', (d) => write(d.toString()));
      child.on('error', (error) => resolve({ error }));
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    if (res.error) return { ok: false, step: s.name, error: res.error.message || String(res.error) };
    if (res.code !== 0) return { ok: false, step: s.name, code: res.code, signal: res.signal };
  }
  return { ok: true };
}

module.exports = { expander, magicRecipe, pickRecipe, plan, run };
