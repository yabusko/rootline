/* Rootline — interface: details panel, person & relation dialogs, photos, lightbox, search, generic dialogs. */
(function () {
'use strict';
const { t } = window.i18n;
const T = window.i18n.translit;
const S = FT.S, M = FT.model, ST = FT.storage, C = FT.core, SET = FT.settings;
const { esc, FIELDS, fieldLabel, fullName, shortName, displayName, lifeSpan, initials, labelWithYear, relId, makeRel, fmtDate, parseDate } = M;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- Generic dialogs ---------- */
function confirmAction({ title, text, okLabel, danger = true }) {
  return new Promise(resolve => {
    const d = $('#confirmDialog'); let settled = false;
    $('#cfTitle').textContent = title; $('#cfText').textContent = text; $('#cfOk').textContent = okLabel || t('cf.ok');
    $('#cfOk').className = 'btn ' + (danger ? 'danger-solid' : 'primary');
    const finish = v => { if (settled) return; settled = true; d.removeEventListener('close', onClose); $('#cfOk').onclick = null; $('#cfCancel').onclick = null; if (d.open) d.close(); resolve(v); };
    const onClose = () => finish(false);
    $('#cfOk').onclick = () => finish(true); $('#cfCancel').onclick = () => finish(false);
    d.addEventListener('close', onClose);
    d.showModal(); $('#cfCancel').focus();
  });
}
/* A reusable dialog for tools (settings, statistics, import…). Returns the dialog element. */
let toolClose = null;
function openTool({ title, html, foot = '', wide = false, onClose = null }) {
  const d = $('#toolDialog');
  if (d.open) { const f = toolClose; toolClose = null; d.close(); if (f) f(); }
  d.onclick = null;
  d.classList.toggle('wide', wide);
  $('#tdTitle').textContent = title;
  $('#tdBody').innerHTML = html;
  $('#tdFoot').innerHTML = foot; $('#tdFoot').hidden = !foot;
  toolClose = onClose;
  d.showModal();
  d.scrollTop = 0;
  return d;
}
function closeTool() { const d = $('#toolDialog'); if (d.open) d.close(); }

/* ---------- Selection ---------- */
function select(id, opts = {}) {
  S.selectedId = id && S.persons.has(id) ? id : null;
  $$('#viewport .person').forEach(g => g.classList.toggle('selected', g.dataset.id === S.selectedId));
  renderDetails();
  if (opts.center && S.selectedId) FT.tree.centerOn(S.selectedId);
  if (S.selectedId && opts.scrollPanel && M.isNarrow()) $('#details').scrollIntoView({ behavior: M.reduceMotion() ? 'auto' : 'smooth', block: 'start' });
}

/* ---------- Details panel ---------- */
function avatarHtml(p, cls = 'avatar-lg') {
  const url = p.mainPhoto ? ST.photos.url(p.mainPhoto) : '';
  return url ? `<button type="button" class="${cls} has-photo" data-lightbox="${esc(p.mainPhoto)}" aria-label="${esc(t('photos.open'))}"><img src="${url}" alt=""></button>` : `<div class="${cls}" aria-hidden="true">${esc(initials(p))}</div>`;
}
function renderDetails() {
  const box = $('#details');
  const p = S.selectedId ? S.persons.get(S.selectedId) : null;
  if (!p) {
    box.innerHTML = `<h2>${esc(t('details.title'))}</h2>
      <p class="lead">${esc(t('details.lead'))}</p>
      <div class="legend">
        <div class="legend-row"><svg viewBox="0 0 64 30" aria-hidden="true"><rect x="1" y="8" width="22" height="14" rx="3"/><rect x="41" y="8" width="22" height="14" rx="3"/><path class="pair" d="M23 15h18"/></svg><span>${esc(t('legend.pair'))}</span></div>
        <div class="legend-row"><svg viewBox="0 0 64 30" aria-hidden="true"><path d="M32 1v10M12 11h40M12 11v8M52 11v8"/><rect x="2" y="19" width="20" height="10" rx="2"/><rect x="42" y="19" width="20" height="10" rx="2"/></svg><span>${esc(t('legend.children'))}</span></div>
        <div class="legend-row"><svg viewBox="0 0 64 30" aria-hidden="true"><rect x="1" y="8" width="22" height="14" rx="3"/><rect x="41" y="8" width="22" height="14" rx="3"/><path class="pair dashed" d="M23 15h18"/></svg><span>${esc(t('legend.divorced'))}</span></div>
      </div>
      <p class="hint">${esc(t('details.shortcuts'))}</p>`;
    return;
  }
  const idx = S.idx, ro = S.readOnly, ls = lifeSpan(p);
  const sub = [p.gender ? M.genderLabel(p.gender) : '', p.nickname ? `«${T(p.nickname)}»` : ''].filter(Boolean).join(' · ');
  const factKeys = ['maidenName', 'birthDate', 'deathDate', 'birthCity', 'occupation', 'source'];
  const facts = FIELDS.filter(f => factKeys.includes(f.key) && p[f.key])
    .map(f => `<dt>${esc(fieldLabel(f))}</dt><dd>${esc(f.type === 'date' ? fmtDate(p[f.key]) : ['birthCity', 'maidenName'].includes(f.key) ? T(p[f.key]) : p[f.key])}</dd>`).join('');
  const relBadge = r => {
    if (!r) return '';
    if (r.type === 'spouse' && r.status) return `<small class="rel-badge">${esc(t('rel.status.' + r.status))}</small>`;
    if (r.type === 'parent' && r.adopted) return `<small class="rel-badge">${esc(t('rel.adopted'))}</small>`;
    return '';
  };
  const chipList = (ids, relOf) => ids.length ? ids.map(id => {
    const r = S.persons.get(id); if (!r) return '';
    const l = lifeSpan(r), rel = relOf ? S.relations.get(relOf(id)) : null;
    return `<span class="chip${r.placeholder ? ' placeholder' : ''}"><button type="button" class="chip-name" data-go="${esc(id)}" title="${esc(t('details.open'))}">${esc(shortName(r))}${l ? ` <small>${esc(l)}</small>` : ''}${relBadge(rel)}</button>${!ro && rel ? `<button type="button" class="chip-x" data-rel="${esc(rel.id)}" aria-label="${esc(t('details.relOptions', { name: shortName(r) }))}" title="${esc(t('details.relOptionsShort'))}">⋯</button>` : ''}</span>`;
  }).join('') : `<span class="muted">${esc(t('details.none'))}</span>`;
  const parents = idx.parents(p.id), spouses = idx.spouses(p.id), kids = idx.children(p.id), sibs = M.siblingsOf(idx, p.id);
  const photos = ST.photos.forPerson(p);
  const photosHtml = `
    <div class="rel-group"><h3>${esc(t('photos.title'))} <span class="muted">${photos.length}/${M.MAX_PHOTOS}</span></h3>
      <div class="gallery">${photos.map((ph, i) => `<figure class="thumb${ph.id === p.mainPhoto ? ' main' : ''}" data-photo="${esc(ph.id)}">
        <button type="button" class="thumb-img" data-lightbox="${esc(ph.id)}" aria-label="${esc(t('photos.open'))}"><img src="${ph.dataUrl}" alt=""></button>
        ${ro ? '' : `<div class="thumb-tools">
          <button type="button" data-pm="main" title="${esc(t('photos.setMain'))}" aria-label="${esc(t('photos.setMain'))}" ${ph.id === p.mainPhoto ? 'disabled' : ''}>★</button>
          <button type="button" data-pm="left" title="${esc(t('photos.moveLeft'))}" aria-label="${esc(t('photos.moveLeft'))}" ${i === 0 ? 'disabled' : ''}>←</button>
          <button type="button" data-pm="right" title="${esc(t('photos.moveRight'))}" aria-label="${esc(t('photos.moveRight'))}" ${i === photos.length - 1 ? 'disabled' : ''}>→</button>
          <button type="button" data-pm="del" title="${esc(t('photos.delete'))}" aria-label="${esc(t('photos.delete'))}">×</button></div>`}
      </figure>`).join('')}
      ${!ro && photos.length < M.MAX_PHOTOS ? `<button type="button" class="thumb add" data-act="addPhoto" aria-label="${esc(t('photos.add'))}"><span>+</span><small>${esc(t('photos.add'))}</small></button>` : ''}
      </div>${photos.length || ro ? '' : `<p class="hint">${esc(t('photos.hint'))}</p>`}</div>`;
  box.innerHTML = `
    <div class="person-head">
      ${avatarHtml(p)}
      <div class="min0"><h2 class="pname">${esc(displayName(p) || (p.placeholder ? t('name.unknown') : t('name.unnamed')))}${p.lastName ? '<br>' + esc(T(p.lastName)) : ''}</h2>${ls || sub ? `<p class="pspan">${esc([ls, sub].filter(Boolean).join(' · '))}</p>` : ''}</div>
    </div>
    ${facts ? `<dl class="facts">${facts}</dl>` : ''}
    ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ''}
    ${!facts && !p.notes ? `<p class="muted">${esc(t('details.noData'))}</p>` : ''}
    <div class="row">
      ${ro ? '' : `<button type="button" class="btn" data-act="edit">${esc(t('details.edit'))}</button>`}
      <button type="button" class="btn ghost" data-act="center" title="${esc(t('details.center'))}">${esc(t('details.center'))}</button>
      <button type="button" class="btn ghost" data-act="cardPdf">${esc(t('details.cardPdf'))}</button>
      ${ro ? '' : `<button type="button" class="btn ghost danger" data-act="delete">${esc(t('details.delete'))}</button>`}
    </div>
    ${photosHtml}
    <div class="rel-group"><h3>${esc(t('details.parents'))}</h3><div class="chips">${chipList(parents, id => relId('parent', id, p.id))}</div></div>
    <div class="rel-group"><h3>${esc(t('details.spouses'))}</h3><div class="chips">${chipList(spouses, id => relId('spouse', p.id, id))}</div></div>
    <div class="rel-group"><h3>${esc(t('details.children'))}</h3><div class="chips">${chipList(kids, id => relId('parent', p.id, id))}</div></div>
    ${sibs.length ? `<div class="rel-group"><h3>${esc(t('details.siblings'))}</h3><div class="chips">${chipList(sibs, null)}</div></div>` : ''}
    ${ro ? '' : `<div class="rel-group"><h3>${esc(t('details.addRelative'))}</h3><div class="row">
      <button type="button" class="btn sm" data-addrel="parent" ${parents.length >= 2 ? `disabled title="${esc(t('details.twoParents'))}"` : ''}>${esc(t('details.aParent'))}</button>
      <button type="button" class="btn sm" data-addrel="spouse">${esc(t('details.aSpouse'))}</button>
      <button type="button" class="btn sm" data-addrel="child">${esc(t('details.aChild'))}</button>
      <button type="button" class="btn sm ghost" data-act="unknownParent" ${parents.length >= 2 ? 'disabled' : ''} title="${esc(t('details.unknownParentHint'))}">${esc(t('details.unknownParent'))}</button></div></div>`}
    <p class="hint">${esc(t('details.origin.' + (p.origin || 'manual')))}</p>`;
}

/* ---------- Person actions ---------- */
async function deletePerson(id) {
  const p = S.persons.get(id); if (!p) return;
  const rels = [...S.relations.values()].filter(r => r.from === id || r.to === id);
  const ok = await confirmAction({ title: t('del.title', { name: shortName(p) }), text: (rels.length ? t('del.rels', { n: rels.length }) : '') + t('del.undoHint'), okLabel: t('del.ok') });
  if (!ok) return;
  if (await C.applyOps([{ t: 'delPerson', id }, ...rels.map(r => ({ t: 'delRel', id: r.id }))], { label: t('toast.deleted', { name: shortName(p) }) })) { S.selectedId = null; FT.scheduleRender(); }
}
async function clearTree() {
  const n = S.persons.size; if (!n) return;
  const ok = await confirmAction({ title: t('clear.title'), text: t('clear.text', { people: M.people(n), links: M.links(S.relations.size) }), okLabel: t('clear.ok') });
  if (!ok) return;
  const ops = [...[...S.persons.keys()].map(id => ({ t: 'delPerson', id })), ...[...S.relations.keys()].map(id => ({ t: 'delRel', id }))];
  if (await C.applyOps(ops, { label: t('toast.cleared'), reason: 'clear' })) { S.selectedId = null; FT.scheduleRender(); }
}
async function addUnknownParent(childId) {
  const child = S.persons.get(childId); if (!child || S.idx.parents(childId).length >= 2) return;
  const rec = M.newPersonRecord({ placeholder: true });
  const ops = [{ t: 'putPerson', p: rec }, { t: 'putRel', r: makeRel('parent', rec.id, childId) }];
  const other = S.idx.parents(childId)[0];
  if (other && !M.checkSpouseLink(S.idx, rec.id, other)) ops.push({ t: 'putRel', r: makeRel('spouse', rec.id, other) });
  if (await C.applyOps(ops, { label: t('toast.unknownParentAdded', { name: shortName(child) }) })) FT.scheduleRender();
}

/* ---------- Relation dialog ---------- */
function openRelationDialog(rid) {
  const r = S.relations.get(rid); if (!r || S.readOnly) return;
  const a = S.persons.get(r.from), b = S.persons.get(r.to); if (!a || !b) return;
  const body = r.type === 'spouse'
    ? `<p class="muted">${esc(t('rel.coupleOf', { a: shortName(a), b: shortName(b) }))}</p>
       <fieldset class="extra"><legend>${esc(t('rel.statusLabel'))}</legend>
         ${['', 'married', 'divorced', 'partner'].map(s => `<label class="check"><input type="radio" name="relStatus" value="${s}" ${(r.status || '') === s ? 'checked' : ''}> ${esc(t(s ? 'rel.status.' + s : 'rel.status.none'))}</label>`).join('')}
       </fieldset>`
    : `<p class="muted">${esc(t('rel.parentOf', { parent: shortName(a), child: shortName(b) }))}</p>
       <label class="check extra"><input type="checkbox" id="relAdopted" ${r.adopted ? 'checked' : ''}> ${esc(t('rel.adoptedLabel'))}</label>`;
  const d = openTool({ title: t('rel.title'), html: body, foot: `<button type="button" class="btn ghost danger" data-td="remove">${esc(t('rel.remove'))}</button><span class="spacer"></span><button type="button" class="btn" data-td="close">${esc(t('pd.cancel'))}</button><button type="button" class="btn primary" data-td="save">${esc(t('pd.save'))}</button>` });
  d.onclick = async e => {
    const b = e.target.closest('[data-td]'); if (!b) return;
    if (b.dataset.td === 'close') return closeTool();
    if (b.dataset.td === 'remove') { closeTool(); await C.applyOps([{ t: 'delRel', id: rid }], { label: t('toast.linkRemoved') }); return; }
    const upd = { ...r };
    if (r.type === 'spouse') upd.status = d.querySelector('input[name="relStatus"]:checked')?.value || '';
    else upd.adopted = !!d.querySelector('#relAdopted')?.checked;
    closeTool();
    await C.applyOps([{ t: 'putRel', r: upd }], { label: t('toast.linkUpdated') });
  };
}

/* ---------- Photos ---------- */
async function addPhotos(personId, files) {
  const p = S.persons.get(personId); if (!p || S.readOnly) return;
  const room = M.MAX_PHOTOS - (p.photos || []).length;
  const list = [...files].filter(f => /^image\//.test(f.type)).slice(0, room);
  if (!list.length) { C.toast(t(room ? 'photos.errType' : 'photos.errMax', { n: M.MAX_PHOTOS }), { kind: 'error' }); return; }
  const added = [];
  for (const f of list) {
    try { const { dataUrl, w, h } = await ST.compressImage(f, 1600, 0.85); const id = M.uid('ph'); await ST.photos.put({ id, personId, dataUrl, w, h }); added.push(id); }
    catch (e) { C.toast(t('photos.errOpen'), { kind: 'error' }); }
  }
  if (!added.length) return;
  const photos = [...(p.photos || []), ...added];
  const upd = { ...p, photos, mainPhoto: p.mainPhoto || photos[0], updatedAt: M.nowIso() };
  await C.applyOps([{ t: 'putPerson', p: upd }], { label: t('photos.added', { n: added.length }) });
}
async function photoAction(personId, photoId, act) {
  const p = S.persons.get(personId); if (!p || S.readOnly) return;
  const photos = [...(p.photos || [])], i = photos.indexOf(photoId); if (i < 0) return;
  let mainPhoto = p.mainPhoto;
  if (act === 'del') {
    if (!(await confirmAction({ title: t('photos.deleteTitle'), text: t('photos.deleteText'), okLabel: t('photos.delete') }))) return;
    photos.splice(i, 1); if (mainPhoto === photoId) mainPhoto = photos[0] || '';
  } else if (act === 'main') mainPhoto = photoId;
  else if (act === 'left' && i > 0) [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
  else if (act === 'right' && i < photos.length - 1) [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]];
  const ok = await C.applyOps([{ t: 'putPerson', p: { ...p, photos, mainPhoto, updatedAt: M.nowIso() } }], { label: t(act === 'del' ? 'photos.deleted' : act === 'main' ? 'photos.mainSet' : 'toast.saved') });
  if (ok && act === 'del') await ST.photos.del(photoId);
}
/* Attach an already-compressed data URL (used when an uploaded "chart" turns out to be a portrait). */
async function attachDataUrl(personId, dataUrl, w, h) {
  const p = S.persons.get(personId); if (!p || S.readOnly) return false;
  if ((p.photos || []).length >= M.MAX_PHOTOS) { C.toast(t('photos.errMax', { n: M.MAX_PHOTOS }), { kind: 'error' }); return false; }
  const id = M.uid('ph'); await ST.photos.put({ id, personId, dataUrl, w, h });
  const photos = [...(p.photos || []), id];
  return C.applyOps([{ t: 'putPerson', p: { ...p, photos, mainPhoto: p.mainPhoto || id, updatedAt: M.nowIso() } }], { label: t('photos.added', { n: 1 }) });
}

/* Lightbox */
const LB = { ids: [], i: 0 };
function openLightbox(photoId, personId) {
  const p = personId ? S.persons.get(personId) : null;
  LB.ids = p && p.photos && p.photos.includes(photoId) ? p.photos.filter(id => ST.photos.get(id)) : [photoId];
  LB.i = Math.max(0, LB.ids.indexOf(photoId));
  const d = $('#lightbox'); showLightbox(); if (!d.open) d.showModal();
}
function showLightbox() {
  const d = $('#lightbox'), id = LB.ids[LB.i], ph = ST.photos.get(id);
  if (!ph) { if (d.open) d.close(); return; }
  $('#lbImg').src = ph.dataUrl;
  $('#lbCount').textContent = LB.ids.length > 1 ? `${LB.i + 1} / ${LB.ids.length}` : '';
  $('#lbPrev').hidden = $('#lbNext').hidden = LB.ids.length < 2;
}
function lightboxStep(d) { if (LB.ids.length < 2) return; LB.i = (LB.i + d + LB.ids.length) % LB.ids.length; showLightbox(); }

/* ---------- Person dialog ---------- */
function fieldHtml(prefix, f, value, attrs = '') {
  const id = prefix + f.key, v = esc(value || '');
  const label = `<label for="${id}">${esc(fieldLabel(f))}${f.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>`;
  let ctrl;
  if (f.type === 'textarea') ctrl = `<textarea id="${id}" rows="3" ${attrs}>${v}</textarea>`;
  else if (f.type === 'select') ctrl = `<select id="${id}" ${attrs}>${f.options.map(o => `<option value="${o}" ${o === (value || '') ? 'selected' : ''}>${esc(f.key === 'gender' ? M.genderLabel(o) : o)}</option>`).join('')}</select>`;
  else ctrl = `<input id="${id}" type="text" value="${v}" autocomplete="off" ${f.type === 'date' ? `placeholder="${esc(t('field.datePlaceholder'))}"` : ''} ${f.required ? 'aria-required="true"' : ''} ${attrs}>`;
  return `<div class="field span-${f.span || 6}">${label}${ctrl}<p class="field-error" hidden></p></div>`;
}
function setFieldError(inp, msg) {
  if (!inp) return;
  inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
  const m = inp.closest('.field')?.querySelector('.field-error');
  if (m) { m.textContent = msg || ''; m.hidden = !msg; }
}
function readFields(prefix, root, { requireName = true } = {}) {
  const values = {}; let first = null;
  for (const f of FIELDS) {
    const inp = root.querySelector('#' + prefix + f.key);
    let v = (inp ? inp.value : '').trim(), err = '';
    if (f.required && requireName && !v) err = t('field.required', { field: fieldLabel(f).toLowerCase() });
    if (f.type === 'date' && v) { const pd = parseDate(v); if (!pd.ok) err = pd.error; else v = pd.value; }
    values[f.key] = v; setFieldError(inp, err); if (err && !first) first = inp;
  }
  const oe = M.dateOrderError(values.birthDate, values.deathDate);
  if (!first && oe) { first = root.querySelector('#' + prefix + 'deathDate'); setFieldError(first, oe); }
  if (first) first.focus();
  return { values, ok: !first };
}

const PD = { ctx: null, seg: 'new' };
const relTitle = rel => t(rel === 'parent' ? 'rel.addParent' : rel === 'child' ? 'rel.addChild' : 'rel.addSpouse');
function candidatesFor(ctx) {
  const A = ctx.anchorId, idx = S.idx;
  return M.sortPeople([...S.persons.values()].filter(p => {
    if (p.id === A) return false;
    if (ctx.rel === 'parent') return !M.checkParentLink(idx, p.id, A);
    if (ctx.rel === 'child') return !M.checkParentLink(idx, A, p.id);
    return !M.checkSpouseLink(idx, A, p.id);
  }));
}
function extrasHtml(ctx) {
  const A = ctx.anchorId, idx = S.idx;
  const nm = id => esc(shortName(S.persons.get(id) || {}));
  if (ctx.rel === 'child') {
    const sp = idx.spouses(A); if (!sp.length) return '';
    return `<fieldset class="extra"><legend>${esc(t('pd.secondParent'))}</legend>${sp.map(s => `<label class="check"><input type="radio" name="pdSecond" value="${esc(s)}" ${sp.length === 1 ? 'checked' : ''}> ${nm(s)}</label>`).join('')}<label class="check"><input type="radio" name="pdSecond" value="" ${sp.length !== 1 ? 'checked' : ''}> ${esc(t('pd.leaveUnset'))}</label></fieldset>`;
  }
  if (ctx.rel === 'parent') {
    const other = idx.parents(A); if (other.length !== 1) return '';
    return `<label class="check extra"><input type="checkbox" id="pdPair" value="${esc(other[0])}" checked> ${esc(t('pd.pairWith', { name: shortName(S.persons.get(other[0]) || {}) }))}</label>`;
  }
  const kids = idx.children(A).filter(c => idx.parents(c).length < 2); if (!kids.length) return '';
  return `<fieldset class="extra"><legend>${esc(t('pd.alsoParentFor'))}</legend>${kids.map(k => `<label class="check"><input type="checkbox" name="pdKids" value="${esc(k)}"> ${nm(k)}</label>`).join('')}</fieldset>`;
}
function setSeg(seg) {
  PD.seg = seg;
  $$('#pdSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.seg === seg)));
  $('#pdFields').hidden = seg !== 'new';
  $('#pdExistingWrap').hidden = seg !== 'existing';
}
function fillExistingSelect(ctx, keepValue) {
  const cands = candidatesFor(ctx), sel = $('#pdExisting');
  sel.innerHTML = cands.length
    ? `<option value="">${esc(t('pd.choose'))}</option>` + cands.map(c => `<option value="${esc(c.id)}">${esc(labelWithYear(c))}</option>`).join('')
    : `<option value="">${esc(t('pd.noCandidates'))}</option>`;
  if (keepValue) sel.value = keepValue;
  $('#pdSeg [data-seg="existing"]').disabled = !cands.length;
}
function pdTitleText(ctx) { return ctx.mode === 'edit' ? t('pd.edit') : ctx.mode === 'relative' ? relTitle(ctx.rel) : t('pd.new'); }
function openPersonDialog(ctx) {
  if (S.readOnly || !S.loaded) return;
  const anchor = ctx.anchorId ? S.persons.get(ctx.anchorId) : null;
  if (ctx.mode === 'relative' && !anchor) return;
  if (ctx.mode === 'relative' && ctx.rel === 'parent' && S.idx.parents(anchor.id).length >= 2) { C.toast(t('pd.twoParentsErr'), { kind: 'error' }); return; }
  PD.ctx = ctx;
  const p = ctx.mode === 'edit' ? S.persons.get(ctx.id) : null;
  if (ctx.mode === 'edit' && !p) return;
  $('#pdTitle').textContent = pdTitleText(ctx);
  const cx = $('#pdContext'); cx.hidden = !anchor; cx.textContent = anchor ? t('pd.for', { name: fullName(anchor) }) : '';
  const values = {};
  for (const f of FIELDS) values[f.key] = p ? (f.type === 'date' ? fmtDate(p[f.key]) : p[f.key]) : '';
  if (ctx.mode === 'relative' && ctx.rel === 'child' && anchor && !values.lastName) {
    const male = [anchor, ...S.idx.spouses(anchor.id).map(id => S.persons.get(id))].find(x => x && x.gender === 'm');
    values.lastName = (male || anchor).lastName || '';
  }
  $('#pdFields').innerHTML = FIELDS.map(f => fieldHtml('pd_', f, values[f.key])).join('');
  $('#pdPlaceholderNote').hidden = !(p && p.placeholder);
  const isRel = ctx.mode === 'relative';
  $('#pdSeg').hidden = !isRel;
  if (isRel) fillExistingSelect(ctx);
  setSeg('new');
  $('#pdExtra').innerHTML = isRel ? extrasHtml(ctx) : '';
  $('#pdError').hidden = true;
  $('#pdSubmit').textContent = ctx.mode === 'edit' ? t('pd.save') : t('pd.add');
  $('#pdSubmit').disabled = false;
  $('#personDialog').showModal();
  $('#pd_firstName').focus();
}
function relabelPersonDialog() {
  const d = $('#personDialog'), ctx = PD.ctx;
  if (!d.open || !ctx) return;
  $('#pdTitle').textContent = pdTitleText(ctx);
  const anchor = ctx.anchorId ? S.persons.get(ctx.anchorId) : null;
  $('#pdContext').textContent = anchor ? t('pd.for', { name: fullName(anchor) }) : '';
  for (const f of FIELDS) {
    const lab = $(`#pdFields label[for="pd_${f.key}"]`);
    if (lab) lab.innerHTML = esc(fieldLabel(f)) + (f.required ? ' <span class="req" aria-hidden="true">*</span>' : '');
    const inp = $('#pd_' + f.key);
    if (inp && f.type === 'date') inp.placeholder = t('field.datePlaceholder');
    if (inp && f.type === 'select') $$('option', inp).forEach(o => { o.textContent = f.key === 'gender' ? M.genderLabel(o.value) : o.value; });
  }
  if (ctx.mode === 'relative') fillExistingSelect(ctx, $('#pdExisting').value);
  $('#pdSubmit').textContent = ctx.mode === 'edit' ? t('pd.save') : t('pd.add');
}
async function submitPersonDialog(e) {
  e.preventDefault();
  const ctx = PD.ctx, form = $('#personForm'), err = $('#pdError');
  err.hidden = true;
  const ops = []; let targetId = null, newRec = null, label = '';
  if (ctx.mode === 'relative' && PD.seg === 'existing') {
    targetId = $('#pdExisting').value;
    if (!targetId) { err.textContent = t('pd.chooseErr'); err.hidden = false; return; }
  } else {
    const editing = ctx.mode === 'edit' ? S.persons.get(ctx.id) : null;
    const { values, ok } = readFields('pd_', form, { requireName: !(editing && editing.placeholder) }); if (!ok) return;
    if (ctx.mode === 'edit') {
      if (!editing) return;
      const placeholder = editing.placeholder && !values.firstName && !values.lastName;
      ops.push({ t: 'putPerson', p: { ...editing, ...values, placeholder, updatedAt: M.nowIso() } });
      label = t('toast.changesSaved');
    } else {
      newRec = M.newPersonRecord(values); ops.push({ t: 'putPerson', p: newRec }); targetId = newRec.id;
      label = t('toast.added', { name: shortName(newRec) });
    }
  }
  if (ctx.mode === 'relative') {
    const A = ctx.anchorId, idx = S.idx; let problem = '';
    if (ctx.rel === 'parent') { if (!newRec) problem = M.checkParentLink(idx, targetId, A); ops.push({ t: 'putRel', r: makeRel('parent', targetId, A) }); }
    else if (ctx.rel === 'child') { if (!newRec) problem = M.checkParentLink(idx, A, targetId); ops.push({ t: 'putRel', r: makeRel('parent', A, targetId) }); }
    else { if (!newRec) problem = M.checkSpouseLink(idx, A, targetId); ops.push({ t: 'putRel', r: makeRel('spouse', A, targetId, { status: 'married' }) }); }
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    if (ctx.rel === 'child') {
      const second = form.querySelector('input[name="pdSecond"]:checked')?.value;
      if (second && second !== targetId && (newRec || !M.checkParentLink(idx, second, targetId)) && !idx.parents(targetId).includes(second)) ops.push({ t: 'putRel', r: makeRel('parent', second, targetId) });
    } else if (ctx.rel === 'parent') {
      const pair = $('#pdPair');
      if (pair && pair.checked && pair.value !== targetId && (newRec || !M.checkSpouseLink(idx, targetId, pair.value))) ops.push({ t: 'putRel', r: makeRel('spouse', targetId, pair.value, { status: 'married' }) });
    } else {
      for (const k of $$('input[name="pdKids"]:checked', form)) if (newRec || !M.checkParentLink(idx, targetId, k.value)) ops.push({ t: 'putRel', r: makeRel('parent', targetId, k.value) });
    }
    if (!newRec) label = t('toast.linkAdded');
  }
  $('#pdSubmit').disabled = true;
  const ok = await C.applyOps(ops, { label });
  $('#pdSubmit').disabled = false;
  if (!ok) return;
  $('#personDialog').close();
  if (newRec) { S.pendingSelect = newRec.id; if (S.persons.size <= 1) S.needFit = true; }
  FT.scheduleRender();
}

/* ---------- Search ---------- */
let sItems = [], sActive = 0;
function runSearch() {
  const q = M.norm($('#search').value), box = $('#searchResults');
  if (!q) { box.hidden = true; return; }
  sItems = M.sortPeople([...S.persons.values()].filter(p => M.searchHay(p).includes(q))).slice(0, 10);
  sActive = 0;
  box.innerHTML = sItems.length
    ? sItems.map((p, i) => { const extra = [lifeSpan(p), T(p.birthCity)].filter(Boolean).join(', '); return `<button type="button" data-id="${esc(p.id)}" class="${i === sActive ? 'active' : ''}">${esc(fullName(p))}${extra ? `<small>${esc(extra)}</small>` : ''}</button>`; }).join('')
    : `<p class="search-empty">${esc(t('search.none'))}</p>`;
  box.hidden = false;
}
function pickSearch(id) { $('#search').value = ''; $('#searchResults').hidden = true; select(id, { center: true, scrollPanel: true }); flashNode(id); }
function flashNode(id) {
  const el = $(`#viewport .person[data-id="${CSS.escape(id)}"]`); if (!el) return;
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
}
function bindSearch() {
  const sIn = $('#search');
  sIn.addEventListener('input', runSearch);
  sIn.addEventListener('keydown', e => {
    const box = $('#searchResults');
    if (e.key === 'Escape') { sIn.value = ''; box.hidden = true; sIn.blur(); return; }
    if (box.hidden || !sItems.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); sActive = (sActive + (e.key === 'ArrowDown' ? 1 : -1) + sItems.length) % sItems.length;
      $$('button', box).forEach((b, i) => b.classList.toggle('active', i === sActive));
    } else if (e.key === 'Enter') { e.preventDefault(); pickSearch(sItems[sActive].id); }
  });
  sIn.addEventListener('blur', () => setTimeout(() => { $('#searchResults').hidden = true; }, 180));
  $('#searchResults').addEventListener('mousedown', e => e.preventDefault());
  $('#searchResults').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) pickSearch(b.dataset.id); });
}

