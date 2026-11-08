/* Rootline — export & import formats: JSON, GEDCOM 5.5.1, PNG, PDF (tree and person card). */
(function () {
'use strict';
const { t } = window.i18n;
const T = window.i18n.translit;
const S = FT.S, M = FT.model, ST = FT.storage, SET = FT.settings, C = FT.core;
const { yearOf, fmtDate, fullName, shortName, lifeSpan } = M;

const stamp = () => new Date().toISOString().slice(0, 10);
const baseName = () => t('dl.filename') + '-' + stamp();

/* ---------- JSON ---------- */
function buildJson({ withPhotos = true } = {}) {
  const out = {
    app: 'rootline', schema: M.SCHEMA, exportedAt: M.nowIso(), settings: SET.exportable(),
    persons: [...S.persons.values()], relations: [...S.relations.values()],
  };
  if (withPhotos) {
    const ids = new Set(); for (const p of S.persons.values()) for (const id of p.photos || []) ids.add(id);
    out.photos = [...ids].map(id => ST.photos.get(id)).filter(Boolean).map(ph => ({ id: ph.id, personId: ph.personId, dataUrl: ph.dataUrl, w: ph.w, h: ph.h }));
  }
  return out;
}
async function exportJson(opts) {
  const data = JSON.stringify(buildJson(opts), null, 2);
  const ok = await ST.download(`${baseName()}${opts && opts.withPhotos === false ? '-nophotos' : ''}.json`, data, 'application/json');
  if (ok) C.toast(t('export.done'));
}

/* ---------- GEDCOM 5.5.1 ---------- */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function gedDate(v) { if (!v) return ''; const [y, m, d] = v.split('-'); return [d ? String(+d) : '', m ? MONTHS[+m - 1] : '', y].filter(Boolean).join(' '); }
function gedLines(level, tag, value) {
  // Split long values into CONC/CONT continuation lines.
  const out = [];
  const parts = String(value ?? '').split(/\r?\n/);
  parts.forEach((part, i) => {
    let first = true, rest = part;
    do {
      const chunk = rest.slice(0, 200); rest = rest.slice(200);
      out.push(`${first ? level : level + 1} ${first ? (i === 0 ? tag : 'CONT') : 'CONC'} ${chunk}`.trimEnd());
      first = false;
    } while (rest.length);
  });
  return out;
}
function buildGedcom() {
  const P = S.persons, R = S.relations, idx = S.idx;
  const ids = [...P.keys()], iref = new Map(ids.map((id, i) => [id, `@I${i + 1}@`]));
  const lines = ['0 HEAD', '1 SOUR Rootline', '2 NAME Rootline Family Tree', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', `1 DATE ${gedDate(stamp())}`];
  // Families: one per parent set (couple or single parent with children) plus childless couples.
  const fams = new Map();                                  // key → { parents:[], kids:[] }
  const famKey = ps => ps.slice().sort().join('|');
  for (const id of ids) { const ps = idx.parents(id); if (!ps.length) continue; const k = famKey(ps); if (!fams.has(k)) fams.set(k, { parents: ps.slice().sort(), kids: [] }); fams.get(k).kids.push(id); }
  for (const r of R.values()) if (r.type === 'spouse' && P.has(r.from) && P.has(r.to)) { const k = famKey([r.from, r.to]); if (!fams.has(k)) fams.set(k, { parents: [r.from, r.to].sort(), kids: [] }); }
  const famList = [...fams.values()]; const fref = new Map(famList.map((f, i) => [f, `@F${i + 1}@`]));
  const famsOf = id => famList.filter(f => f.parents.includes(id));
  const famcOf = id => famList.find(f => f.kids.includes(id));
  for (const id of ids) {
    const p = P.get(id);
    lines.push(`0 ${iref.get(id)} INDI`);
    const given = [p.firstName, p.patronymic].filter(Boolean).join(' ');
    lines.push(`1 NAME ${given} /${p.lastName || ''}/`.replace(/\s+\//, ' /'));
    if (given) lines.push(`2 GIVN ${given}`);
    if (p.lastName) lines.push(`2 SURN ${p.lastName}`);
    if (p.nickname) lines.push(`2 NICK ${p.nickname}`);
    if (p.maidenName) { lines.push(`1 NAME ${given} /${p.maidenName}/`, '2 TYPE maiden', `2 SURN ${p.maidenName}`); }
    lines.push(`1 SEX ${p.gender === 'm' ? 'M' : p.gender === 'f' ? 'F' : 'U'}`);
    if (p.birthDate || p.birthCity) { lines.push('1 BIRT'); if (p.birthDate) lines.push(`2 DATE ${gedDate(p.birthDate)}`); if (p.birthCity) lines.push(`2 PLAC ${p.birthCity}`); }
    if (p.deathDate) { lines.push('1 DEAT', `2 DATE ${gedDate(p.deathDate)}`); }
    if (p.occupation) lines.push(`1 OCCU ${p.occupation}`);
    if (p.notes) lines.push(...gedLines(1, 'NOTE', p.notes));
    if (p.source) lines.push(...gedLines(1, 'NOTE', `${t('field.source')}: ${p.source}`));
    if (p.placeholder) lines.push('1 NOTE Rootline: unknown parent placeholder');
    const fc = famcOf(id);
    if (fc) { lines.push(`1 FAMC ${fref.get(fc)}`); if (fc.parents.some(pa => { const r = R.get(M.relId('parent', pa, id)); return r && r.adopted; })) lines.push('2 PEDI adopted'); }
    for (const f of famsOf(id)) lines.push(`1 FAMS ${fref.get(f)}`);
    lines.push(`1 CHAN`, `2 DATE ${gedDate((p.updatedAt || '').slice(0, 10))}`.trimEnd());
  }
  for (const f of famList) {
    lines.push(`0 ${fref.get(f)} FAM`);
    const [a, b] = f.parents;
    const pa = P.get(a), pb = b ? P.get(b) : null;
    let husb = a, wife = b;
    if (pa.gender === 'f' || (pb && pb.gender === 'm')) { husb = b; wife = a; }
    if (husb) lines.push(`1 HUSB ${iref.get(husb)}`);
    if (wife) lines.push(`1 WIFE ${iref.get(wife)}`);
    for (const k of f.kids) lines.push(`1 CHIL ${iref.get(k)}`);
    if (b) { const sp = R.get(M.relId('spouse', a, b)); if (sp && sp.status !== 'partner') lines.push('1 MARR'); if (sp && sp.status === 'divorced') lines.push('1 DIV', '2 TYPE Y'); }
  }
  lines.push('0 TRLR');
  return lines.join('\r\n') + '\r\n';
}
async function exportGedcom() {
  const ok = await ST.download(`${baseName()}.ged`, buildGedcom(), 'text/plain');
  if (ok) C.toast(t('export.done'));
}
/* Parse GEDCOM text → { persons: Map, relations: Map, warnings } in Rootline's format. */
function parseGedcom(text) {
  const recs = []; let cur = null, stack = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (const raw of lines) {
    const m = raw.match(/^\s*(\d+)\s+(@[^@]+@\s+)?(\w+)(?:\s(.*))?$/); if (!m) continue;
    const level = +m[1], xref = (m[2] || '').trim(), tag = m[3], value = m[4] || '';
    const node = { tag, value, xref, children: [] };
    if (level === 0) { cur = node; recs.push(node); stack = [node]; continue; }
    if (!cur) continue;
    stack.length = level; const parent = stack[level - 1] || cur;
    if (tag === 'CONT' || tag === 'CONC') { parent.value += (tag === 'CONT' ? '\n' : '') + value; continue; }
    parent.children.push(node); stack[level] = node;
  }
  const child = (n, tag) => n.children.find(c => c.tag === tag);
  const childVal = (n, tag) => { const c = child(n, tag); return c ? c.value.trim() : ''; };
  const parseGedDate = v => {
    v = v.trim().toUpperCase(); if (!v) return { date: '', note: '' };
    const mon = s => { const i = MONTHS.indexOf(s); return i < 0 ? null : i + 1; };
    let m;
    if ((m = v.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{3,4})$/)) && mon(m[2])) return { date: `${m[3].padStart(4, '0')}-${String(mon(m[2])).padStart(2, '0')}-${m[1].padStart(2, '0')}`, note: '' };
    if ((m = v.match(/^([A-Z]{3})\s+(\d{3,4})$/)) && mon(m[1])) return { date: `${m[2].padStart(4, '0')}-${String(mon(m[1])).padStart(2, '0')}`, note: '' };
    if ((m = v.match(/^(\d{4})$/))) return { date: m[1], note: '' };
    if ((m = v.match(/^(ABT|EST|CAL|BEF|AFT)\s+(.*)$/))) { const inner = parseGedDate(m[2]); return { date: '', note: `${t('ged.approx.' + m[1].toLowerCase())} ${fmtDate(inner.date) || m[2]}` }; }
    return { date: '', note: v };
  };
  const PATR = /(ович|евич|ьич|ич|овна|евна|ична|инична)$/i;
  const persons = new Map(), relations = new Map(), warnings = { badPersons: 0, badRelations: 0 };
  const xmap = new Map();
  for (const r of recs) {
    if (r.tag !== 'INDI') continue;
    const id = M.uid('p'); xmap.set(r.xref, id);
    const names = r.children.filter(c => c.tag === 'NAME');
    const main = names.find(n => !childVal(n, 'TYPE')) || names[0];
    let firstName = '', patronymic = '', lastName = '', maidenName = '', nickname = '';
    if (main) {
      const mm = main.value.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
      let given = mm ? mm[1].trim() : main.value.trim(); lastName = mm ? mm[2].trim() : '';
      given = childVal(main, 'GIVN') || given; lastName = childVal(main, 'SURN') || lastName;
      nickname = childVal(main, 'NICK');
      const parts = given.split(/\s+/).filter(Boolean);
      if (parts.length >= 2 && PATR.test(parts[parts.length - 1])) { patronymic = parts.pop(); }
      firstName = parts.join(' ');
    }
    const maiden = names.find(n => /maiden|birth/i.test(childVal(n, 'TYPE')));
    if (maiden) { const mm = maiden.value.match(/\/([^/]*)\//); maidenName = childVal(maiden, 'SURN') || (mm ? mm[1].trim() : ''); }
    const sex = childVal(r, 'SEX').toUpperCase();
    const notes = [];
    const birt = child(r, 'BIRT'), deat = child(r, 'DEAT');
    const bd = birt ? parseGedDate(childVal(birt, 'DATE')) : { date: '', note: '' };
    const dd = deat ? parseGedDate(childVal(deat, 'DATE')) : { date: '', note: '' };
    if (bd.note) notes.push(`${t('field.birthDate')}: ${bd.note}`);
    if (dd.note) notes.push(`${t('field.deathDate')}: ${dd.note}`);
    if (deat && !dd.date && !dd.note) notes.push(t('ged.deceasedNoDate'));
    let source = '';
    for (const n of r.children.filter(c => c.tag === 'NOTE')) {
      const v = n.value.trim(); if (!v) continue;
      const sm = v.match(/^(?:Source|Источник):\s*(.*)$/is);
      if (sm && !source) source = sm[1].trim(); else if (!/^Rootline:/.test(v)) notes.push(v);
    }
    const placeholder = r.children.some(c => c.tag === 'NOTE' && /unknown parent placeholder/.test(c.value));
    const rec = M.newPersonRecord({ firstName, patronymic, lastName, maidenName, nickname, gender: sex === 'M' ? 'm' : sex === 'F' ? 'f' : '', birthDate: bd.date, deathDate: dd.date, birthCity: birt ? childVal(birt, 'PLAC') : '', occupation: childVal(r, 'OCCU'), source, notes: notes.join('\n'), placeholder }, 'gedcom');
    rec.id = id; rec.extra.gedcomXref = r.xref;
    rec.adoptedIn = r.children.filter(c => c.tag === 'FAMC' && /adopt/i.test(childVal(c, 'PEDI'))).map(c => c.value.trim());
    persons.set(id, rec);
  }
  for (const r of recs) {
    if (r.tag !== 'FAM') continue;
    const husb = xmap.get(childVal(r, 'HUSB')), wife = xmap.get(childVal(r, 'WIFE'));
    const kids = r.children.filter(c => c.tag === 'CHIL').map(c => xmap.get(c.value.trim())).filter(Boolean);
    const divorced = r.children.some(c => c.tag === 'DIV'), married = r.children.some(c => c.tag === 'MARR');
    if (husb && wife && husb !== wife) { const rel = M.makeRel('spouse', husb, wife, { status: divorced ? 'divorced' : married ? 'married' : (kids.length ? '' : 'partner') }); relations.set(rel.id, rel); }
    for (const k of kids) for (const pa of [husb, wife]) {
      if (!pa || pa === k) continue;
      const adopted = (persons.get(k).adoptedIn || []).includes(r.xref);
      const rel = M.makeRel('parent', pa, k, { adopted }); relations.set(rel.id, rel);
    }
  }
  for (const p of persons.values()) delete p.adoptedIn;
  if (!recs.some(r => r.tag === 'INDI')) return { ok: false, error: t('import.errGedcom') };
  return { ok: true, persons, relations, photos: [], settings: null, warnings };
}

/* ---------- Raster export ---------- */
let jspdfLoading = null;
function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jspdfLoading) jspdfLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => (window.jspdf && window.jspdf.jsPDF ? res(window.jspdf.jsPDF) : rej(new Error('jspdf'))); s.onerror = () => rej(new Error('jspdf'));
    document.head.append(s);
  });
  return jspdfLoading;
}
function treeTitle() { return t('export.treeTitle'); }
function treeSubtitle() { return t('export.treeSubtitle', { people: M.people(S.persons.size), date: new Date().toLocaleDateString(window.i18n.lang === 'ru' ? 'ru-RU' : 'en-GB') }); }
async function exportPng() {
  if (!S.persons.size) return;
  const layout = FT.tree.layout || FT.tree.computeLayout();
  const px = (layout.width + 80) * (layout.height + 180);
  const scale = px > 30e6 ? 1 : px > 12e6 ? 1.5 : 2;        // keep very large trees under browser canvas limits
  const c = await FT.tree.renderToCanvas({ scale, title: treeTitle(), subtitle: treeSubtitle() });
  const blob = await ST.canvasToBlob(c, 'image/png');
  if (await ST.download(`${baseName()}.png`, blob, 'image/png')) C.toast(t('export.done'));
}
async function exportPdf() {
  if (!S.persons.size) return;
  let jsPDF; try { jsPDF = await loadJsPdf(); } catch (e) { C.toast(t('export.errPdfLib'), { kind: 'error' }); return; }
  const c = await FT.tree.renderToCanvas({ scale: 2, title: treeTitle(), subtitle: treeSubtitle() });
  // One large page sized to the tree (jsPDF allows up to 14400 pt per side); scale down if needed.
  const maxPt = 14000, ptW = c.width / 2, ptH = c.height / 2, k = Math.min(1, maxPt / Math.max(ptW, ptH));
  const w = ptW * k, h = ptH * k;
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'pt', format: [w, h] });
  pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
  const blob = pdf.output('blob');
  if (await ST.download(`${baseName()}.pdf`, blob, 'application/pdf')) C.toast(t('export.done'));
}

