// xcolor's colors, turned into CSS: the named colors (the base set, dvipsnames, svgnames), the
// models of \definecolor, and mixes like red!60!black. A color is [r, g, b] in 0..1 until it is
// written out. The tables are read off xcolor.sty, dvipsnam.def and svgnam.def.

const BASE = 'red:ff0000,green:00ff00,blue:0000ff,brown:bf8040,lime:bfff00,orange:ff8000,pink:ffbfbf,purple:bf0040,teal:008080,violet:800080,black:000000,darkgray:404040,gray:808080,lightgray:bfbfbf,white:ffffff';
// These four, and all of dvipsnames, are cmyk colors (in percent here).
const BASE_CMYK = 'cyan:100 0 0 0,magenta:0 100 0 0,yellow:0 0 100 0,olive:0 0 100 50';
const DVIPS = 'GreenYellow:15 0 69 0,Yellow:0 0 100 0,Goldenrod:0 10 84 0,Dandelion:0 29 84 0,Apricot:0 32 52 0,Peach:0 50 70 0,Melon:0 46 50 0,YellowOrange:0 42 100 0,Orange:0 61 87 0,BurntOrange:0 51 100 0,Bittersweet:0 75 100 24,RedOrange:0 77 87 0,Mahogany:0 85 87 35,Maroon:0 87 68 32,BrickRed:0 89 94 28,Red:0 100 100 0,OrangeRed:0 100 50 0,RubineRed:0 100 13 0,WildStrawberry:0 96 39 0,Salmon:0 53 38 0,CarnationPink:0 63 0 0,Magenta:0 100 0 0,VioletRed:0 81 0 0,Rhodamine:0 82 0 0,Mulberry:34 90 0 2,RedViolet:7 90 0 34,Fuchsia:47 91 0 8,Lavender:0 48 0 0,Thistle:12 59 0 0,Orchid:32 64 0 0,DarkOrchid:40 80 20 0,Purple:45 86 0 0,Plum:50 100 0 0,Violet:79 88 0 0,RoyalPurple:75 90 0 0,BlueViolet:86 91 0 4,Periwinkle:57 55 0 0,CadetBlue:62 57 23 0,CornflowerBlue:65 13 0 0,MidnightBlue:98 13 0 43,NavyBlue:94 54 0 0,RoyalBlue:100 50 0 0,Blue:100 100 0 0,Cerulean:94 11 0 0,Cyan:100 0 0 0,ProcessBlue:96 0 0 0,SkyBlue:62 0 12 0,Turquoise:85 0 20 0,TealBlue:86 0 34 2,Aquamarine:82 0 30 0,BlueGreen:85 0 33 0,Emerald:100 0 50 0,JungleGreen:99 0 52 0,SeaGreen:69 0 50 0,Green:100 0 100 0,ForestGreen:91 0 88 12,PineGreen:92 0 59 25,LimeGreen:50 0 100 0,YellowGreen:44 0 74 0,SpringGreen:26 0 76 0,OliveGreen:64 0 95 40,RawSienna:0 72 100 45,Sepia:0 83 100 70,Brown:0 81 100 60,Tan:14 42 56 0,Gray:0 0 0 50,Black:0 0 0 100,White:0 0 0 0';
const SVG = 'AliceBlue:f0f8ff,AntiqueWhite:faebd7,Aqua:00ffff,Aquamarine:7fffd4,Azure:f0ffff,Beige:f5f5dc,Bisque:ffe4c4,Black:000000,BlanchedAlmond:ffebcd,Blue:0000ff,BlueViolet:8a2be2,Brown:a52a2a,BurlyWood:deb887,CadetBlue:5f9ea0,Chartreuse:7fff00,Chocolate:d2691e,Coral:ff7f50,CornflowerBlue:6495ed,Cornsilk:fff8dc,Crimson:dc143c,Cyan:00ffff,DarkBlue:00008b,DarkCyan:008b8b,DarkGoldenrod:b8860b,DarkGray:a9a9a9,DarkGreen:006400,DarkGrey:a9a9a9,DarkKhaki:bdb76b,DarkMagenta:8b008b,DarkOliveGreen:556b2f,DarkOrange:ff8c00,DarkOrchid:9932cc,DarkRed:8b0000,DarkSalmon:e9967a,DarkSeaGreen:8fbc8f,DarkSlateBlue:483d8b,DarkSlateGray:2f4f4f,DarkSlateGrey:2f4f4f,DarkTurquoise:00ced1,DarkViolet:9400d3,DeepPink:ff1493,DeepSkyBlue:00bfff,DimGray:696969,DimGrey:696969,DodgerBlue:1e90ff,FireBrick:b22222,FloralWhite:fffaf0,ForestGreen:228b22,Fuchsia:ff00ff,Gainsboro:dcdcdc,GhostWhite:f8f8ff,Gold:ffd700,Goldenrod:daa520,Gray:808080,Green:008000,GreenYellow:adff2f,Grey:808080,Honeydew:f0fff0,HotPink:ff69b4,IndianRed:cd5c5c,Indigo:4b0082,Ivory:fffff0,Khaki:f0e68c,Lavender:e6e6fa,LavenderBlush:fff0f5,LawnGreen:7cfc00,LemonChiffon:fffacd,LightBlue:add8e6,LightCoral:f08080,LightCyan:e0ffff,LightGoldenrod:eedd82,LightGoldenrodYellow:fafad2,LightGray:d3d3d3,LightGreen:90ee90,LightGrey:d3d3d3,LightPink:ffb6c1,LightSalmon:ffa07a,LightSeaGreen:20b2aa,LightSkyBlue:87cefa,LightSlateBlue:8470ff,LightSlateGray:778899,LightSlateGrey:778899,LightSteelBlue:b0c4de,LightYellow:ffffe0,Lime:00ff00,LimeGreen:32cd32,Linen:faf0e6,Magenta:ff00ff,Maroon:800000,MediumAquamarine:66cdaa,MediumBlue:0000cd,MediumOrchid:ba55d3,MediumPurple:9370db,MediumSeaGreen:3cb371,MediumSlateBlue:7b68ee,MediumSpringGreen:00fa9a,MediumTurquoise:48d1cc,MediumVioletRed:c71585,MidnightBlue:191970,MintCream:f5fffa,MistyRose:ffe4e1,Moccasin:ffe4b5,NavajoWhite:ffdead,Navy:000080,NavyBlue:000080,OldLace:fdf5e6,Olive:808000,OliveDrab:6b8e23,Orange:ffa500,OrangeRed:ff4500,Orchid:da70d6,PaleGoldenrod:eee8aa,PaleGreen:98fb98,PaleTurquoise:afeeee,PaleVioletRed:db7093,PapayaWhip:ffefd5,PeachPuff:ffdab9,Peru:cd853f,Pink:ffc0cb,Plum:dda0dd,PowderBlue:b0e0e6,Purple:800080,Red:ff0000,RosyBrown:bc8f8f,RoyalBlue:4169e1,SaddleBrown:8b4513,Salmon:fa8072,SandyBrown:f4a460,SeaGreen:2e8b57,Seashell:fff5ee,Sienna:a0522d,Silver:c0c0c0,SkyBlue:87ceeb,SlateBlue:6a5acd,SlateGray:708090,SlateGrey:708090,Snow:fffafa,SpringGreen:00ff7f,SteelBlue:4682b4,Tan:d2b48c,Teal:008080,Thistle:d8bfd8,Tomato:ff6347,Turquoise:40e0d0,Violet:ee82ee,VioletRed:d02090,Wheat:f5deb3,White:ffffff,WhiteSmoke:f5f5f5,Yellow:ffff00,YellowGreen:9acd32';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fromHex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * cmyk as a PDF viewer shows it, which is duller than 1 - c - k: the fit to US Web Coated (SWOP)
 * that PDF.js draws DeviceCMYK with. ForestGreen comes out as the green of the compiled PDF.
 */
