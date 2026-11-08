/* Rootline — data model, helpers, validation and analysis.
   Person (schema 2):
     { id, schema, firstName, patronymic, lastName, maidenName, nickname, gender: ''|'m'|'f',
       birthDate, deathDate, birthCity, occupation, source, notes,
       photos: [photoId…] (max 5), mainPhoto: photoId|'', placeholder: bool,
       extra: {}, origin: 'manual'|'photo'|'demo'|'import'|'gedcom', createdAt, updatedAt }
   Relation:
     { id, type: 'parent'|'spouse', from, to, status: ''|'married'|'divorced'|'partner' (spouse only),
       adopted: bool (parent only), createdAt }      parent: from = parent, to = child
   Dates are stored as 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
(function () {
'use strict';
const i18n = window.i18n;
const { t, count, translit: T } = i18n;

const SCHEMA = 2;
const MAX_PHOTOS = 5;

/* Person fields shown in forms. Labels come from i18n ("field.<key>"). */
const FIELDS = [
  { key: 'firstName', type: 'text', required: true, span: 2 },
  { key: 'patronymic', type: 'text', span: 2 },
  { key: 'lastName', type: 'text', span: 2 },
  { key: 'maidenName', type: 'text', span: 3 },
  { key: 'nickname', type: 'text', span: 3 },
  { key: 'gender', type: 'select', span: 2, options: ['', 'm', 'f'] },
  { key: 'birthDate', type: 'date', span: 2 },
  { key: 'deathDate', type: 'date', span: 2 },
  { key: 'birthCity', type: 'text', span: 3 },
  { key: 'occupation', type: 'text', span: 3 },
  { key: 'source', type: 'text', span: 6 },
  { key: 'notes', type: 'textarea', span: 6 },
];
const NAME_KEYS = ['firstName', 'patronymic', 'lastName', 'maidenName', 'nickname'];
const fieldLabel = f => t('field.' + (f.key || f));
const genderLabel = g => t(g === 'm' ? 'gender.m' : g === 'f' ? 'gender.f' : 'gender.unknown');

