/* Rootline — boot, top-level rendering, menu, demo data, keyboard shortcuts, language switch. */
(function () {
'use strict';
const i18n = window.i18n, { t } = i18n;
const S = FT.S, M = FT.model, ST = FT.storage, C = FT.core, SET = FT.settings, UI = FT.ui;
const { esc } = M;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- Rendering ---------- */
function renderAll() { renderTop(); renderBanner(); FT.tree.renderTree(); UI.renderDetails(); FT.ocr.renderUploadState(); }
function renderTop() {
  const n = S.persons.size;
  $('#count').textContent = S.loaded ? (n ? M.people(n) : t('count.empty')) : '';
  $('#addPersonBtn').hidden = S.readOnly || !S.loaded;
  $('#mDemo').hidden = S.mode === 'demo' || !S.realFactory;
  $('#mExitDemo').hidden = S.mode !== 'demo';
  $('#mClear').hidden = S.readOnly || !n;
  $('#mImport').hidden = S.readOnly;
  $('#mBackups').hidden = S.readOnly || S.mode === 'demo';
  $('#mUndo').disabled = !S.history.undo.length; $('#mRedo').disabled = !S.history.redo.length;
  $('#dirBtn').setAttribute('aria-label', t(SET.current.direction === 'TB' ? 'direction.toLR' : 'direction.toTB'));
  $('#dirBtn').title = t(SET.current.direction === 'TB' ? 'direction.toLR' : 'direction.toTB');
}
function renderBanner() {
  const b = $('#banner'); let html = '';
  if (S.mode === 'demo') html = `<div class="banner-inner demo"><span>${esc(t('banner.demo'))}</span><button type="button" class="btn sm" data-banner="exitDemo">${esc(t('menu.exitDemo'))}</button></div>`;
  else if (S.loaded && S.readOnly) html = `<div class="banner-inner plain"><span>${esc(t('banner.readOnly'))}</span></div>`;
  else if (S.loaded && S.mode === 'local') html = `<div class="banner-inner plain"><span>${esc(t('banner.local'))}</span></div>`;
  b.innerHTML = html; b.hidden = !html;
}
FT.renderAll = renderAll;

/* ---------- Demo ---------- */
function demoData() {
  const P = [
    ['d1', 'Николай', 'Иванович', 'Соколов', 'm', '1898', '1963', 'Тверь', t('demo.occ.carpenter'), ''],
    ['d2', 'Анна', 'Петровна', 'Соколова', 'f', '1902', '1979', 'Торжок', '', 'Лебедева'],
    ['d3', 'Григорий', 'Степанович', 'Морозов', 'm', '1905', '1944', 'Рязань', t('demo.occ.soldier'), ''],
    ['d4', 'Евдокия', 'Фёдоровна', 'Морозова', 'f', '1908', '1991', 'Касимов', '', ''],
    ['d5', 'Пётр', 'Николаевич', 'Соколов', 'm', '1927-03-12', '2001', 'Тверь', t('demo.occ.engineer'), ''],
    ['d6', 'Мария', 'Николаевна', 'Соколова', 'f', '1931', '2015', 'Тверь', t('demo.occ.teacher'), ''],
    ['d7', 'Вера', 'Григорьевна', 'Соколова', 'f', '1934-09-02', '2019', 'Рязань', t('demo.occ.doctor'), 'Морозова'],
    ['d8', 'Алексей', 'Петрович', 'Соколов', 'm', '1958-06-21', '', 'Калинин', '', ''],
    ['d9', 'Ирина', 'Петровна', 'Белова', 'f', '1962', '', 'Калинин', '', 'Соколова'],
    ['d10', 'Елена', 'Викторовна', 'Соколова', 'f', '1960-11-04', '', 'Ленинград', '', ''],
    ['d11', 'Дмитрий', 'Алексеевич', 'Соколов', 'm', '1986', '', 'Москва', '', ''],
    ['d12', 'Ольга', 'Алексеевна', 'Соколова', 'f', '1990', '', 'Москва', '', ''],
  ];
  const notes = { d3: t('demo.note.kovel') };
  const ts = '2026-01-01T00:00:00.000Z';
  const persons = P.map(([id, firstName, patronymic, lastName, gender, birthDate, deathDate, birthCity, occupation, maidenName]) => Object.assign(M.newPersonRecord({ firstName, patronymic, lastName, gender, birthDate, deathDate, birthCity, occupation, maidenName, notes: notes[id] || '' }, 'demo'), { id, createdAt: ts, updatedAt: ts }));
  const R = [['spouse', 'd1', 'd2'], ['spouse', 'd3', 'd4'], ['parent', 'd1', 'd5'], ['parent', 'd2', 'd5'], ['parent', 'd1', 'd6'], ['parent', 'd2', 'd6'], ['parent', 'd3', 'd7'], ['parent', 'd4', 'd7'], ['spouse', 'd5', 'd7'], ['parent', 'd5', 'd8'], ['parent', 'd7', 'd8'], ['parent', 'd5', 'd9'], ['parent', 'd7', 'd9'], ['spouse', 'd8', 'd10'], ['parent', 'd8', 'd11'], ['parent', 'd10', 'd11'], ['parent', 'd8', 'd12'], ['parent', 'd10', 'd12']];
  return { persons, relations: R.map(([type, from, to]) => M.makeRel(type, from, to, { status: type === 'spouse' ? 'married' : '' })) };
}
function enterDemo() { if (S.mode === 'demo' || !S.realFactory) return; S.readOnly = false; C.useBackend(ST.makeMemoryBackend('demo', demoData(), null)); }
function exitDemo() { if (S.mode !== 'demo' || !S.realFactory) return; S.readOnly = S.realReadOnly; C.useBackend(S.realFactory()); }

/* ---------- Language ---------- */
function onLanguageChange() {
  if (S.mode === 'demo') C.useBackend(ST.makeMemoryBackend('demo', demoData(), null), { selectedId: S.selectedId, needFit: false });
  FT.scheduleRender();
  FT.ocr.renderReview();
  UI.relabelPersonDialog();
  if ($('#toolDialog').open) UI.closeTool();
}

/* ---------- Events ---------- */
function closeMenu() { $('#menu').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
function isTyping(e) { const el = e.target; return el && (el.matches('input, textarea, select, [contenteditable="true"]')); }
function anyDialogOpen() { return $$('dialog[open]').length > 0 || !$('#review').hidden; }
function bindEvents() {
  $('#langSwitch').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) i18n.setLang(b.dataset.lang); });
  document.addEventListener('languagechange', onLanguageChange);
  document.addEventListener('treechange', () => { $('#mUndo').disabled = !S.history.undo.length; $('#mRedo').disabled = !S.history.redo.length; });
  ST.photos.onChange(() => FT.scheduleRender());

  $('#addPersonBtn').onclick = () => UI.openPersonDialog({ mode: 'create' });
  $('#settingsBtn').onclick = () => FT.tools.openSettings();
  $('#menuBtn').onclick = e => { e.stopPropagation(); const m = $('#menu'); m.hidden = !m.hidden; $('#menuBtn').setAttribute('aria-expanded', String(!m.hidden)); };
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
  $('#menu').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return; closeMenu();
    const acts = { export: FT.tools.openExport, import: FT.tools.pickImportFile, stats: FT.tools.openStats, problems: FT.tools.openProblems, backups: FT.tools.openBackups, log: FT.tools.openOcrLog, undo: C.undo, redo: C.redo, demo: enterDemo, exitDemo, clear: UI.clearTree };
    acts[b.dataset.act]?.();
  });
  $('#importInput').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) FT.tools.importFile(f); });
  $('#empty').addEventListener('click', e => {
    const b = e.target.closest('[data-empty]'); if (!b) return;
    const k = b.dataset.empty;
    if (k === 'add') UI.openPersonDialog({ mode: 'create' }); else if (k === 'upload') FT.ocr.pickFile(); else if (k === 'import') FT.tools.pickImportFile(); else enterDemo();
  });
  $('#banner').addEventListener('click', e => { if (e.target.closest('[data-banner="exitDemo"]')) exitDemo(); });
  $('#zoomIn').onclick = () => FT.tree.zoomBy(1.3);
  $('#zoomOut').onclick = () => FT.tree.zoomBy(1 / 1.3);
  $('#zoomFit').onclick = () => FT.tree.fitView(true);
  $('#dirBtn').onclick = () => SET.set({ direction: SET.current.direction === 'TB' ? 'LR' : 'TB' });
  const svg = $('#treeSvg');
  svg.addEventListener('click', e => { if (FT.tree.suppressClick || e.target.closest('.port, .hit')) return; const g = e.target.closest('.person'); UI.select(g ? g.dataset.id : null, { scrollPanel: !!g }); });
  svg.addEventListener('dblclick', e => { const g = e.target.closest('.person'); if (g && !S.readOnly) UI.openPersonDialog({ mode: 'edit', id: g.dataset.id }); });
  svg.addEventListener('keydown', e => { const g = e.target.closest('.person'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); UI.select(g.dataset.id, { center: true, scrollPanel: true }); } });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); if (!anyDialogOpen()) C.undo(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !isTyping(e)) { e.preventDefault(); if (!anyDialogOpen()) C.redo(); return; }
    if (anyDialogOpen() || isTyping(e)) return;
    if (e.key === 'Escape') { if (S.selectedId) UI.select(null); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selectedId && !S.readOnly) { e.preventDefault(); UI.deletePerson(S.selectedId); return; }
    if (e.key === 'Enter' && S.selectedId && !S.readOnly) { e.preventDefault(); UI.openPersonDialog({ mode: 'edit', id: S.selectedId }); return; }
    if (e.key === '/' ) { e.preventDefault(); $('#search').focus(); return; }
    if (e.key === 'n' && !mod && !S.readOnly && S.loaded) { e.preventDefault(); UI.openPersonDialog({ mode: 'create' }); return; }
    if (e.key === 'f' && !mod) { e.preventDefault(); FT.tree.fitView(true); return; }
    if ((e.key === '+' || e.key === '=') && !mod) { FT.tree.zoomBy(1.3); return; }
    if (e.key === '-' && !mod) { FT.tree.zoomBy(1 / 1.3); return; }
  });
  UI.bind(); FT.ocr.bind();
}

