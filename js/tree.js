/* Rootline — tree layout (dagre), SVG rendering, pan & zoom, and a canvas renderer for PNG/PDF export. */
(function () {
'use strict';
const { t } = window.i18n;
const S = FT.S, M = FT.model, ST = FT.storage, SET = FT.settings;
const { esc, yearOf, lifeSpan, displayName, fullName, initials } = M;
const T = window.i18n.translit;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const SG = 34;           // gap between partners in a couple block
const TINTS = 8;

const measureCtx = document.createElement('canvas').getContext('2d');
function fitText(text, font, maxW) {
  measureCtx.font = font;
  if (measureCtx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measureCtx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo).trimEnd() + '…';
}
const fontFor = (weight, px, family) => `${weight} ${px}px ${SET.cssVar(family) || 'sans-serif'}`;

/* ---------- Layout ----------
   Computed in "logical" space where ranks go down (y) and siblings/partners go across (x).
   For left-to-right trees the logical axes are swapped when mapped to the screen. */
function dims() { const n = SET.nodeSize(); return { W: n.W, H: n.H, n }; }
function computeLayout() {
  const P = S.persons, idx = S.idx, cfg = SET.current, { W, H, n } = dims();
  const LR = cfg.direction === 'LR';
  const lw = LR ? H : W, lh = LR ? W : H, gap = SG;
  const ids = M.sortPeople([...P.values()]).map(p => p.id);
  ids.sort((a, b) => (yearOf(P.get(a).birthDate) ?? 9999) - (yearOf(P.get(b).birthDate) ?? 9999));
  const blockOf = new Map(), blocks = [];
  for (const id of ids) {
    if (blockOf.has(id)) continue;
    const comp = [], q = [id], seen = new Set([id]);
    while (q.length) { const x = q.shift(); comp.push(x); for (const y of idx.spouses(x)) if (!seen.has(y)) { seen.add(y); q.push(y); } }
    let order = comp;
    if (comp.length > 2) {
      const deg = x => idx.spouses(x).length;
      const start = comp.reduce((a, b) => (deg(b) < deg(a) ? b : a));
      order = []; const vis = new Set(); let cur = start;
      while (cur) { order.push(cur); vis.add(cur); cur = idx.spouses(cur).find(y => !vis.has(y)); }
      for (const x of comp) if (!vis.has(x)) order.push(x);
    }
    const bi = blocks.length; blocks.push(order); order.forEach(x => blockOf.set(x, bi));
  }
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: Math.round(44 * cfg.spacing), ranksep: Math.round(96 * cfg.spacing), marginx: 60, marginy: 70 });
  g.setDefaultEdgeLabel(() => ({}));
  blocks.forEach((b, i) => g.setNode('b' + i, { width: b.length * lw + (b.length - 1) * gap, height: lh }));
  for (const id of ids) for (const c of idx.children(id)) { const a = blockOf.get(id), b = blockOf.get(c); if (a !== b) g.setEdge('b' + a, 'b' + b); }
  dagre.layout(g);
  blocks.forEach((b, i) => {               // in a couple, put each partner on the side where their own parents are
    if (b.length !== 2) return;
    const n = g.node('b' + i);
    const px = id => { const ps = idx.parents(id); if (!ps.length) return null; return ps.reduce((s, p) => s + g.node('b' + blockOf.get(p)).x, 0) / ps.length; };
    const xa = px(b[0]), xc = px(b[1]);
    let swap = false;
    if (xa != null && xc != null) swap = xa > xc; else if (xa != null) swap = xa > n.x; else if (xc != null) swap = xc < n.x;
    if (swap) b.reverse();
  });
  const pos = new Map();
  blocks.forEach((b, i) => {
    const n = g.node('b' + i), left = n.x - n.width / 2;
    b.forEach((id, k) => pos.set(id, { x: left + k * (lw + gap) + lw / 2, y: n.y, block: i, slot: k }));
  });
  const gg = g.graph();
  const lwidth = gg.width || 400, lheight = gg.height || 200;
  const gens = cfg.colorBy === 'generation' ? M.generations(P, idx) : cfg.colorBy === 'branch' ? M.branches(P, idx) : null;
  return { pos, lw, lh, LR, W, H, n, width: LR ? lheight : lwidth, height: LR ? lwidth : lheight, tint: id => (gens ? gens.get(id) % TINTS : -1) };
}
const toScreen = (L, x, y) => (L.LR ? { x: y, y: x } : { x, y });

