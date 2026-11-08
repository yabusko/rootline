/* Rootline — core: backend switching, change batches with undo/redo, automatic backups, toasts. */
(function () {
'use strict';
const { t } = window.i18n;
const S = FT.S, M = FT.model, ST = FT.storage;
const $ = (s, r = document) => r.querySelector(s);

/* ---------- Toasts ---------- */
function toast(msg, { action, onAction, kind, ms } = {}) {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  const span = document.createElement('span'); span.textContent = msg; el.append(span);
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-btn'; b.textContent = action;
    b.onclick = () => { el.remove(); onAction(); }; el.append(b);
  }
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), ms || (action ? 10000 : kind === 'error' ? 8000 : 5000));
}

/* ---------- Backend ---------- */
let renderQueued = false;
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; if (FT.renderAll) FT.renderAll(); }); }

function useBackend(b, keep = {}) {
  if (S.backend) S.backend.stop();
  Object.assign(S, { backend: b, mode: b.kind, loaded: false, needFit: true, selectedId: null, persons: new Map(), relations: new Map() }, keep);
  S.history = { undo: [], redo: [] };
  S.idx = M.buildIndex(S.persons, S.relations);
  b.start((P, R) => {
    S.persons = P; S.relations = R; S.idx = M.buildIndex(P, R); S.loaded = true;
    if (S.selectedId && !P.has(S.selectedId)) S.selectedId = null;
    scheduleRender();
  }, onStoreError);
  scheduleRender();
}
function onStoreError(e) {
  if (e && e.code === 'revoked') { setReadOnly(true); toast(t('store.revoked'), { kind: 'error' }); }
  else toast(t('store.loadFail'), { kind: 'error' });
  S.loaded = true; scheduleRender();
}
function setReadOnly(v) { S.realReadOnly = v; if (S.mode !== 'demo') S.readOnly = v; scheduleRender(); }

/* ---------- Operations ----------
   op: { t: 'putPerson', p } | { t: 'delPerson', id } | { t: 'putRel', r } | { t: 'delRel', id } */
function opKey(op) { return (op.t.endsWith('Person') ? 'P:' : 'R:') + (op.p ? op.p.id : op.r ? op.r.id : op.id); }
function invert(op) {
  if (op.t === 'putPerson') { const prev = S.persons.get(op.p.id); return prev ? { t: 'putPerson', p: M.clone(prev) } : { t: 'delPerson', id: op.p.id }; }
  if (op.t === 'delPerson') { const prev = S.persons.get(op.id); return prev ? { t: 'putPerson', p: M.clone(prev) } : null; }
  if (op.t === 'putRel') { const prev = S.relations.get(op.r.id); return prev ? { t: 'putRel', r: M.clone(prev) } : { t: 'delRel', id: op.r.id }; }
  if (op.t === 'delRel') { const prev = S.relations.get(op.id); return prev ? { t: 'putRel', r: M.clone(prev) } : null; }
  return null;
}
function runOp(op) {
  const b = S.backend;
  if (op.t === 'putPerson') return b.putPerson(op.p);
  if (op.t === 'delPerson') return b.delPerson(op.id);
  if (op.t === 'putRel') return b.putRel(op.r);
  return b.delRel(op.id);
}
/* Ops that only re-put identical records are dropped, so "no-op" batches don't pollute history. */
function isNoop(op) {
  if (op.t === 'putPerson') { const prev = S.persons.get(op.p.id); return !!prev && JSON.stringify({ ...prev, updatedAt: 0 }) === JSON.stringify({ ...op.p, updatedAt: 0 }); }
  if (op.t === 'putRel') { const prev = S.relations.get(op.r.id); return !!prev && JSON.stringify(prev) === JSON.stringify(op.r); }
  if (op.t === 'delPerson') return !S.persons.has(op.id);
  if (op.t === 'delRel') return !S.relations.has(op.id);
  return true;
}

let lastBackupAt = 0;
function snapshotForBackup(reason) {
  if (S.mode === 'demo' || !S.persons.size) return;
  const now = Date.now();
  if (now - lastBackupAt < 20000) return;   // at most one snapshot per 20 s of activity
  lastBackupAt = now;
  ST.backups.push({ at: M.nowIso(), reason, persons: [...S.persons.values()], relations: [...S.relations.values()] });
}

async function applyOps(ops, { label, undoable = true, onProgress, record = true, backup = true, reason = 'edit' } = {}) {
  if (S.readOnly) { toast(t('store.readOnly'), { kind: 'error' }); return false; }
  const byKey = new Map();
  for (const op of ops) byKey.set(opKey(op), op);
  const final = [...byKey.values()].filter(op => !isNoop(op));
  if (!final.length) return true;
  const inverse = final.map(invert).filter(Boolean);
  if (backup) snapshotForBackup(reason);
  const queue = final.slice(); let done = 0, failed = null;
  const worker = async () => {
    while (queue.length && !failed) {
      const op = queue.shift();
      try { await runOp(op); } catch (e) { failed = e; }
      done++; if (onProgress) onProgress(done, final.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, final.length) }, worker));
  if (failed) { handleWriteError(failed); return false; }
  if (record && undoable && inverse.length) {
    S.history.undo.push({ ops: final, inverse, label });
    if (S.history.undo.length > 100) S.history.undo.shift();
    S.history.redo = [];
    toast(label || t('toast.saved'), { action: t('toast.undo'), onAction: undo });
  } else if (label) toast(label);
  document.dispatchEvent(new CustomEvent('treechange'));
  return true;
}
async function undo() {
  const e = S.history.undo.pop(); if (!e) return false;
  const ok = await applyOps(e.inverse, { record: false, backup: false });
  if (ok) { S.history.redo.push(e); toast(t('toast.undone'), { action: t('toast.redo'), onAction: redo }); scheduleRender(); }
  else S.history.undo.push(e);
  return ok;
}
async function redo() {
  const e = S.history.redo.pop(); if (!e) return false;
  // Re-derive the inverse against the current state so a later undo restores exactly this state.
  const inverse = e.ops.map(invert).filter(Boolean);
  const ok = await applyOps(e.ops, { record: false, backup: false });
  if (ok) { S.history.undo.push({ ...e, inverse }); toast(t('toast.redone')); scheduleRender(); }
  else S.history.redo.push(e);
  return ok;
}
function handleWriteError(e) {
  const code = e && e.code;
  if ((code === 'invalid_argument' && S.canWrite !== true) || code === 'not_granted' || code === 'revoked') {
    setReadOnly(true); toast(t('write.noRights'), { kind: 'error' });
  } else if (code === 'quota_exceeded') toast(t('write.quota'), { kind: 'error' });
  else if (code === 'resource_exhausted') toast(t('write.tooMany'), { kind: 'error' });
  else toast(t('write.fail'), { kind: 'error' });
}

/* Replace the whole tree (import "replace", restore backup). Returns true on success. */
async function replaceTree(persons, relations, label) {
  const ops = [
    ...[...S.persons.keys()].filter(id => !persons.has(id)).map(id => ({ t: 'delPerson', id })),
    ...[...S.relations.keys()].filter(id => !relations.has(id)).map(id => ({ t: 'delRel', id })),
    ...[...persons.values()].map(p => ({ t: 'putPerson', p })),
    ...[...relations.values()].map(r => ({ t: 'putRel', r })),
  ];
  return applyOps(ops, { label, reason: 'replace' });
}

FT.scheduleRender = scheduleRender;
FT.core = { toast, useBackend, setReadOnly, applyOps, undo, redo, invert, replaceTree, snapshotForBackup };
})();