/* ---------- Boot ---------- */
async function initCaps() {
  const c = window.claude;
  const localFactory = () => ST.makeMemoryBackend('local', ST.loadLocal(), ST.LS.tree);
  if (!c || typeof c.use !== 'function') {
    S.caps.claude = false;
    S.realFactory = localFactory; C.useBackend(localFactory());
    await ST.photos.use('local');
    FT.ocr.refreshProvider();
    return;
  }
  S.caps.claude = true;
  c.use('sample').then(async sample => {
    if (!sample) { S.caps.sampleState = 'unavailable'; S.caps.sampleNoteKey = 'caps.unavailableSignIn'; FT.scheduleRender(); return; }
    const lim = await sample.limits().catch(() => null);
    if (!lim || !lim.images) { S.caps.sampleState = 'unavailable'; S.caps.sampleNoteKey = 'caps.noImages'; FT.scheduleRender(); return; }
    S.caps.sample = sample; S.caps.sampleLimits = lim; FT.ocr.refreshProvider();
  }).catch(() => { S.caps.sampleState = 'unavailable'; S.caps.sampleNoteKey = 'caps.unavailable'; FT.scheduleRender(); });
  c.use('downloads').then(d => { S.caps.downloads = d; FT.scheduleRender(); }).catch(() => {});
  let db = null;
  try { db = await c.use('db'); } catch (e) { db = null; }
  if (db) {
    let user = null;
    try { user = await c.use('user'); } catch (e) { user = null; }
    if (user) { try { S.canWrite = await user.can('data.write'); } catch (e) { S.canWrite = null; } }
    if (S.canWrite === false) { S.realReadOnly = true; S.readOnly = S.mode === 'demo' ? false : true; }
    S.realFactory = () => ST.makeDbBackend(db);
    await ST.photos.use('db', db);
  } else { S.realFactory = localFactory; await ST.photos.use('local'); }
  if (S.mode !== 'demo') C.useBackend(S.realFactory());
}

i18n.applyStatic();
FT.tree.initZoom();
FT.tree.initLinkDrag();
bindEvents();
FT.scheduleRender();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => FT.scheduleRender());
initCaps();
})();
