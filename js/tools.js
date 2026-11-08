/* Rootline — tool dialogs: settings, export, import (JSON / GEDCOM), backups, statistics, problems, recognition log. */
(function () {
'use strict';
const { t } = window.i18n;
const T = window.i18n.translit;
const S = FT.S, M = FT.model, ST = FT.storage, C = FT.core, SET = FT.settings, UI = FT.ui;
const { esc, fullName, shortName, labelWithYear, lifeSpan, fmtDate } = M;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmtWhen = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(window.i18n.lang === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };

/* ---------- Settings ---------- */
function openSettings() {
  const s = SET.current;
  const radio = (name, value, label, checked) => `<label class="check"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}> ${esc(label)}</label>`;
  const html = `
    <section class="st-section"><h3>${esc(t('settings.theme'))}</h3><div class="theme-grid">${SET.THEMES.map(th => `<label class="theme-card${s.theme === th ? ' on' : ''}" data-theme-preview="${th}"><input type="radio" name="stTheme" value="${th}" ${s.theme === th ? 'checked' : ''}><span class="swatch"><i></i><i></i><i></i></span><span>${esc(t('theme.' + th))}</span></label>`).join('')}</div></section>
    <section class="st-section"><h3>${esc(t('settings.type'))}</h3>
      <div class="form-grid">
        <div class="field span-3"><label for="stFont">${esc(t('settings.fontPair'))}</label><select id="stFont">${Object.keys(SET.FONT_PAIRS).map(k => `<option value="${k}" ${s.fontPair === k ? 'selected' : ''}>${esc(t('font.' + k))}</option>`).join('')}</select></div>
        <div class="field span-3"><label for="stSize">${esc(t('settings.fontSize'))}</label><select id="stSize">${[13, 14, 15, 16, 17].map(n => `<option value="${n}" ${s.fontSize === n ? 'selected' : ''}>${n}px</option>`).join('')}</select></div>
      </div></section>
    <section class="st-section"><h3>${esc(t('settings.nodes'))}</h3>
      <div class="field"><span class="lbl">${esc(t('settings.nodeSize'))}</span><div class="seg" id="stNodeSize">${['compact', 'normal', 'large'].map(k => `<button type="button" data-v="${k}" aria-pressed="${s.nodeSize === k}">${esc(t('nodeSize.' + k))}</button>`).join('')}</div></div>
      <div class="checks">
        <label class="check"><input type="checkbox" id="stDates" ${s.showDates ? 'checked' : ''}> ${esc(t('settings.showDates'))}</label>
        <label class="check"><input type="checkbox" id="stPlaces" ${s.showPlaces ? 'checked' : ''}> ${esc(t('settings.showPlaces'))}</label>
        <label class="check"><input type="checkbox" id="stPhotos" ${s.showPhotos ? 'checked' : ''}> ${esc(t('settings.showPhotos'))}</label>
      </div>
      <div class="field"><label for="stColor">${esc(t('settings.colorBy'))}</label><select id="stColor">${['none', 'generation', 'branch'].map(k => `<option value="${k}" ${s.colorBy === k ? 'selected' : ''}>${esc(t('colorBy.' + k))}</option>`).join('')}</select></div></section>
    <section class="st-section"><h3>${esc(t('settings.layout'))}</h3>
      <div class="field"><span class="lbl">${esc(t('settings.direction'))}</span><div class="seg" id="stDir">${['TB', 'LR'].map(k => `<button type="button" data-v="${k}" aria-pressed="${s.direction === k}">${esc(t('direction.' + k))}</button>`).join('')}</div></div>
      <div class="field"><label for="stSpacing">${esc(t('settings.spacing'))} <span class="muted" id="stSpacingVal">${Math.round(s.spacing * 100)}%</span></label><input type="range" id="stSpacing" min="0.6" max="1.8" step="0.1" value="${s.spacing}"></div></section>
    <section class="st-section"><h3>${esc(t('settings.recognition'))}</h3>
      <p class="hint">${esc(t('settings.recognitionNote'))}</p>
      ${S.caps.claude ? `<p class="hint ok">${esc(t('settings.recognitionInClaude'))}</p>` : `
      <div class="field"><label for="stKey">${esc(t('settings.apiKey'))}</label><input type="password" id="stKey" autocomplete="off" value="${esc(ST.apiKey.get())}" placeholder="sk-ant-…"><p class="hint">${esc(t('settings.apiKeyHint'))}</p></div>
      <div class="field"><label for="stModel">${esc(t('settings.model'))}</label><select id="stModel">${['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'].map(m => `<option value="${m}" ${s.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>`}
    </section>`;
  const d = UI.openTool({ title: t('settings.title'), html, foot: `<button type="button" class="btn ghost" data-td="reset">${esc(t('settings.reset'))}</button><span class="spacer"></span><button type="button" class="btn primary" data-td="close">${esc(t('settings.done'))}</button>` });
  const apply = () => {
    const patch = {
      theme: d.querySelector('input[name="stTheme"]:checked')?.value, fontPair: $('#stFont', d).value, fontSize: +$('#stSize', d).value,
      showDates: $('#stDates', d).checked, showPlaces: $('#stPlaces', d).checked, showPhotos: $('#stPhotos', d).checked, colorBy: $('#stColor', d).value,
      spacing: +$('#stSpacing', d).value,
      nodeSize: d.querySelector('#stNodeSize [aria-pressed="true"]')?.dataset.v, direction: d.querySelector('#stDir [aria-pressed="true"]')?.dataset.v,
    };
    const model = $('#stModel', d); if (model) patch.model = model.value;
    SET.set(patch);
    $$('.theme-card', d).forEach(c => c.classList.toggle('on', c.querySelector('input').checked));
    $('#stSpacingVal', d).textContent = Math.round(patch.spacing * 100) + '%';
    const key = $('#stKey', d); if (key) { ST.apiKey.set(key.value.trim()); FT.ocr.refreshProvider(); }
  };
  d.addEventListener('input', apply); d.addEventListener('change', apply);
  d.onclick = e => {
    const seg = e.target.closest('.seg button'); if (seg) { $$('button', seg.parentElement).forEach(b => b.setAttribute('aria-pressed', String(b === seg))); apply(); return; }
    const b = e.target.closest('[data-td]'); if (!b) return;
    if (b.dataset.td === 'reset') { SET.set(SET.DEFAULTS); UI.closeTool(); openSettings(); }
    else UI.closeTool();
  };
}

/* ---------- Export ---------- */
function formatHelpHtml() {
  const fields = M.FIELDS.map(f => `<li><code>${f.key}</code> — ${esc(M.fieldLabel(f))}${f.type === 'date' ? ` (${esc(t('format.dateHint'))})` : f.key === 'gender' ? ` (<code>m</code> / <code>f</code> / <code>""</code>)` : ''}</li>`).join('');
  return `<details class="help"><summary>${esc(t('format.title'))}</summary>
    <p>${esc(t('format.intro'))}</p>
<pre>{
  "app": "rootline", "schema": ${M.SCHEMA}, "exportedAt": "2026-01-01T12:00:00.000Z",
  "settings": { "theme": "light", … },
  "persons": [ { "id": "p_…", "firstName": "…", "lastName": "…", "birthDate": "1932-05-14",
                 "photos": ["ph_…"], "mainPhoto": "ph_…", "placeholder": false, … } ],
  "relations": [ { "id": "par_&lt;parent&gt;_&lt;child&gt;", "type": "parent", "from": "p_parent", "to": "p_child", "adopted": false },
                 { "id": "sp_&lt;a&gt;_&lt;b&gt;", "type": "spouse", "from": "p_a", "to": "p_b", "status": "married" } ],
  "photos": [ { "id": "ph_…", "personId": "p_…", "dataUrl": "data:image/jpeg;base64,…", "w": 1600, "h": 1200 } ]
}</pre>
    <p>${esc(t('format.personFields'))}</p><ul class="help-list">${fields}</ul>
    <p>${esc(t('format.relations'))}</p>
    <p>${esc(t('format.rules'))}</p>
  </details>`;
}
function openExport() {
  const n = S.persons.size;
  const html = `
    <p class="lead">${esc(t('export.lead', { people: M.people(n), links: M.links(S.relations.size) }))}</p>
    <div class="tool-list">
      <div class="tool-row"><div><strong>JSON</strong><p class="hint">${esc(t('export.jsonHint'))}</p><label class="check"><input type="checkbox" id="exNoPhotos"> ${esc(t('export.noPhotos'))}</label></div><button type="button" class="btn primary" data-ex="json" ${n ? '' : 'disabled'}>${esc(t('export.download'))}</button></div>
      <div class="tool-row"><div><strong>GEDCOM</strong><p class="hint">${esc(t('export.gedcomHint'))}</p></div><button type="button" class="btn" data-ex="gedcom" ${n ? '' : 'disabled'}>${esc(t('export.download'))}</button></div>
      <div class="tool-row"><div><strong>PNG</strong><p class="hint">${esc(t('export.pngHint'))}</p></div><button type="button" class="btn" data-ex="png" ${n ? '' : 'disabled'}>${esc(t('export.download'))}</button></div>
      <div class="tool-row"><div><strong>PDF</strong><p class="hint">${esc(t('export.pdfHint'))}</p></div><button type="button" class="btn" data-ex="pdf" ${n ? '' : 'disabled'}>${esc(t('export.download'))}</button></div>
    </div>
    ${formatHelpHtml()}`;
  const d = UI.openTool({ title: t('export.title'), html });
  d.onclick = async e => {
    const b = e.target.closest('[data-ex]'); if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.ex === 'json') await FT.exp.exportJson({ withPhotos: !$('#exNoPhotos', d).checked });
      else if (b.dataset.ex === 'gedcom') await FT.exp.exportGedcom();
      else if (b.dataset.ex === 'png') await FT.exp.exportPng();
      else if (b.dataset.ex === 'pdf') await FT.exp.exportPdf();
    } catch (err) { C.toast(t('export.errFail'), { kind: 'error' }); }
    b.disabled = false;
  };
}

/* ---------- Import ---------- */
function pickImportFile() { const inp = $('#importInput'); inp.value = ''; inp.click(); }
async function importFile(file) {
  if (!file || S.readOnly) return;
  let text; try { text = await ST.readText(file); } catch (e) { C.toast(t('import.errRead'), { kind: 'error' }); return; }
  let res;
  if (/\.ged$/i.test(file.name) || /^\s*0\s+HEAD/.test(text)) res = FT.exp.parseGedcom(text);
  else { let raw; try { raw = JSON.parse(text); } catch (e) { C.toast(t('import.errJson'), { kind: 'error' }); return; } res = M.validateImport(raw); }
  if (!res.ok) { C.toast(res.error, { kind: 'error', ms: 10000 }); return; }
  openImportSummary(res, file.name);
}
function openImportSummary(res, fileName) {
  const empty = S.persons.size === 0;
  const w = res.warnings || {}, dropped = (w.badPersons || 0) + (w.badRelations || 0);
  const html = `
    <p class="lead">${esc(t('import.summary', { file: fileName, people: M.people(res.persons.size), links: M.links(res.relations.size) }))}${res.photos.length ? ' ' + esc(t('import.photosCount', { n: res.photos.length })) : ''}</p>
    ${dropped ? `<p class="rv-warn">${esc(t('import.dropped', { people: w.badPersons || 0, links: w.badRelations || 0 }))}</p>` : ''}
    ${res.settings ? `<label class="check"><input type="checkbox" id="imSettings"> ${esc(t('import.applySettings'))}</label>` : ''}
    ${empty ? `<p class="muted">${esc(t('import.emptyTree'))}</p>` : `<p class="muted">${esc(t('import.choose', { people: M.people(S.persons.size) }))}</p>`}
    ${formatHelpHtml()}`;
  const foot = empty
    ? `<span class="spacer"></span><button type="button" class="btn" data-im="cancel">${esc(t('pd.cancel'))}</button><button type="button" class="btn primary" data-im="replace">${esc(t('import.import'))}</button>`
    : `<button type="button" class="btn ghost danger" data-im="replace">${esc(t('import.replace'))}</button><span class="spacer"></span><button type="button" class="btn" data-im="cancel">${esc(t('pd.cancel'))}</button><button type="button" class="btn primary" data-im="merge">${esc(t('import.merge'))}</button>`;
  const d = UI.openTool({ title: t('import.title'), html, foot });
  d.onclick = async e => {
    const b = e.target.closest('[data-im]'); if (!b) return;
    const applySettings = !!$('#imSettings', d)?.checked;
    if (b.dataset.im === 'cancel') return UI.closeTool();
    if (b.dataset.im === 'replace') {
      UI.closeTool();
      if (!empty && !(await UI.confirmAction({ title: t('import.replaceTitle'), text: t('import.replaceText'), okLabel: t('import.replace') }))) return;
      await doReplace(res, applySettings); return;
    }
    UI.closeTool(); planMerge(res, applySettings);
  };
}
async function importPhotos(photoList, idMap, photoIdMap) {
  for (const ph of photoList) {
    const personId = idMap.get(ph.personId) || ph.personId;
    const id = photoIdMap.get(ph.id) || ph.id;
    await ST.photos.put({ id, personId, dataUrl: ph.dataUrl, w: ph.w, h: ph.h });
  }
}
async function doReplace(res, applySettings) {
  const persons = new Map(), relations = new Map();
  for (const p of res.persons.values()) persons.set(p.id, { ...p });
  for (const r of res.relations.values()) relations.set(r.id, r);
  // Only keep photo references that actually came with the file.
  const have = new Set(res.photos.map(ph => ph.id));
  for (const p of persons.values()) { p.photos = (p.photos || []).filter(id => have.has(id)); p.mainPhoto = p.photos.includes(p.mainPhoto) ? p.mainPhoto : (p.photos[0] || ''); }
  await ST.photos.clear();
  await importPhotos(res.photos, new Map(), new Map());
  const ok = await C.replaceTree(persons, relations, t('import.done', { people: M.people(persons.size), links: M.links(relations.size) }));
  if (ok) { if (applySettings && res.settings) SET.set(res.settings); S.selectedId = null; S.needFit = true; FT.scheduleRender(); }
}
/* Merge: same-id persons are updated (empty fields filled), name duplicates are resolved by the user, the rest are added. */
function planMerge(res, applySettings) {
  const dups = [];
  for (const p of res.persons.values()) {
    if (S.persons.has(p.id)) continue;
    const cands = M.duplicateCandidates(p, S.persons);
    if (cands.length) dups.push({ p, cands });
  }
  if (!dups.length) return doMerge(res, new Map(), applySettings);
  const html = `<p class="lead">${esc(t('import.dupLead', { n: dups.length }))}</p>
    <div class="dup-list">${dups.map((dp, i) => `<div class="dup-row"><div class="dup-name"><strong>${esc(labelWithYear(dp.p))}</strong>${dp.p.birthCity ? `<small class="muted"> · ${esc(T(dp.p.birthCity))}</small>` : ''}</div>
      <select data-dup="${i}"><option value="">${esc(t('import.dupAddNew'))}</option>${dp.cands.map(c => `<option value="${esc(c.id)}" ${c === dp.cands[0] ? 'selected' : ''}>${esc(t('import.dupSame', { name: labelWithYear(c) }))}</option>`).join('')}</select></div>`).join('')}</div>`;
  const d = UI.openTool({ title: t('import.dupTitle'), html, foot: `<span class="spacer"></span><button type="button" class="btn" data-im="cancel">${esc(t('pd.cancel'))}</button><button type="button" class="btn primary" data-im="go">${esc(t('import.merge'))}</button>` });
  d.onclick = e => {
    const b = e.target.closest('[data-im]'); if (!b) return;
    if (b.dataset.im === 'cancel') return UI.closeTool();
    const sameAs = new Map();
    $$('select[data-dup]', d).forEach(sel => { const dp = dups[+sel.dataset.dup]; if (sel.value) sameAs.set(dp.p.id, sel.value); });
    UI.closeTool(); doMerge(res, sameAs, applySettings);
  };
}
function fillEmpty(existing, incoming) {
  const out = { ...existing }; let changed = false;
  for (const f of M.FIELDS) if (!out[f.key] && incoming[f.key]) { out[f.key] = incoming[f.key]; changed = true; }
  if (existing.placeholder && (incoming.firstName || incoming.lastName)) { out.placeholder = false; changed = true; }
  return changed ? { ...out, updatedAt: M.nowIso() } : null;
}
async function doMerge(res, sameAs, applySettings) {
  const idMap = new Map(), ops = []; let added = 0, updated = 0, skipped = 0;
  const P = new Map(S.persons), R = new Map(S.relations);
  const photoIdMap = new Map(), have = new Set(res.photos.map(ph => ph.id));
  for (const p of res.persons.values()) {
    const target = S.persons.has(p.id) ? p.id : sameAs.get(p.id);
    if (target) {
      idMap.set(p.id, target);
      const ex = P.get(target), upd = fillEmpty(ex, p);
      // bring photos along (up to the limit)
      const newPhotos = (p.photos || []).filter(id => have.has(id)).map(id => { const nid = ST.photos.get(id) ? M.uid('ph') : id; photoIdMap.set(id, nid); return nid; });
      const merged = upd || { ...ex };
      const room = M.MAX_PHOTOS - (merged.photos || []).length;
      if (newPhotos.length && room > 0) { merged.photos = [...(merged.photos || []), ...newPhotos.slice(0, room)]; merged.mainPhoto = merged.mainPhoto || merged.photos[0]; merged.updatedAt = M.nowIso(); }
      if (upd || (newPhotos.length && room > 0)) { ops.push({ t: 'putPerson', p: merged }); P.set(target, merged); updated++; }
    } else {
      const id = S.persons.has(p.id) ? M.uid('p') : p.id; idMap.set(p.id, id);
      const rec = { ...p, id, origin: p.origin === 'gedcom' ? 'gedcom' : 'import' };
      rec.photos = (rec.photos || []).filter(x => have.has(x)).map(x => { const nid = ST.photos.get(x) ? M.uid('ph') : x; photoIdMap.set(x, nid); return nid; });
      rec.mainPhoto = rec.photos.includes(photoIdMap.get(rec.mainPhoto)) ? photoIdMap.get(rec.mainPhoto) : (rec.photos[0] || '');
      ops.push({ t: 'putPerson', p: rec }); P.set(id, rec); added++;
    }
  }
  let idx = M.buildIndex(P, R), links = 0;
  for (const r of res.relations.values()) {
    const from = idMap.get(r.from), to = idMap.get(r.to); if (!from || !to || from === to) { skipped++; continue; }
    const problem = r.type === 'parent' ? M.checkParentLink(idx, from, to) : M.checkSpouseLink(idx, from, to);
    if (problem) { skipped++; continue; }
    const rel = M.makeRel(r.type, from, to, r); ops.push({ t: 'putRel', r: rel }); R.set(rel.id, rel); idx = M.buildIndex(P, R); links++;
  }
  await importPhotos(res.photos, idMap, photoIdMap);
  const ok = await C.applyOps(ops, { label: t('import.mergeDone', { added: M.people(added), updated: M.people(updated), links }), reason: 'import' });
  if (ok) { if (skipped) C.toast(t('import.skippedLinks', { n: skipped })); if (applySettings && res.settings) SET.set(res.settings); S.needFit = true; FT.scheduleRender(); }
}

/* ---------- Backups ---------- */
function openBackups() {
  const list = ST.backups.list();
  const html = list.length
    ? `<p class="lead">${esc(t('backups.lead', { n: ST.backups.MAX }))}</p><div class="tool-list">${list.map((b, i) => `<div class="tool-row"><div><strong>${esc(fmtWhen(b.at))}</strong><p class="hint">${esc(M.people(b.persons.length))}, ${esc(M.links(b.relations.length))} · ${esc(t('backups.reason.' + (b.reason || 'edit')))}</p></div><button type="button" class="btn" data-restore="${i}">${esc(t('backups.restore'))}</button></div>`).join('')}</div>`
    : `<p class="lead">${esc(t('backups.empty'))}</p>`;
  const d = UI.openTool({ title: t('backups.title'), html, foot: list.length ? `<button type="button" class="btn ghost danger" data-bk="clear">${esc(t('backups.clear'))}</button>` : '' });
  d.onclick = async e => {
    const b = e.target.closest('[data-restore]');
    if (b) {
      const snap = list[+b.dataset.restore]; UI.closeTool();
      if (!(await UI.confirmAction({ title: t('backups.restoreTitle'), text: t('backups.restoreText', { when: fmtWhen(snap.at), people: M.people(snap.persons.length) }), okLabel: t('backups.restore'), danger: false }))) return;
      const persons = new Map(), relations = new Map();
      for (const p of snap.persons) { const m = M.migratePerson(p); if (m) persons.set(m.id, m); }
      for (const r of snap.relations) { const m = M.migrateRelation(r); if (m && persons.has(m.from) && persons.has(m.to)) relations.set(m.id, m); }
      if (await C.replaceTree(persons, relations, t('backups.restored'))) { S.needFit = true; FT.scheduleRender(); }
      return;
    }
    if (e.target.closest('[data-bk="clear"]')) { ST.backups.clear(); UI.closeTool(); C.toast(t('backups.cleared')); }
  };
}

/* ---------- Statistics ---------- */
function openStats() {
  const st = M.stats(S.persons, S.relations, S.idx);
  const row = (k, v, extra) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}${extra ? ` <span class="muted">${esc(extra)}</span>` : ''}</td></tr>`;
  const personLink = p => (p ? `<button type="button" class="link" data-go="${esc(p.id)}">${esc(labelWithYear(p))}</button>` : '—');
  const html = `<table class="stats">
    ${row(t('stats.total'), st.total)}
    ${row(t('stats.gender'), `${st.men} / ${st.women}`, st.unknownGender ? t('stats.unknownGender', { n: st.unknownGender }) : '')}
    ${row(t('stats.living'), st.total - st.deceased, t('stats.deceased', { n: st.deceased }))}
    ${row(t('stats.generations'), st.generations)}
    ${row(t('stats.couples'), st.couples, st.divorced ? t('stats.divorced', { n: st.divorced }) : '')}
    ${row(t('stats.links'), st.links)}
    <tr><th>${esc(t('stats.oldest'))}</th><td>${personLink(st.oldest)}</td></tr>
    <tr><th>${esc(t('stats.youngest'))}</th><td>${personLink(st.youngest)}</td></tr>
    ${row(t('stats.missingBirth'), st.missingBirth)}
    ${row(t('stats.withPhotos'), st.withPhotos)}
    ${st.placeholders ? row(t('stats.placeholders'), st.placeholders) : ''}
    ${st.isolated ? row(t('stats.isolated'), st.isolated) : ''}
  </table>`;
  const d = UI.openTool({ title: t('stats.title'), html });
  d.onclick = e => { const b = e.target.closest('[data-go]'); if (b) { UI.closeTool(); UI.select(b.dataset.go, { center: true, scrollPanel: true }); UI.flashNode(b.dataset.go); } };
}

/* ---------- Problems ---------- */
function openProblems() {
  const list = M.problems(S.persons, S.relations, S.idx);
  const html = list.length
    ? `<p class="lead">${esc(t('problems.lead', { n: list.length }))}</p><div class="tool-list">${list.map((pr, i) => `<div class="tool-row problem ${pr.kind}"><div><p>${esc(pr.text)}</p></div><div class="row">${pr.fixes.map(f => `<button type="button" class="btn sm ${f.act === 'delete' || f.act === 'unlink' ? 'ghost danger' : f.act === 'merge' || f.act === 'swap' ? 'primary' : ''}" data-fix="${f.act}" data-i="${i}" ${S.readOnly && f.act !== 'open' ? 'disabled' : ''}>${esc(f.label)}</button>`).join('')}</div></div>`).join('')}</div>`
    : `<p class="lead ok">${esc(t('problems.none'))}</p>`;
  const d = UI.openTool({ title: t('problems.title'), html, wide: true });
  d.onclick = async e => {
    const b = e.target.closest('[data-fix]'); if (!b) return;
    const pr = list[+b.dataset.i], act = b.dataset.fix;
    if (act === 'open') { UI.closeTool(); UI.select(pr.ids[pr.ids.length - 1], { center: true, scrollPanel: true }); UI.flashNode(pr.ids[pr.ids.length - 1]); return; }
    if (act === 'edit') { UI.closeTool(); UI.openPersonDialog({ mode: 'edit', id: pr.ids[0] }); return; }
    if (act === 'delete') { UI.closeTool(); await UI.deletePerson(pr.ids[0]); return; }
    if (act === 'unlink') { if (await C.applyOps([{ t: 'delRel', id: pr.relId }], { label: t('toast.linkRemoved') })) openProblems(); return; }
    if (act === 'swap') {
      const r = S.relations.get(pr.relId); if (!r) return;
      const idx = M.buildIndex(S.persons, new Map([...S.relations].filter(([id]) => id !== r.id)));
      const problem = M.checkParentLink(idx, r.to, r.from);
      if (problem) { C.toast(problem, { kind: 'error' }); return; }
      if (await C.applyOps([{ t: 'delRel', id: r.id }, { t: 'putRel', r: M.makeRel('parent', r.to, r.from, r) }], { label: t('problems.swapped') })) openProblems();
      return;
    }
    if (act === 'merge') { UI.closeTool(); openMergeDialog(pr.ids); }
  };
}
/* Merge several records into one: keep one person, fill its empty fields, move links and photos, delete the rest. */
function openMergeDialog(ids) {
  const ppl = ids.map(id => S.persons.get(id)).filter(Boolean); if (ppl.length < 2) return;
  const html = `<p class="lead">${esc(t('merge.lead'))}</p>
    <fieldset class="extra"><legend>${esc(t('merge.keep'))}</legend>${ppl.map((p, i) => `<label class="check"><input type="radio" name="mgKeep" value="${esc(p.id)}" ${i === 0 ? 'checked' : ''}> ${esc(labelWithYear(p))}${p.birthCity ? ` <small class="muted">· ${esc(T(p.birthCity))}</small>` : ''} <small class="muted">· ${esc(t('merge.linksCount', { n: [...S.relations.values()].filter(r => r.from === p.id || r.to === p.id).length }))}</small></label>`).join('')}</fieldset>
    <p class="hint">${esc(t('merge.hint'))}</p>`;
  const d = UI.openTool({ title: t('merge.title'), html, foot: `<span class="spacer"></span><button type="button" class="btn" data-mg="cancel">${esc(t('pd.cancel'))}</button><button type="button" class="btn primary" data-mg="go">${esc(t('merge.go'))}</button>` });
  d.onclick = async e => {
    const b = e.target.closest('[data-mg]'); if (!b) return;
    if (b.dataset.mg === 'cancel') return UI.closeTool();
    const keepId = d.querySelector('input[name="mgKeep"]:checked').value;
    UI.closeTool();
    await mergePersons(keepId, ids.filter(id => id !== keepId));
  };
}
async function mergePersons(keepId, otherIds) {
  const keep = S.persons.get(keepId); if (!keep) return;
  let merged = { ...keep }; const ops = [];
  const P = new Map(S.persons), R = new Map(S.relations);
  for (const oid of otherIds) {
    const o = S.persons.get(oid); if (!o) continue;
    merged = fillEmpty(merged, o) || merged;
    const room = M.MAX_PHOTOS - merged.photos.length;
    if (room > 0 && o.photos.length) { merged.photos = [...merged.photos, ...o.photos.slice(0, room)]; merged.mainPhoto = merged.mainPhoto || merged.photos[0]; }
    if (o.notes && merged.notes !== o.notes && !merged.notes.includes(o.notes)) merged.notes = [merged.notes, o.notes].filter(Boolean).join('\n');
    for (const r of [...R.values()].filter(x => x.from === oid || x.to === oid)) {
      ops.push({ t: 'delRel', id: r.id }); R.delete(r.id);
      const from = r.from === oid ? keepId : r.from, to = r.to === oid ? keepId : r.to;
      if (from === to) continue;
      const idx = M.buildIndex(P, R);
      const problem = r.type === 'parent' ? M.checkParentLink(idx, from, to) : M.checkSpouseLink(idx, from, to);
      if (problem) continue;
      const nr = M.makeRel(r.type, from, to, r); ops.push({ t: 'putRel', r: nr }); R.set(nr.id, nr);
    }
    ops.push({ t: 'delPerson', id: oid }); P.delete(oid);
    for (const ph of ST.photos.forPerson(o)) if (merged.photos.includes(ph.id)) await ST.photos.put({ ...ph, personId: keepId });
  }
  merged.updatedAt = M.nowIso();
  ops.unshift({ t: 'putPerson', p: merged });
  if (await C.applyOps(ops, { label: t('merge.done', { name: shortName(merged) }) })) { UI.select(keepId, { center: true }); FT.scheduleRender(); }
}

/* ---------- Recognition log ---------- */
function openOcrLog() {
  const list = ST.ocrLog.list();
  const html = list.length
    ? `<p class="lead">${esc(t('log.lead'))}</p><div class="tool-list">${list.map(e => `<div class="tool-row log-row${e.undone ? ' undone' : ''}">${e.thumb ? `<img class="log-thumb" src="${e.thumb}" alt="">` : '<span class="log-thumb"></span>'}<div class="min0"><strong>${esc(fmtWhen(e.at))}</strong><p class="hint">${esc(t('log.counts', { added: M.people(e.added || 0), updated: M.people(e.updated || 0), links: e.links || 0 }))}${e.undone ? ` · ${esc(t('log.undoneMark'))}` : ''}</p>${e.names ? `<p class="hint">${esc(e.names)}</p>` : ''}</div>${e.undone || !e.inverse || S.readOnly ? '' : `<button type="button" class="btn sm" data-undo="${esc(e.id)}">${esc(t('log.undo'))}</button>`}</div>`).join('')}</div>`
    : `<p class="lead">${esc(t('log.empty'))}</p>`;
  const d = UI.openTool({ title: t('log.title'), html, wide: true, foot: list.length ? `<button type="button" class="btn ghost" data-log="clear">${esc(t('log.clear'))}</button>` : '' });
  d.onclick = async e => {
    const b = e.target.closest('[data-undo]');
    if (b) {
      const entry = list.find(x => x.id === b.dataset.undo); if (!entry) return;
      if (!(await UI.confirmAction({ title: t('log.undoTitle'), text: t('log.undoText', { when: fmtWhen(entry.at) }), okLabel: t('log.undo'), danger: false }))) return;
      const ok = await C.applyOps(entry.inverse, { label: t('log.undoneToast'), reason: 'undo-import' });
      if (ok) { ST.ocrLog.update(entry.id, { undone: true }); S.needFit = true; FT.scheduleRender(); openOcrLog(); }
      return;
    }
    if (e.target.closest('[data-log="clear"]')) { for (const x of list) ST.ocrLog.remove(x.id); UI.closeTool(); }
  };
}

FT.tools = { openSettings, openExport, pickImportFile, importFile, openBackups, openStats, openProblems, openMergeDialog, mergePersons, openOcrLog, formatHelpHtml };
})();