/* ---------- Generic helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const people = n => count(n, 'count.people');
const links = n => count(n, 'count.links');
function uid(prefix) { const a = new Uint8Array(8); crypto.getRandomValues(a); return prefix + '_' + Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }
const norm = s => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const nowIso = () => new Date().toISOString();
const clone = o => JSON.parse(JSON.stringify(o));
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;

/* ---------- Dates ---------- */
const THIS_YEAR = new Date().getFullYear();
function parseDate(input) {
  const s = String(input ?? '').trim().replace(/\s*(г\.?|года?)$/i, '').replace(/\s+/g, '');
  if (!s) return { ok: true, value: '' };
  let y, m, d, x;
  if ((x = s.match(/^(\d{4})$/))) y = +x[1];
  else if ((x = s.match(/^(\d{1,2})[./-](\d{4})$/))) { m = +x[1]; y = +x[2]; }
  else if ((x = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else if ((x = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) { y = +x[1]; m = +x[2]; d = x[3] ? +x[3] : undefined; }
  else return { ok: false, error: t('date.format') };
  if (y < 1000 || y > THIS_YEAR + 1) return { ok: false, error: t('date.year', { year: THIS_YEAR }) };
  if (m !== undefined && (m < 1 || m > 12)) return { ok: false, error: t('date.month') };
  if (d !== undefined && (d < 1 || d > new Date(y, m, 0).getDate())) return { ok: false, error: t('date.day') };
  const p2 = n => String(n).padStart(2, '0');
  return { ok: true, value: d !== undefined ? `${y}-${p2(m)}-${p2(d)}` : m !== undefined ? `${y}-${p2(m)}` : String(y) };
}
function fmtDate(v) { if (!v) return ''; const [y, m, d] = String(v).split('-'); return d ? `${d}.${m}.${y}` : m ? `${m}.${y}` : y; }
const yearOf = v => (v ? +String(v).slice(0, 4) : null);
function dateOrderError(b, d) {
  if (!b || !d) return '';
  const len = Math.min(b.length, d.length);
  return d.slice(0, len) < b.slice(0, len) ? t('date.order') : '';
}

/* ---------- Names (stored as written; transliterated for display in English mode) ---------- */
const rawFullName = p => [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ');
const rawShortName = p => [p.firstName, p.lastName].filter(Boolean).join(' ');
const displayName = p => T([p.firstName, p.patronymic].filter(Boolean).join(' '));
const unnamed = p => t(p && p.placeholder ? 'name.unknown' : 'name.unnamed');
const fullName = p => T(rawFullName(p)) || unnamed(p);
const shortName = p => T(rawShortName(p)) || unnamed(p);
function lifeSpan(p) { const b = yearOf(p.birthDate), d = yearOf(p.deathDate); if (b && d) return `${b}–${d}`; if (b) return t('life.born', { y: b }); if (d) return t('life.died', { y: d }); return ''; }
const initials = p => ((T(p.firstName || '')[0] || '') + (T(p.lastName || '')[0] || '')).toUpperCase() || '?';
const labelWithYear = p => { const ls = lifeSpan(p); return fullName(p) + (ls ? ` (${ls})` : ''); };
const sortKey = p => norm(p.lastName) + ' ' + norm(p.firstName) + ' ' + norm(p.patronymic);
const sortPeople = arr => arr.sort((a, b) => sortKey(a).localeCompare(sortKey(b), i18n.lang));
/* Text used by search: stored spelling + transliteration + other searchable fields. */
function searchHay(p) {
  const a = rawFullName(p), b = rawShortName(p);
  const extra = [p.maidenName, p.nickname, p.birthCity, p.occupation, p.notes, p.source, yearOf(p.birthDate), yearOf(p.deathDate)].filter(Boolean).join(' ');
  return norm([a, b, T(a, true), T(b, true), extra, T(extra, true)].join(' | '));
}

/* ---------- Relations ---------- */
function relId(type, from, to) { return type === 'spouse' ? 'sp_' + [from, to].sort().join('_') : 'par_' + from + '_' + to; }
function makeRel(type, from, to, extra = {}) {
  if (type === 'spouse') [from, to] = [from, to].sort();
  const r = { id: relId(type, from, to), type, from, to, createdAt: nowIso() };
  if (type === 'spouse') r.status = extra.status || '';
  if (type === 'parent') r.adopted = !!extra.adopted;
  return r;
}
function buildIndex(P, R) {
  const parents = new Map(), children = new Map(), spouses = new Map(), rel = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); const a = m.get(k); if (!a.includes(v)) a.push(v); };
  for (const r of R.values()) {
    if (!P.has(r.from) || !P.has(r.to) || r.from === r.to) continue;
    if (r.type === 'spouse') { add(spouses, r.from, r.to); add(spouses, r.to, r.from); }
    else if (r.type === 'parent') { add(parents, r.to, r.from); add(children, r.from, r.to); }
  }
  const byBirth = (a, b) => (yearOf(P.get(a).birthDate) ?? 9999) - (yearOf(P.get(b).birthDate) ?? 9999);
  for (const a of children.values()) a.sort(byBirth);
  const get = (m, k) => m.get(k) || [];
  return {
    parents: id => get(parents, id), children: id => get(children, id), spouses: id => get(spouses, id),
    relation: (type, a, b) => R.get(relId(type, a, b)) || null,
  };
}
function siblingsOf(idx, id) { const s = new Set(); for (const p of idx.parents(id)) for (const c of idx.children(p)) if (c !== id) s.add(c); return [...s]; }
function isAncestor(idx, a, b) {
  const seen = new Set(), st = [...idx.parents(b)];
  while (st.length) { const x = st.pop(); if (x === a) return true; if (seen.has(x)) continue; seen.add(x); st.push(...idx.parents(x)); }
  return false;
}
function checkParentLink(idx, parentId, childId) {
  if (parentId === childId) return t('link.self');
  if (idx.parents(childId).includes(parentId)) return t('link.exists');
  if (isAncestor(idx, childId, parentId)) return t('link.cycle');
  if (idx.parents(childId).length >= 2) return t('link.twoParents');
  return '';
}
function checkSpouseLink(idx, a, b) {
  if (a === b) return t('link.spouseSelf');
  if (idx.spouses(a).includes(b)) return t('link.exists');
  if (isAncestor(idx, a, b) || isAncestor(idx, b, a)) return t('link.spouseAncestor');
  return '';
}

/* ---------- Records & migration ---------- */
const ORIGINS = ['manual', 'photo', 'demo', 'import', 'gedcom'];
function newPersonRecord(fields, origin = 'manual') {
  const ts = nowIso(), rec = { id: uid('p'), schema: SCHEMA };
  for (const { key } of FIELDS) rec[key] = String(fields[key] ?? '').trim();
  if (fields.placeholder) rec.placeholder = true;
  return Object.assign(rec, { photos: [], mainPhoto: '', placeholder: !!fields.placeholder, extra: {}, origin, createdAt: ts, updatedAt: ts });
}
/* Brings a stored person up to the current schema. Idempotent. */
function migratePerson(p) {
  if (!p || typeof p !== 'object') return null;
  const out = { ...p };
  if (!out.schema || out.schema < 2) {
    // v1: `source` held the origin tag; v2 uses `origin` and frees `source` for the user's "where this came from" field.
    if (!out.origin) { out.origin = ORIGINS.includes(out.source) ? out.source : 'manual'; if (ORIGINS.includes(out.source)) out.source = ''; }
  }
  for (const { key } of FIELDS) if (typeof out[key] !== 'string') out[key] = out[key] == null ? '' : String(out[key]);
  if (!['', 'm', 'f'].includes(out.gender)) out.gender = '';
  out.photos = Array.isArray(out.photos) ? out.photos.filter(x => typeof x === 'string').slice(0, MAX_PHOTOS) : [];
  out.mainPhoto = typeof out.mainPhoto === 'string' && out.photos.includes(out.mainPhoto) ? out.mainPhoto : (out.photos[0] || '');
  out.placeholder = !!out.placeholder;
  out.extra = out.extra && typeof out.extra === 'object' ? out.extra : {};
  if (!ORIGINS.includes(out.origin)) out.origin = 'manual';
  out.createdAt = out.createdAt || nowIso(); out.updatedAt = out.updatedAt || out.createdAt;
  out.schema = SCHEMA;
  return out;
}
function migrateRelation(r) {
  if (!r || (r.type !== 'parent' && r.type !== 'spouse') || !r.from || !r.to) return null;
  const out = { ...r, from: String(r.from), to: String(r.to) };
  if (out.type === 'spouse') { [out.from, out.to] = [out.from, out.to].sort(); out.status = ['married', 'divorced', 'partner'].includes(out.status) ? out.status : ''; delete out.adopted; }
  else { out.adopted = !!out.adopted; delete out.status; }
  out.id = relId(out.type, out.from, out.to);
  out.createdAt = out.createdAt || nowIso();
  return out;
}

/* ---------- Import validation (JSON produced by the export, or hand-edited) ---------- */
function validateImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: t('import.errNotObject') };
  if (raw.schema != null && (typeof raw.schema !== 'number' || raw.schema > SCHEMA)) return { ok: false, error: t('import.errSchema', { v: String(raw.schema), max: SCHEMA }) };
  if (!Array.isArray(raw.persons)) return { ok: false, error: t('import.errNoPersons') };
  const persons = new Map(), warnings = { badPersons: 0, badRelations: 0 };
  raw.persons.forEach(p => {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) { warnings.badPersons++; return; }
    const m = migratePerson(p); if (!m) { warnings.badPersons++; return; }
    for (const f of FIELDS) if (f.type === 'date' && m[f.key]) { const pd = parseDate(m[f.key]); m[f.key] = pd.ok ? pd.value : ''; }
    m.origin = m.origin === 'demo' ? 'import' : m.origin;
    persons.set(m.id, m);
  });
  const relations = new Map();
  (Array.isArray(raw.relations) ? raw.relations : []).forEach(r => {
    const m = migrateRelation(r);
    if (!m || !persons.has(m.from) || !persons.has(m.to) || m.from === m.to) { warnings.badRelations++; return; }
    relations.set(m.id, m);
  });
  const photos = [];
  (Array.isArray(raw.photos) ? raw.photos : []).forEach(ph => {
    if (!ph || typeof ph.id !== 'string' || typeof ph.dataUrl !== 'string' || !/^data:image\//.test(ph.dataUrl)) return;
    photos.push({ id: ph.id, personId: String(ph.personId || ''), dataUrl: ph.dataUrl, w: +ph.w || 0, h: +ph.h || 0 });
  });
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : null;
  return { ok: true, persons, relations, photos, settings, warnings };
}