function cmyk(c, m, y, k) {
  const r = 255 + c * (-4.387332384609988 * c + 54.48615194189176 * m + 18.82290502165302 * y + 212.25662451639585 * k - 285.2331026137004) +
    m * (1.7149763477362134 * m - 5.6096736904047315 * y - 17.873870861415444 * k - 5.497006427196366) +
    y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) + k * (-21.86122147463605 * k - 189.48180835922747);
  const g = 255 + c * (8.841041422036149 * c + 60.118027045597366 * m + 6.871425592049007 * y + 31.159100130055922 * k - 79.2970844816548) +
    m * (-15.310361306967817 * m + 17.575251261109482 * y + 131.35250912493976 * k - 190.9453302588951) +
    y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) + k * (-20.737325471181034 * k - 187.80453709719578);
  const b = 255 + c * (0.8842522430003296 * c + 8.078677503112928 * m + 30.89978309703729 * y - 0.23883238689178934 * k - 14.183576799673286) +
    m * (10.49593273432072 * m + 63.02378494754052 * y + 50.606957656360734 * k - 112.23884253719248) +
    y * (0.03296041114873217 * y + 115.60384449646641 * k - 193.58209356861505) + k * (-22.33816807309886 * k - 180.12613974708367);
  return [r / 255, g / 255, b / 255];
}

