/* Rootline — appearance settings: themes, fonts, node and layout options. Persisted in localStorage. */
(function () {
'use strict';
const ST = FT.storage;

const THEMES = ['auto', 'light', 'dark', 'parchment', 'minimal'];
/* Font pairings: [names/headings, interface]. Google Fonts are loaded on demand. */
const FONT_PAIRS = {
  literata: { name: '"Literata", "PT Serif", Georgia, serif', ui: '"Golos Text", "PT Sans", system-ui, sans-serif', gf: 'family=Golos+Text:wght@400;500;600&family=Literata:opsz,wght@7..72,400;7..72,600' },
  ptserif: { name: '"PT Serif", Georgia, serif', ui: '"PT Sans", system-ui, sans-serif', gf: 'family=PT+Serif:wght@400;700&family=PT+Sans:wght@400;700' },
  spectral: { name: '"Spectral", Georgia, serif', ui: '"Inter", system-ui, sans-serif', gf: 'family=Spectral:wght@400;600&family=Inter:wght@400;500;600' },
  merriweather: { name: '"Merriweather", Georgia, serif', ui: '"Source Sans 3", system-ui, sans-serif', gf: 'family=Merriweather:wght@400;700&family=Source+Sans+3:wght@400;600' },
  sans: { name: '"Golos Text", system-ui, sans-serif', ui: '"Golos Text", system-ui, sans-serif', gf: 'family=Golos+Text:wght@400;500;600' },
  system: { name: 'Georgia, "Times New Roman", serif', ui: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', gf: '' },
};
const NODE_SIZES = {
  compact: { W: 164, H: 56, avatar: 13, lines: 2, fontName: 12.5, fontLast: 11.5, fontMeta: 10.5 },
  normal: { W: 196, H: 72, avatar: 16, lines: 3, fontName: 13.5, fontLast: 12.5, fontMeta: 11.5 },
  large: { W: 248, H: 96, avatar: 24, lines: 3, fontName: 16, fontLast: 14, fontMeta: 12.5 },
};
const DEFAULTS = {
  theme: 'auto', fontPair: 'literata', fontSize: 14, nodeSize: 'normal',
  showDates: true, showPlaces: true, showPhotos: true, colorBy: 'none',
  direction: 'TB', spacing: 1,
  model: 'claude-opus-5-5',
};
const current = Object.assign({}, DEFAULTS, sanitize(ST.settingsStore.load() || {}));

function sanitize(s) {
  const o = {};
  if (THEMES.includes(s.theme)) o.theme = s.theme;
  if (FONT_PAIRS[s.fontPair]) o.fontPair = s.fontPair;
  if ([13, 14, 15, 16, 17].includes(+s.fontSize)) o.fontSize = +s.fontSize;
  if (NODE_SIZES[s.nodeSize]) o.nodeSize = s.nodeSize;
  for (const k of ['showDates', 'showPlaces', 'showPhotos']) if (typeof s[k] === 'boolean') o[k] = s[k];
  if (['none', 'generation', 'branch'].includes(s.colorBy)) o.colorBy = s.colorBy;
  if (['TB', 'LR'].includes(s.direction)) o.direction = s.direction;
  if (typeof s.spacing === 'number' && s.spacing >= 0.6 && s.spacing <= 1.8) o.spacing = Math.round(s.spacing * 10) / 10;
  if (typeof s.model === 'string' && /^claude-[a-z0-9-]+$/.test(s.model)) o.model = s.model;
  return o;
}

let fontLink = null;
function applyFonts() {
  const pair = FONT_PAIRS[current.fontPair] || FONT_PAIRS.literata;
  const root = document.documentElement;
  root.style.setProperty('--font-name', pair.name);
  root.style.setProperty('--font-ui', pair.ui);
  root.style.setProperty('--font-size', current.fontSize + 'px');
  if (pair.gf) {
    const href = 'https://fonts.googleapis.com/css2?' + pair.gf + '&display=swap';
    if (!fontLink) { fontLink = document.createElement('link'); fontLink.rel = 'stylesheet'; document.head.append(fontLink); }
    if (fontLink.href !== href) { fontLink.href = href; if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => FT.scheduleRender && FT.scheduleRender()); }
  }
}
function apply() {
  const root = document.documentElement;
  if (current.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', current.theme);
  root.dataset.nodeSize = current.nodeSize;
  applyFonts();
}
function set(patch, { render = true } = {}) {
  const clean = sanitize(patch);
  let changed = false;
  for (const k of Object.keys(clean)) if (current[k] !== clean[k]) { current[k] = clean[k]; changed = true; }
  if (!changed) return false;
  ST.settingsStore.save(current);
  apply();
  const relayout = Object.keys(clean).some(k => ['direction', 'spacing', 'nodeSize', 'showDates', 'showPlaces', 'showPhotos', 'colorBy', 'fontPair', 'fontSize'].includes(k));
  if (render && FT.scheduleRender) { if (relayout) FT.S.needFit = Object.keys(clean).some(k => ['direction', 'nodeSize'].includes(k)); FT.scheduleRender(); }
  document.dispatchEvent(new CustomEvent('settingschange', { detail: clean }));
  return true;
}
/* Resolve the effective theme (for export renderers that need concrete colors). */
function effectiveTheme() {
  if (current.theme !== 'auto') return current.theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

FT.settings = { THEMES, FONT_PAIRS, NODE_SIZES, DEFAULTS, get: () => ({ ...current }), get current() { return current; }, set, apply, effectiveTheme, cssVar, nodeSize: () => NODE_SIZES[current.nodeSize] || NODE_SIZES.normal, exportable: () => ({ ...current, model: undefined }) };
apply();
})();