/* ---------- Events for the panel, dialogs and lightbox ---------- */
function bind() {
  $('#details').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const id = S.selectedId;
    if (b.dataset.lightbox) openLightbox(b.dataset.lightbox, id);
    else if (b.dataset.go) { select(b.dataset.go, { center: true }); flashNode(b.dataset.go); }
    else if (b.dataset.rel) openRelationDialog(b.dataset.rel);
    else if (b.dataset.pm) photoAction(id, b.closest('[data-photo]').dataset.photo, b.dataset.pm);
    else if (b.dataset.addrel) openPersonDialog({ mode: 'relative', anchorId: id, rel: b.dataset.addrel });
    else if (b.dataset.act === 'edit') openPersonDialog({ mode: 'edit', id });
    else if (b.dataset.act === 'delete') deletePerson(id);
    else if (b.dataset.act === 'center') { FT.tree.centerOn(id, Math.max(1, 1)); flashNode(id); }
    else if (b.dataset.act === 'cardPdf') FT.exp.personCardPdf(id);
    else if (b.dataset.act === 'addPhoto') { const inp = $('#photoInput'); inp.value = ''; inp.click(); }
    else if (b.dataset.act === 'unknownParent') addUnknownParent(id);
  });
  $('#photoInput').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (S.selectedId && files.length) addPhotos(S.selectedId, files); });
  $('#personForm').addEventListener('submit', submitPersonDialog);
  $$('#personDialog [data-close]').forEach(b => { b.onclick = () => $('#personDialog').close(); });
  $('#pdSeg').addEventListener('click', e => { const b = e.target.closest('[data-seg]'); if (b && !b.disabled) setSeg(b.dataset.seg); });
  const td = $('#toolDialog');
  // The close event is delivered asynchronously; if the dialog was reopened in the meantime, leave the new content alone.
  td.addEventListener('close', () => { if (td.open) return; td.onclick = null; if (toolClose) { const f = toolClose; toolClose = null; f(); } });
  $('#tdClose').addEventListener('click', closeTool);
  $('#lbClose').addEventListener('click', () => $('#lightbox').close());
  $('#lbPrev').addEventListener('click', () => lightboxStep(-1));
  $('#lbNext').addEventListener('click', () => lightboxStep(1));
  $('#lightbox').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') lightboxStep(-1); if (e.key === 'ArrowRight') lightboxStep(1); });
  $('#lightbox').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  bindSearch();
}

FT.ui = { confirmAction, openTool, closeTool, select, renderDetails, deletePerson, clearTree, addUnknownParent, openRelationDialog, addPhotos, photoAction, attachDataUrl, openLightbox, fieldHtml, setFieldError, readFields, openPersonDialog, relabelPersonDialog, runSearch, flashNode, bind };
})();