/* Probable duplicates between an imported person and the existing tree: same first+last name (and patronymic when both set), birth years equal, within 2 years, or missing. */
function duplicateCandidates(p, existing) {
  const fn = norm(p.firstName), ln = norm(p.lastName), pt = norm(p.patronymic), by = yearOf(p.birthDate);
  if (!fn && !ln) return [];
  return [...existing.values()].filter(e => {
    if (e.id === p.id) return false;
    if (norm(e.firstName) !== fn || norm(e.lastName) !== ln) return false;
    if (pt && norm(e.patronymic) && norm(e.patronymic) !== pt) return false;
    const ey = yearOf(e.birthDate);
    return by == null || ey == null || Math.abs(by - ey) <= 2;
  });
}

/* ---------- Analysis: generations, branches, statistics, problems ---------- */
function generations(P, idx) {
  const gen = new Map();
  const visiting = new Set();
  const g = id => {
    if (gen.has(id)) return gen.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = idx.parents(id);
    const v = ps.length ? 1 + Math.max(...ps.map(g)) : 0;
    visiting.delete(id); gen.set(id, v); return v;
  };
  for (const id of P.keys()) g(id);
  return gen;
}
/* Branch = the alphabetically first root ancestor; people who married in keep their own root. */
function branches(P, idx) {
  const root = new Map();
  const rootsOf = (id, seen = new Set()) => {
    if (seen.has(id)) return []; seen.add(id);
    const ps = idx.parents(id); if (!ps.length) return [id];
    return ps.flatMap(p => rootsOf(p, seen));
  };
  for (const id of P.keys()) { const rs = rootsOf(id).sort(); root.set(id, rs[0] || id); }
  const order = [...new Set(root.values())].sort((a, b) => sortKey(P.get(a)).localeCompare(sortKey(P.get(b))));
  const index = new Map(order.map((r, i) => [r, i]));
  const out = new Map(); for (const [id, r] of root) out.set(id, index.get(r));
  return out;
}
function stats(P, R, idx) {
  const arr = [...P.values()];
  const gens = generations(P, idx);
  const withBirth = arr.filter(p => yearOf(p.birthDate));
  const byBirth = withBirth.slice().sort((a, b) => yearOf(a.birthDate) - yearOf(b.birthDate));
  const couples = [...R.values()].filter(r => r.type === 'spouse' && P.has(r.from) && P.has(r.to));
  return {
    total: arr.length,
    men: arr.filter(p => p.gender === 'm').length, women: arr.filter(p => p.gender === 'f').length,
    unknownGender: arr.filter(p => !p.gender).length,
    deceased: arr.filter(p => p.deathDate).length,
    generations: arr.length ? Math.max(...gens.values()) + 1 : 0,
    oldest: byBirth[0] || null, youngest: byBirth[byBirth.length - 1] || null,
    missingBirth: arr.filter(p => !p.birthDate).length,
    missingAnyDate: arr.filter(p => !p.birthDate || (!p.deathDate && yearOf(p.birthDate) && THIS_YEAR - yearOf(p.birthDate) > 105)).length,
    couples: couples.length, divorced: couples.filter(r => r.status === 'divorced').length,
    links: R.size, withPhotos: arr.filter(p => p.photos && p.photos.length).length,
    placeholders: arr.filter(p => p.placeholder).length,
    isolated: arr.length > 1 ? arr.filter(p => !idx.parents(p.id).length && !idx.children(p.id).length && !idx.spouses(p.id).length).length : 0,
  };
}
/* Each problem: { kind, ids: [...], relId?, text, fixes: [{ act, label }] }. Fixes are executed by FT.tools. */
function problems(P, R, idx) {
  const out = [];
  const arr = sortPeople([...P.values()]);
  // duplicates
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i]; if (a.placeholder || seen.has(a.id)) continue;
    const dups = duplicateCandidates(a, P).filter(b => !seen.has(b.id) && !b.placeholder);
    if (dups.length) {
      seen.add(a.id); dups.forEach(d => seen.add(d.id));
      out.push({ kind: 'duplicate', ids: [a.id, ...dups.map(d => d.id)], text: t('problems.duplicate', { names: [a, ...dups].map(labelWithYear).join('; ') }), fixes: [{ act: 'merge', label: t('problems.fixMerge') }, { act: 'open', label: t('problems.fixOpen') }] });
    }
  }
  for (const r of R.values()) {
    if (!P.has(r.from) || !P.has(r.to)) continue;
    if (r.type === 'parent') {
      const pa = P.get(r.from), ch = P.get(r.to), py = yearOf(pa.birthDate), cy = yearOf(ch.birthDate);
      if (py != null && cy != null && cy < py + 12) {
        out.push({ kind: 'childBeforeParent', ids: [r.from, r.to], relId: r.id, text: t(cy < py ? 'problems.childBeforeParent' : 'problems.parentTooYoung', { parent: labelWithYear(pa), child: labelWithYear(ch) }), fixes: [{ act: 'swap', label: t('problems.fixSwap') }, { act: 'unlink', label: t('problems.fixUnlink') }, { act: 'open', label: t('problems.fixOpen') }] });
      }
      const pdy = yearOf(pa.deathDate);
      if (pdy != null && cy != null && cy > pdy + 1) out.push({ kind: 'childAfterDeath', ids: [r.from, r.to], relId: r.id, text: t('problems.childAfterDeath', { parent: labelWithYear(pa), child: labelWithYear(ch) }), fixes: [{ act: 'unlink', label: t('problems.fixUnlink') }, { act: 'open', label: t('problems.fixOpen') }] });
    }
  }
  for (const p of arr) {
    if (dateOrderError(p.birthDate, p.deathDate)) out.push({ kind: 'deathBeforeBirth', ids: [p.id], text: t('problems.deathBeforeBirth', { name: labelWithYear(p) }), fixes: [{ act: 'edit', label: t('problems.fixEdit') }] });
    if (idx.parents(p.id).length > 2) out.push({ kind: 'manyParents', ids: [p.id], text: t('problems.manyParents', { name: labelWithYear(p), n: idx.parents(p.id).length }), fixes: [{ act: 'open', label: t('problems.fixOpen') }] });
    if (arr.length > 1 && !idx.parents(p.id).length && !idx.children(p.id).length && !idx.spouses(p.id).length) out.push({ kind: 'isolated', ids: [p.id], text: t('problems.isolated', { name: labelWithYear(p) }), fixes: [{ act: 'open', label: t('problems.fixOpen') }, { act: 'delete', label: t('problems.fixDelete') }] });
    if (!p.placeholder && !p.firstName && !p.lastName) out.push({ kind: 'noName', ids: [p.id], text: t('problems.noName', { span: lifeSpan(p) }), fixes: [{ act: 'edit', label: t('problems.fixEdit') }] });
  }
  return out;
}

FT.model = {
  SCHEMA, MAX_PHOTOS, FIELDS, NAME_KEYS, fieldLabel, genderLabel, esc, people, links, uid, norm, nowIso, clone, reduceMotion, isNarrow,
  parseDate, fmtDate, yearOf, dateOrderError, THIS_YEAR,
  rawFullName, rawShortName, displayName, fullName, shortName, lifeSpan, initials, labelWithYear, sortKey, sortPeople, searchHay,
  relId, makeRel, buildIndex, siblingsOf, isAncestor, checkParentLink, checkSpouseLink,
  newPersonRecord, migratePerson, migrateRelation, validateImport, duplicateCandidates,
  generations, branches, stats, problems,
};
FT.S.idx = buildIndex(new Map(), new Map());
})();