/* Edges as point lists so both renderers can draw them. */
function edgeSegments(L) {
  const P = S.persons, idx = S.idx, groups = new Map(), { lw, lh } = L;
  for (const id of P.keys()) {
    const ps = idx.parents(id); if (!ps.length) continue;
    const key = [...ps].sort().join('|');
    if (!groups.has(key)) groups.set(key, { ps, kids: [] });
    groups.get(key).kids.push(id);
  }
  const segs = []; let gi = 0;
  const adopted = (p, c) => { const r = S.relations.get(M.relId('parent', p, c)); return !!(r && r.adopted); };
  for (const { ps, kids } of groups.values()) {
    const pp = ps.map(p => L.pos.get(p));
    let origins;
    const same = pp.length === 2 && pp[0].block === pp[1].block;
    if (same && Math.abs(pp[0].slot - pp[1].slot) === 1) origins = [{ x: (pp[0].x + pp[1].x) / 2, y: pp[0].y }];
    else if (same) origins = [{ x: (pp[0].x + pp[1].x) / 2, y: pp[0].y + lh / 2 }];
    else origins = pp.map(p => ({ x: p.x, y: p.y + lh / 2 }));
    const kp = kids.map(k => { const q = L.pos.get(k); return { id: k, x: q.x, y: q.y - lh / 2, adopted: ps.some(p => adopted(p, k)) }; });
    const parentBottom = Math.max(...pp.map(p => p.y + lh / 2));
    const minTop = Math.min(...kp.map(k => k.y));
    if (minTop > parentBottom + 16) {
      const gap = minTop - parentBottom;
      let busY = parentBottom + Math.min(gap / 2, 48) + ((gi % 3) - 1) * 9;
      busY = Math.max(parentBottom + 8, Math.min(minTop - 8, busY));
      const trunk = [];
      for (const o of origins) trunk.push([{ x: o.x, y: o.y }, { x: o.x, y: busY }]);
      const xs = [...origins.map(o => o.x), ...kp.map(k => k.x)];
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      if (x1 - x0 > 0.5) trunk.push([{ x: x0, y: busY }, { x: x1, y: busY }]);
      segs.push({ cls: '', lines: trunk });
      for (const k of kp) segs.push({ cls: k.adopted ? 'adopted' : '', child: k.id, parents: ps, lines: [[{ x: k.x, y: busY }, { x: k.x, y: k.y }]] });
    } else {
      for (const o of origins) for (const k of kp) segs.push({ cls: k.adopted ? 'adopted' : '', child: k.id, parents: ps, lines: [[{ x: o.x, y: o.y }, { x: k.x, y: k.y }]] });
    }
    gi++;
  }
  return segs;
}
function marriageSegments(L) {
  const out = [], { lw, lh } = L;
  for (const r of S.relations.values()) {
    if (r.type !== 'spouse') continue;
    const a = L.pos.get(r.from), b = L.pos.get(r.to);
    if (!a || !b || a.block !== b.block) continue;
    const cls = r.status === 'divorced' ? 'divorced' : r.status === 'partner' ? 'partner' : '';
    const ends = { rel: r.id, idA: r.from, idB: r.to };
    if (Math.abs(a.slot - b.slot) === 1) {
      const left = a.x <= b.x;
      const x0 = Math.min(a.x, b.x) + lw / 2, x1 = Math.max(a.x, b.x) - lw / 2;
      out.push({ kind: 'line', cls, ...ends, a: { x: left ? x0 : x1, y: a.y }, b: { x: left ? x1 : x0, y: a.y } });
    } else {
      const top = a.y - lh / 2;
      out.push({ kind: 'curve', cls, ...ends, a: { x: a.x, y: top }, c1: { x: a.x, y: top - 40 }, c2: { x: b.x, y: top - 40 }, b: { x: b.x, y: top } });
    }
  }
  return out;
}
const ptsPath = (L, pts) => pts.map((p, i) => { const s = toScreen(L, p.x, p.y); return (i ? 'L' : 'M') + s.x + ',' + s.y; }).join('');
function edgesSvg(L) {
  return edgeSegments(L).map(seg => `<path class="${seg.cls}" d="${seg.lines.map(l => ptsPath(L, l)).join('')}"/>`).join('');
}
function marriagesSvg(L) {
  return marriageSegments(L).map(m => {
    const a = toScreen(L, m.a.x, m.a.y), b = toScreen(L, m.b.x, m.b.y);
    if (m.kind === 'line') return `<line class="${m.cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    const c1 = toScreen(L, m.c1.x, m.c1.y), c2 = toScreen(L, m.c2.x, m.c2.y);
    return `<path class="${m.cls}" d="M${a.x},${a.y}C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}"/>`;
  }).join('');
}

/* Text lines for a card, shared by SVG and canvas renderers. */
function cardLines(p, L) {
  const cfg = SET.current, n = L.n || SET.nodeSize(), textX = 2 * n.avatar + 20, maxW = L.W - textX - 10;
  const fName = fontFor(600, n.fontName, '--font-name'), fLast = fontFor(400, n.fontLast, '--font-ui'), fMeta = fontFor(400, n.fontMeta, '--font-ui');
  const lines = [{ cls: 'nm', font: fName, text: fitText(displayName(p) || (p.placeholder ? t('name.unknown') : t('name.unnamed')), fName, maxW) }];
  const metaParts = [];
  if (cfg.showDates) metaParts.push(lifeSpan(p));
  if (cfg.showPlaces) metaParts.push(T(p.birthCity));
  const meta = metaParts.filter(Boolean).join(', ');
  if (n.lines === 2) {
    if (p.lastName) lines.push({ cls: 'ln', font: fLast, text: fitText(T(p.lastName) + (meta ? ' · ' + meta : ''), fLast, maxW) });
    else if (meta) lines.push({ cls: 'mt', font: fMeta, text: fitText(meta, fMeta, maxW) });
  } else {
    if (p.lastName) lines.push({ cls: 'ln', font: fLast, text: fitText(T(p.lastName), fLast, maxW) });
    if (meta) lines.push({ cls: 'mt', font: fMeta, text: fitText(meta, fMeta, maxW) });
  }
  const H = L.H, k = lines.length;
  const ys = k === 1 ? [H / 2 + 5] : k === 2 ? [H / 2 - 4, H / 2 + 14] : [H / 2 - 11, H / 2 + 6, H / 2 + 22];
  return { lines, ys, textX };
}
function photoUrl(p) {
  if (!SET.current.showPhotos || !p.mainPhoto) return '';
  return ST.photos.url(p.mainPhoto);
}
function cardSvg(p, q, L) {
  const { W, H } = L, n = L.n, s = toScreen(L, q.x, q.y), x = s.x - W / 2, y = s.y - H / 2;
  const { lines, ys, textX } = cardLines(p, L);
  const ls = lifeSpan(p), tint = L.tint(p.id), r = n.avatar, cx = r + 11, cy = H / 2;
  const url = photoUrl(p);
  const avatar = url
    ? `<clipPath id="cp_${esc(p.id)}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><circle class="avatar" cx="${cx}" cy="${cy}" r="${r}"/><image href="${url}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cp_${esc(p.id)})"/>`
    : `<circle class="avatar" cx="${cx}" cy="${cy}" r="${r}"/><text class="initials" x="${cx}" y="${cy + n.fontMeta * 0.37}" text-anchor="middle">${esc(initials(p))}</text>`;
  const cls = ['person', p.id === S.selectedId ? 'selected' : '', p.deathDate ? 'deceased' : '', p.placeholder ? 'placeholder' : '', tint >= 0 ? 'tint-' + tint : ''].filter(Boolean).join(' ');
  // Link ports: drag one onto another card to create a link. Parents attach above (TB) / left (LR), children below / right, partners at the sides.
  const ports = S.readOnly ? '' : (L.LR
    ? `<circle class="port" data-port="parent" cx="0" cy="${H / 2}" r="6"/><circle class="port" data-port="child" cx="${W}" cy="${H / 2}" r="6"/><circle class="port" data-port="spouse" cx="${W / 2}" cy="0" r="6"/><circle class="port" data-port="spouse" cx="${W / 2}" cy="${H}" r="6"/>`
    : `<circle class="port" data-port="parent" cx="${W / 2}" cy="0" r="6"/><circle class="port" data-port="child" cx="${W / 2}" cy="${H}" r="6"/><circle class="port" data-port="spouse" cx="0" cy="${H / 2}" r="6"/><circle class="port" data-port="spouse" cx="${W}" cy="${H / 2}" r="6"/>`);
  return `<g class="${cls}" data-id="${esc(p.id)}" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="${esc(fullName(p) + (ls ? ', ' + ls : ''))}">`
    + `<rect class="card" width="${W}" height="${H}" rx="7"/>`
    + (tint >= 0 ? `<path class="tintbar" d="M0,7a7,7 0 0 1 7,-7h1v${H}h-1a7,7 0 0 1 -7,-7z"/>` : '')
    + avatar
    + lines.map((l, i) => `<text class="${l.cls}" x="${textX}" y="${ys[i]}">${esc(l.text)}</text>`).join('')
    + `<title>${esc(t('link.portHint'))}</title>`
    + ports
    + '</g>';
}
/* Invisible wide strokes over draggable links (child drops and marriage lines). */
function hitsSvg(L) {
  if (S.readOnly) return '';
  let out = '';
  for (const seg of edgeSegments(L)) if (seg.child) out += `<path class="hit" data-kind="child" data-child="${esc(seg.child)}" data-parents="${esc(seg.parents.join('|'))}" d="${seg.lines.map(l => ptsPath(L, l)).join('')}"/>`;
  for (const m of marriageSegments(L)) {
    const a = toScreen(L, m.a.x, m.a.y), b = toScreen(L, m.b.x, m.b.y);
    const d = m.kind === 'line' ? `M${a.x},${a.y}L${b.x},${b.y}` : (() => { const c1 = toScreen(L, m.c1.x, m.c1.y), c2 = toScreen(L, m.c2.x, m.c2.y); return `M${a.x},${a.y}C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`; })();
    out += `<path class="hit" data-kind="spouse" data-rel="${esc(m.rel)}" data-a="${esc(m.idA)}" data-b="${esc(m.idB)}" data-ax="${a.x}" data-ay="${a.y}" data-bx="${b.x}" data-by="${b.y}" d="${d}"/>`;
  }
  return out;
}

let lastLayout = null;
function renderTree() {
  const vp = $('#viewport'), svg = $('#treeSvg');
  const empty = S.loaded && S.persons.size === 0;
  $('#loading').hidden = S.loaded;
  $('#empty').hidden = !empty;
  $('#empty [data-empty="add"]').hidden = S.readOnly;
  $('#empty [data-empty="upload"]').hidden = S.readOnly || S.caps.sampleState === 'unavailable';
  $('#empty [data-empty="import"]').hidden = S.readOnly;
  $('#empty [data-empty="demo"]').hidden = S.mode === 'demo' || !S.realFactory;
  const show = S.loaded && !empty;
  svg.style.visibility = show ? 'visible' : 'hidden';
  $('#zoomCtrl').hidden = !show; $('#hintPan').hidden = !show;
  if (!show) { vp.innerHTML = ''; lastLayout = null; return; }
  if (!window.dagre) { $('#loading').hidden = false; $('#loading').textContent = t('tree.noLayout'); return; }
  const focusedId = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.person')?.dataset.id : null;
  const L = computeLayout(); lastLayout = L;
  svg.dataset.size = SET.current.nodeSize;
  if (S.pendingSelect && L.pos.has(S.pendingSelect)) { S.selectedId = S.pendingSelect; S.pendingSelect = null; S.centerAfter = S.selectedId; }
  let html = `<g class="edges">${edgesSvg(L)}</g><g class="marriages">${marriagesSvg(L)}</g><g class="hits">${hitsSvg(L)}</g><g class="nodes">`;
  for (const p of S.persons.values()) html += cardSvg(p, L.pos.get(p.id), L);
  vp.innerHTML = html + '</g><g class="drag-layer"></g>';
  if (focusedId) { const el = vp.querySelector(`.person[data-id="${CSS.escape(focusedId)}"]`); if (el) el.focus({ preventScroll: true }); }
  if (S.needFit) { S.needFit = false; S.centerAfter = null; fitView(false); }
  else if (S.centerAfter) { const id = S.centerAfter; S.centerAfter = null; centerOn(id); }
}

/* ---------- Pan & zoom ---------- */
let zoom = null, svgSel = null, curT = null;
function initZoom() {
  if (!window.d3) return;
  curT = d3.zoomIdentity;
  svgSel = d3.select('#treeSvg');
  zoom = d3.zoom().scaleExtent([0.1, 3]).on('zoom', e => {
    curT = e.transform;
    $('#viewport').setAttribute('transform', e.transform.toString());
    let s = 20 * curT.k; while (s < 10) s *= 2;
    const c = $('#canvas'); c.style.backgroundSize = `${s}px ${s}px`; c.style.backgroundPosition = `${curT.x}px ${curT.y}px`;
  });
  svgSel.call(zoom).on('dblclick.zoom', null);
}
function svgSize() { const r = $('#treeSvg').getBoundingClientRect(); return { w: r.width, h: r.height }; }
function fitView(animate = true) {
  if (!lastLayout || !zoom) return;
  const { w, h } = svgSize(); if (!w || !h) return;
  const k = Math.max(0.1, Math.min(1.1, Math.min(w / lastLayout.width, h / lastLayout.height)));
  const tr = d3.zoomIdentity.translate((w - lastLayout.width * k) / 2, (h - lastLayout.height * k) / 2).scale(k);
  (animate && !M.reduceMotion() ? svgSel.transition().duration(350) : svgSel).call(zoom.transform, tr);
}
function centerOn(id, scale) {
  const q = lastLayout && lastLayout.pos.get(id); if (!q || !zoom) return;
  const s = toScreen(lastLayout, q.x, q.y);
  const { w, h } = svgSize(); const k = scale || Math.max(curT.k, 0.8);
  const tr = d3.zoomIdentity.translate(w / 2 - s.x * k, h / 2 - s.y * k).scale(k);
  (M.reduceMotion() ? svgSel : svgSel.transition().duration(400)).call(zoom.transform, tr);
}
function zoomBy(f) { if (zoom) (M.reduceMotion() ? svgSel : svgSel.transition().duration(250)).call(zoom.scaleBy, f); }

/* ---------- Dragging links: ports create links, existing links can be moved; cards act as magnets ---------- */
let drag = null, suppressClick = false;
function pointerToViewport(e) {
  const r = $('#treeSvg').getBoundingClientRect();
  const [x, y] = curT ? curT.invert([e.clientX - r.left, e.clientY - r.top]) : [e.clientX - r.left, e.clientY - r.top];
  return { x, y };
}
function cardCenter(id) { const q = lastLayout && lastLayout.pos.get(id); return q ? toScreen(lastLayout, q.x, q.y) : null; }
function portPoint(id, port) {
  const c = cardCenter(id); if (!c) return null;
  const { W, H, LR } = lastLayout;
  if (port === 'parent') return LR ? { x: c.x - W / 2, y: c.y } : { x: c.x, y: c.y - H / 2 };
  if (port === 'child') return LR ? { x: c.x + W / 2, y: c.y } : { x: c.x, y: c.y + H / 2 };
  return c;
}
/* The card under (or near) the pointer, excluding the given ids; cards attract within a 40px halo. */
function magnetAt(pt, exclude) {
  if (!lastLayout) return null;
  const { W, H } = lastLayout; let best = null, bestD = Infinity;
  for (const id of S.persons.keys()) {
    if (exclude.includes(id)) continue;
    const c = cardCenter(id);
    const dx = Math.max(0, Math.abs(pt.x - c.x) - W / 2), dy = Math.max(0, Math.abs(pt.y - c.y) - H / 2);
    const d = Math.hypot(dx, dy);
    if (d <= 40 && d < bestD) { best = id; bestD = d; }
  }
  return best;
}
function startDrag(e) {
  if (S.readOnly || !lastLayout) return;
  const port = e.target.closest('.port'), hit = e.target.closest('.hit');
  if (!port && !hit) return;
  e.preventDefault(); e.stopPropagation();     // keeps d3-zoom from panning
  const svg = $('#treeSvg'); svg.setPointerCapture(e.pointerId);
  const pt = pointerToViewport(e);
  if (port) {
    const id = port.closest('.person').dataset.id;
    drag = { kind: 'new', port: port.dataset.port, id, fixed: portPoint(id, port.dataset.port), exclude: [id] };
  } else if (hit.dataset.kind === 'child') {
    const child = hit.dataset.child, parents = hit.dataset.parents.split('|');
    const pts = hit.getAttribute('d').match(/-?[\d.]+,-?[\d.]+/g).map(s => s.split(',').map(Number));
    drag = { kind: 'rechild', child, parents, fixed: { x: pts[0][0], y: pts[0][1] }, exclude: [child, ...parents] };
  } else {
    const a = hit.dataset.a, b = hit.dataset.b;
    const pa = { x: +hit.dataset.ax, y: +hit.dataset.ay }, pb = { x: +hit.dataset.bx, y: +hit.dataset.by };
    const nearA = Math.hypot(pt.x - pa.x, pt.y - pa.y) <= Math.hypot(pt.x - pb.x, pt.y - pb.y);
    drag = { kind: 'respouse', rel: hit.dataset.rel, keep: nearA ? b : a, replace: nearA ? a : b, fixed: cardCenter(nearA ? b : a), exclude: [a, b] };
  }
  drag.target = null;
  svg.classList.add('linking');
  const layer = $('#viewport .drag-layer');
  layer.innerHTML = `<path class="ghost" d=""/>`;
  moveDrag(e);
}
function moveDrag(e) {
  if (!drag) return;
  const pt = pointerToViewport(e);
  const target = magnetAt(pt, drag.exclude);
  if (target !== drag.target) {
    drag.target = target;
    $$('#viewport .person.magnet').forEach(g => g.classList.remove('magnet'));
    if (target) { const g = $(`#viewport .person[data-id="${CSS.escape(target)}"]`); if (g) g.classList.add('magnet'); }
  }
  const end = target ? cardCenter(target) : pt;
  const ghost = $('#viewport .ghost'); if (ghost) ghost.setAttribute('d', `M${drag.fixed.x},${drag.fixed.y}L${end.x},${end.y}`);
}
async function endDrag(e) {
  if (!drag) return;
  const d = drag; drag = null;
  $('#treeSvg').classList.remove('linking');
  $$('#viewport .person.magnet').forEach(g => g.classList.remove('magnet'));
  const layer = $('#viewport .drag-layer'); if (layer) layer.innerHTML = '';
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
  if (!d.target || e.type === 'pointercancel') return;
  await applyDrop(d, d.target);
}
async function applyDrop(d, target) {
  const idx = S.idx, ops = []; let problem = '', label = '';
  if (d.kind === 'new') {
    if (d.port === 'child') { problem = M.checkParentLink(idx, d.id, target); ops.push({ t: 'putRel', r: M.makeRel('parent', d.id, target) }); }
    else if (d.port === 'parent') { problem = M.checkParentLink(idx, target, d.id); ops.push({ t: 'putRel', r: M.makeRel('parent', target, d.id) }); }
    else { problem = M.checkSpouseLink(idx, d.id, target); ops.push({ t: 'putRel', r: M.makeRel('spouse', d.id, target, { status: 'married' }) }); }
    label = t('toast.linkAdded');
  } else if (d.kind === 'rechild') {
    // Move the child to a new parent (and that parent's only partner, when there is exactly one).
    const R = new Map(S.relations); const removed = [];
    for (const p of d.parents) { const id = M.relId('parent', p, d.child); if (R.has(id)) { removed.push({ t: 'delRel', id }); R.delete(id); } }
    let tmp = M.buildIndex(S.persons, R);
    problem = M.checkParentLink(tmp, target, d.child);
    if (!problem) {
      const r1 = M.makeRel('parent', target, d.child); ops.push(...removed, { t: 'putRel', r: r1 }); R.set(r1.id, r1); tmp = M.buildIndex(S.persons, R);
      const sp = tmp.spouses(target);
      if (sp.length === 1 && !M.checkParentLink(tmp, sp[0], d.child)) ops.push({ t: 'putRel', r: M.makeRel('parent', sp[0], d.child) });
    }
    label = t('toast.linkMoved');
  } else if (d.kind === 'respouse') {
    const old = S.relations.get(d.rel);
    const R = new Map(S.relations); R.delete(d.rel);
    problem = M.checkSpouseLink(M.buildIndex(S.persons, R), d.keep, target);
    if (!problem) ops.push({ t: 'delRel', id: d.rel }, { t: 'putRel', r: M.makeRel('spouse', d.keep, target, { status: old ? old.status : '' }) });
    label = t('toast.linkMoved');
  }
  if (problem) { FT.core.toast(problem, { kind: 'error' }); return; }
  if (await FT.core.applyOps(ops, { label })) { S.centerAfter = null; FT.scheduleRender(); setTimeout(() => FT.ui.flashNode(target), 60); }
}
function initLinkDrag() {
  const svg = $('#treeSvg');
  svg.addEventListener('pointerdown', startDrag);
  svg.addEventListener('pointermove', moveDrag);
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) { drag.target = null; endDrag({ type: 'pointercancel' }); } });
}

