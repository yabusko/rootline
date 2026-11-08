/* Rootline — persistence: tree backends, photo store, backups, settings, recognition log, downloads, image helpers.
   Nothing here talks to the network except the Claude artifact database when the page runs inside Claude. */
(function () {
'use strict';
const M = FT.model;

const TREE_PATH = 'trees/main';
const LS = {
  tree: 'family-tree-v1',          // kept from v1 so existing trees load
  settings: 'rootline-settings',
  backups: 'rootline-backups',
  ocrLog: 'rootline-ocr-log',
  apiKey: 'rootline-api-key',
};
const lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

/* ---------- Tree backends ---------- */
function makeMemoryBackend(kind, initial, persistKey) {
  const P = new Map(), R = new Map(); let cb = null;
  if (initial) {
    for (const p of initial.persons || []) { const m = M.migratePerson(p); if (m) P.set(m.id, m); }
    for (const r of initial.relations || []) { const m = M.migrateRelation(r); if (m && P.has(m.from) && P.has(m.to)) R.set(m.id, m); }
  }
  const persist = () => { if (!persistKey) return; lsSet(persistKey, { schema: M.SCHEMA, persons: [...P.values()], relations: [...R.values()] }); };
  const emit = () => { if (cb) cb(new Map(P), new Map(R)); };
  return {
    kind,
    start(onChange) { cb = onChange; emit(); },
    stop() { cb = null; },
    async putPerson(p) { P.set(p.id, M.clone(p)); persist(); emit(); },
    async delPerson(id) { P.delete(id); persist(); emit(); },
    async putRel(r) { R.set(r.id, M.clone(r)); persist(); emit(); },
    async delRel(id) { R.delete(id); persist(); emit(); },
  };
}
function loadLocal() { const d = lsGet(LS.tree, null); return d && Array.isArray(d.persons) ? d : null; }
function makeDbBackend(db) {
  const pc = db.collection(TREE_PATH + '/persons'), rc = db.collection(TREE_PATH + '/relations');
  let unsubs = [];
  const strip = o => { const { id, ...rest } = o; return rest; };
  const retry = async fn => {
    try { return await fn(); } catch (e) {
      if (e && (e.code === 'unavailable' || e.code === 'resource_exhausted')) { await new Promise(r => setTimeout(r, 500 + Math.random() * 700)); return fn(); }
      throw e;
    }
  };
  return {
    kind: 'db',
    start(onChange, onError) {
      let P = null, R = null;
      const emit = () => { if (P && R) onChange(P, R); };
      unsubs.push(pc.limit(2000).onSnapshot(s => { P = new Map(); for (const d of s.docs) { const m = M.migratePerson({ ...d.data(), id: d.id }); if (m) P.set(m.id, m); } emit(); }, onError));
      unsubs.push(rc.limit(4000).onSnapshot(s => { R = new Map(); for (const d of s.docs) { const m = M.migrateRelation({ ...d.data(), id: d.id }); if (m) R.set(m.id, m); } emit(); }, onError));
    },
    stop() { unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); unsubs = []; },
    putPerson: p => retry(() => pc.doc(p.id).set(strip(p))),
    delPerson: id => retry(() => pc.doc(id).delete()),
    putRel: r => retry(() => rc.doc(r.id).set(strip(r))),
    delRel: id => retry(() => rc.doc(id).delete()),
  };
}

/* ---------- Photo store: IndexedDB locally, a collection in the artifact database inside Claude ---------- */
const photos = (() => {
  const cache = new Map();      // id → { id, personId, dataUrl, w, h }
  let impl = null, onChange = null;
  const notify = () => { if (onChange) onChange(); };

  function idbImpl() {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const req = indexedDB.open('rootline-photos', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('photos', { keyPath: 'id' }); };
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('photos', mode), st = t.objectStore('photos'); const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
    return {
      async loadAll() { const rows = await tx('readonly', st => st.getAll()); for (const r of rows || []) cache.set(r.id, r); },
      put: rec => tx('readwrite', st => st.put(rec)),
      del: id => tx('readwrite', st => st.delete(id)),
      clear: () => tx('readwrite', st => st.clear()),
    };
  }
  function memImpl() { return { async loadAll() {}, async put() {}, async del() {}, async clear() {} }; }
  function dbImpl(db) {
    const col = db.collection(TREE_PATH + '/photos');
    return {
      loadAll() {
        return new Promise(res => {
          let first = true;
          col.limit(2000).onSnapshot(s => {
            cache.clear(); for (const d of s.docs) cache.set(d.id, { ...d.data(), id: d.id });
            if (first) { first = false; res(); } else notify();
          }, () => { if (first) { first = false; res(); } });
        });
      },
      put: rec => { const { id, ...rest } = rec; return col.doc(id).set(rest); },
      del: id => col.doc(id).delete(),
      async clear() { for (const id of [...cache.keys()]) await col.doc(id).delete(); },
    };
  }
  let ready = Promise.resolve();
  return {
    get cache() { return cache; },
    get ready() { return ready; },
    use(kind, db) {
      cache.clear();
      impl = kind === 'db' ? dbImpl(db) : kind === 'local' && window.indexedDB ? idbImpl() : memImpl();
      ready = impl.loadAll().catch(() => {}).then(notify);
      return ready;
    },
    onChange(cb) { onChange = cb; },
    get: id => cache.get(id) || null,
    url: id => { const r = cache.get(id); return r ? r.dataUrl : ''; },
    async put(rec) { cache.set(rec.id, rec); notify(); try { await impl.put(rec); } catch (e) { /* keep in memory */ } },
    async del(id) { cache.delete(id); notify(); try { await impl.del(id); } catch (e) { /* ignore */ } },
    async clear() { cache.clear(); notify(); try { await impl.clear(); } catch (e) { /* ignore */ } },
    all: () => [...cache.values()],
    forPerson: p => (p.photos || []).map(id => cache.get(id)).filter(Boolean),
  };
})();

/* ---------- Automatic backups: the last 5 states, stored before a batch of changes ---------- */
const backups = {
  MAX: 5,
  list() { const l = lsGet(LS.backups, []); return Array.isArray(l) ? l : []; },
  push(snapshot) {
    const l = this.list();
    l.unshift(snapshot);
    while (l.length > this.MAX) l.pop();
    // Keep the ring under ~3 MB; drop the oldest entries first.
    while (l.length > 1 && JSON.stringify(l).length > 3_000_000) l.pop();
    return lsSet(LS.backups, l);
  },
  clear() { lsSet(LS.backups, []); },
};

/* ---------- Settings ---------- */
const settingsStore = { load: () => lsGet(LS.settings, null), save: v => lsSet(LS.settings, v) };

/* ---------- Recognition log (applied photo imports) ---------- */
const ocrLog = {
  MAX: 20,
  list() { const l = lsGet(LS.ocrLog, []); return Array.isArray(l) ? l : []; },
  push(entry) { const l = this.list(); l.unshift(entry); while (l.length > this.MAX) l.pop(); while (l.length > 1 && JSON.stringify(l).length > 2_000_000) l.pop(); lsSet(LS.ocrLog, l); },
  update(id, patch) { const l = this.list(); const e = l.find(x => x.id === id); if (e) Object.assign(e, patch); lsSet(LS.ocrLog, l); },
  remove(id) { lsSet(LS.ocrLog, this.list().filter(x => x.id !== id)); },
};

/* ---------- API key for recognition outside Claude ---------- */
const apiKey = {
  get: () => { try { return localStorage.getItem(LS.apiKey) || ''; } catch (e) { return ''; } },
  set: v => { try { if (v) localStorage.setItem(LS.apiKey, v); else localStorage.removeItem(LS.apiKey); } catch (e) { /* ignore */ } },
};

/* ---------- Downloads & file helpers ---------- */
async function download(filename, data, mime = 'application/octet-stream') {
  const dl = FT.S.caps.downloads;
  if (dl && typeof data === 'string') { try { await dl.save({ filename, data }); return true; } catch (e) { if (e && e.code === 'declined') return false; } }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
const readText = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });
const loadImage = src => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('image')); img.src = src; });
function canvasToBlob(c, type = 'image/jpeg', q = 0.9) { return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('blob'))), type, q)); }
const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
/* Resize + JPEG-compress any image source (File, Blob, canvas, img). */
async function compressImage(src, maxSide = 1600, quality = 0.85) {
  let img = src, url = null;
  if (src instanceof Blob) { url = URL.createObjectURL(src); img = await loadImage(url); }
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  if (url) URL.revokeObjectURL(url);
  const dataUrl = c.toDataURL('image/jpeg', quality);
  return { dataUrl, w: c.width, h: c.height, canvas: c };
}
function dataUrlToBase64(dataUrl) { const i = dataUrl.indexOf(','); return { mediaType: dataUrl.slice(5, dataUrl.indexOf(';')), data: dataUrl.slice(i + 1) }; }

FT.storage = { LS, TREE_PATH, lsGet, lsSet, makeMemoryBackend, loadLocal, makeDbBackend, photos, backups, settingsStore, ocrLog, apiKey, download, readText, loadImage, canvasToBlob, blobToDataUrl, compressImage, dataUrlToBase64 };
})();