/* ---------- Person card PDF (drawn on canvas so Cyrillic text needs no font embedding) ---------- */
function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean); let line = '';
    if (!words.length) { out.push(''); continue; }
    for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test; }
    out.push(line);
  }
  return out;
}
async function personCardPdf(id) {
  const p = S.persons.get(id); if (!p) return;
  let jsPDF; try { jsPDF = await loadJsPdf(); } catch (e) { C.toast(t('export.errPdfLib'), { kind: 'error' }); return; }
  const v = SET.cssVar, scale = 2, Wc = 1190, pad = 72, colW = Wc - pad * 2;
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const font = (w, px, fam) => FT.tree.fontFor(w, px, fam);
  // Measure pass: build a list of draw commands with y positions.
  const cmds = []; let y = pad;
  const text = (str, f, color, x, lineH, maxW) => { ctx.font = f; const lines = wrapText(ctx, str, maxW || colW - (x - pad)); for (const l of lines) { cmds.push({ k: 'text', s: l, f, color, x, y: y + lineH * 0.8 }); y += lineH; } };
  const idx = S.idx;
  const photos = ST.photos.forPerson(p);
  const imgs = []; for (const ph of photos) { try { imgs.push(await ST.loadImage(ph.dataUrl)); } catch (e) { /* skip */ } }
  // Header: portrait left, name right
  const portrait = imgs.length ? imgs[Math.max(0, photos.findIndex(ph => ph.id === p.mainPhoto))] : null;
  const headX = portrait ? pad + 220 : pad;
  const yStart = y;
  if (portrait) cmds.push({ k: 'img', img: portrait, x: pad, y, w: 190, h: 190, round: 12 });
  text(fullName(p), font(600, 40, '--font-name'), v('--ink'), headX, 48);
  const sub = [lifeSpan(p), p.gender ? M.genderLabel(p.gender) : '', p.nickname ? `«${T(p.nickname)}»` : ''].filter(Boolean).join(' · ');
  if (sub) text(sub, font(400, 20, '--font-ui'), v('--ink-2'), headX, 28);
  y = Math.max(y, portrait ? yStart + 190 : y) + 28;
  cmds.push({ k: 'rule', y }); y += 24;
  const fact = (label, val) => { if (!val) return; cmds.push({ k: 'text', s: label, f: font(400, 15, '--font-ui'), color: v('--ink-2'), x: pad, y: y + 14 }); ctx.font = font(400, 19, '--font-ui'); const lines = wrapText(ctx, val, colW - 260); lines.forEach((l, i) => cmds.push({ k: 'text', s: l, f: font(400, 19, '--font-ui'), color: v('--ink'), x: pad + 260, y: y + 15 + i * 26 })); y += Math.max(26, lines.length * 26) + 8; };
  fact(t('field.maidenName'), T(p.maidenName)); fact(t('field.birthDate'), fmtDate(p.birthDate)); fact(t('field.deathDate'), fmtDate(p.deathDate));
  fact(t('field.birthCity'), T(p.birthCity)); fact(t('field.occupation'), p.occupation); fact(t('field.source'), p.source);
  const rel = (label, ids) => { if (!ids.length) return; fact(label, ids.map(i => { const r = S.persons.get(i); return r ? M.labelWithYear(r) : ''; }).filter(Boolean).join('\n')); };
  rel(t('details.parents'), idx.parents(p.id)); rel(t('details.spouses'), idx.spouses(p.id)); rel(t('details.children'), idx.children(p.id)); rel(t('details.siblings'), M.siblingsOf(idx, p.id));
  if (p.notes) { y += 10; cmds.push({ k: 'text', s: t('field.notes'), f: font(600, 20, '--font-name'), color: v('--ink'), x: pad, y: y + 18 }); y += 34; text(p.notes, font(400, 18, '--font-ui'), v('--ink'), pad, 26); }
  const others = imgs.filter(im => im !== portrait);
  if (others.length) {
    y += 20; cmds.push({ k: 'text', s: t('photos.title'), f: font(600, 20, '--font-name'), color: v('--ink'), x: pad, y: y + 18 }); y += 34;
    const tw = (colW - 16 * 3) / 4; let x = pad;
    others.forEach((im, i) => { if (i && i % 4 === 0) { y += tw + 16; x = pad; } cmds.push({ k: 'img', img: im, x, y, w: tw, h: tw, round: 8 }); x += tw + 16; });
    y += tw + 16;
  }
  y += 30;
  cmds.push({ k: 'text', s: t('export.cardFooter', { date: new Date().toLocaleDateString(window.i18n.lang === 'ru' ? 'ru-RU' : 'en-GB') }), f: font(400, 13, '--font-ui'), color: v('--ink-3'), x: pad, y: y + 10 }); y += 30;
  const Hc = y + pad / 2;
  c.width = Wc * scale; c.height = Hc * scale; ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, Wc, Hc);
  for (const cmd of cmds) {
    if (cmd.k === 'text') { ctx.font = cmd.f; ctx.fillStyle = cmd.color; ctx.fillText(cmd.s, cmd.x, cmd.y); }
    else if (cmd.k === 'rule') { ctx.strokeStyle = v('--line-strong'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, cmd.y); ctx.lineTo(Wc - pad, cmd.y); ctx.stroke(); }
    else if (cmd.k === 'img') { ctx.save(); FT.tree.roundRect(ctx, cmd.x, cmd.y, cmd.w, cmd.h, cmd.round); ctx.clip(); const k = Math.max(cmd.w / cmd.img.width, cmd.h / cmd.img.height); ctx.drawImage(cmd.img, cmd.x + cmd.w / 2 - cmd.img.width * k / 2, cmd.y + cmd.h / 2 - cmd.img.height * k / 2, cmd.img.width * k, cmd.img.height * k); ctx.restore(); }
  }
  // A4 portrait pages, slicing the canvas when the card is taller than one page.
  const pageW = 595.28, pageH = 841.89, imgW = pageW, pxPerPt = (Wc * scale) / pageW, sliceH = Math.floor(pageH * pxPerPt);
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  for (let top = 0, page = 0; top < c.height; top += sliceH, page++) {
    const h = Math.min(sliceH, c.height - top);
    const part = document.createElement('canvas'); part.width = c.width; part.height = h;
    part.getContext('2d').drawImage(c, 0, top, c.width, h, 0, 0, c.width, h);
    if (page) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, h / pxPerPt);
  }
  const name = (M.rawShortName(p) ? T(M.rawShortName(p), true) : 'person').replace(/[^\w\-]+/g, '_');
  if (await ST.download(`${name}-${stamp()}.pdf`, pdf.output('blob'), 'application/pdf')) C.toast(t('export.done'));
}

FT.exp = { buildJson, exportJson, buildGedcom, exportGedcom, parseGedcom, exportPng, exportPdf, personCardPdf, loadJsPdf };
})();