/* ---------- Canvas renderer (PNG / PDF export) ---------- */
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
async function renderToCanvas({ scale = 2, title = '', subtitle = '', background = true } = {}) {
  const L = lastLayout || computeLayout();
  const v = SET.cssVar, pad = 40, headH = title ? 96 : 0;
  const width = Math.ceil((L.width + pad * 2) * scale), height = Math.ceil((L.height + pad * 2 + headH) * scale);
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = v('--paper') || '#fff'; ctx.fillRect(0, 0, width, height); }
  ctx.scale(scale, scale);
  if (title) {
    ctx.fillStyle = v('--ink'); ctx.font = fontFor(600, 28, '--font-name'); ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, pad, pad + 10);
    if (subtitle) { ctx.fillStyle = v('--ink-2'); ctx.font = fontFor(400, 14, '--font-ui'); ctx.fillText(subtitle, pad, pad + 38); }
  }
  ctx.translate(pad, pad + headH);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // edges
  for (const seg of edgeSegments(L)) {
    ctx.strokeStyle = v('--ink-2'); ctx.lineWidth = 1.4; ctx.setLineDash(seg.cls === 'adopted' ? [5, 4] : []);
    ctx.beginPath();
    for (const line of seg.lines) line.forEach((p, i) => { const s = toScreen(L, p.x, p.y); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.stroke();
  }
  for (const m of marriageSegments(L)) {
    ctx.strokeStyle = v('--ink'); ctx.lineWidth = m.kind === 'line' ? 2.2 : 1.8;
    ctx.setLineDash(m.cls === 'divorced' ? [4, 4] : m.cls === 'partner' ? [2, 4] : m.kind === 'curve' ? [5, 4] : []);
    const a = toScreen(L, m.a.x, m.a.y), b = toScreen(L, m.b.x, m.b.y);
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    if (m.kind === 'line') ctx.lineTo(b.x, b.y); else { const c1 = toScreen(L, m.c1.x, m.c1.y), c2 = toScreen(L, m.c2.x, m.c2.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const { W, H, n } = L;
  for (const p of S.persons.values()) {
    const q = L.pos.get(p.id), s = toScreen(L, q.x, q.y), x = s.x - W / 2, y = s.y - H / 2;
    roundRect(ctx, x, y, W, H, 7);
    ctx.fillStyle = v('--surface'); ctx.fill();
    ctx.strokeStyle = v('--line-strong'); ctx.lineWidth = 1; ctx.setLineDash(p.placeholder ? [4, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    const tint = L.tint(p.id);
    if (tint >= 0) { ctx.save(); roundRect(ctx, x, y, W, H, 7); ctx.clip(); ctx.fillStyle = v('--tint-' + tint); ctx.fillRect(x, y, 8, H); ctx.restore(); }
    const r = n.avatar, cx = x + r + 11, cy = y + H / 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = v(p.deathDate ? '--line' : '--accent-soft'); ctx.fill();
    const url = photoUrl(p);
    let drawn = false;
    if (url) { try { const img = await ST.loadImage(url); ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip(); const k = Math.max(2 * r / img.width, 2 * r / img.height); ctx.drawImage(img, cx - img.width * k / 2, cy - img.height * k / 2, img.width * k, img.height * k); ctx.restore(); drawn = true; } catch (e) { /* fall through */ } }
    if (!drawn) { ctx.fillStyle = v(p.deathDate ? '--ink-2' : '--accent'); ctx.font = fontFor(600, n.fontMeta + 0.5, '--font-ui'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(p), cx, cy + 0.5); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
    const { lines, ys, textX } = cardLines(p, L);
    lines.forEach((l, i) => { ctx.font = l.font; ctx.fillStyle = v(l.cls === 'mt' ? '--ink-2' : '--ink'); ctx.fillText(l.text, x + textX, y + ys[i]); });
  }
  return c;
}

FT.tree = { renderTree, initZoom, initLinkDrag, fitView, centerOn, zoomBy, renderToCanvas, computeLayout, get layout() { return lastLayout; }, get dragging() { return !!drag; }, get suppressClick() { return suppressClick; }, fitText, fontFor, roundRect };
})();