function hsb(h, s, b) {
  const f = (n) => { const k = (n + h * 6) % 6; return b * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))); };
  return [f(5), f(3), f(1)];
}

let sets = null;
function table(src, read) {
  const m = new Map();
  for (const e of src.split(',')) { const i = e.indexOf(':'); m.set(e.slice(0, i), read(e.slice(i + 1))); }
  return m;
}

/** A color by its name: one the document defined, else xcolor's. Names are case-sensitive, as in LaTeX. */
function named(name, meta) {
  if (meta && meta.colors && has(meta.colors, name)) return meta.colors[name];
  if (!sets) {
    const pct = (v) => cmyk(...v.split(' ').map((x) => x / 100));
    sets = { base: new Map([...table(BASE, fromHex), ...table(BASE_CMYK, pct)]), dvips: table(DVIPS, pct), svg: table(SVG, fromHex) };
  }
  // dvipsnames and svgnames share forty names; the set the document asks for comes first
  const order = meta && meta.svgnames ? [sets.base, sets.svg, sets.dvips] : [sets.base, sets.dvips, sets.svg];
  for (const s of order) { const c = s.get(name); if (c) return c; }
  return null;
}

/** A color given by model and values, as in \definecolor{accent}{RGB}{31,78,121}. */
function modelColor(model, spec) {
  if (model === 'HTML') return /^\s*[0-9a-fA-F]{6}\s*$/.test(spec) ? fromHex(spec.trim()) : null;
  const v = spec.split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
  const n = { rgb: 3, RGB: 3, gray: 1, cmyk: 4, hsb: 3 }[model];
  if (v.length !== n || v.some(Number.isNaN)) return null;
  switch (model) {
    case 'rgb': return v;
    case 'RGB': return v.map((x) => x / 255);
    case 'gray': return [v[0], v[0], v[0]];
    case 'cmyk': return cmyk(...v);
    default: return hsb(...v);
  }
}

/**
 * The color `spec` stands for: a name (ForestGreen), a mix (red!60!black, accent!20), or values
 * in a model when one is given. meta carries the document's own colors. Null when it is unknown.
 */
export function findColor(spec, model, meta) {
  model = model ? model.trim() : '';
  if (model && model !== 'named') return modelColor(model, spec);
  const parts = spec.split('!').map((s) => s.trim());
  let c = named(parts[0], meta);
  for (let i = 1; c && i < parts.length; i += 2) {
    const p = parts[i] === '' ? NaN : Number(parts[i]);
    const other = i + 1 < parts.length ? named(parts[i + 1], meta) : [1, 1, 1];      // red!20 mixes with white
    if (Number.isNaN(p) || !other) return null;
    const a = Math.min(100, Math.max(0, p)) / 100;
    c = c.map((x, k) => x * a + other[k] * (1 - a));
  }
  return c;
}

/** The same, as CSS: '#1f4e79', or null. */
export function cssColor(spec, model, meta) {
  const c = findColor(spec, model, meta);
  return c ? '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('') : null;
}
