/* Rootline — photo recognition: image preparation, the Claude request, and the verification (review) screen.
   Where it runs: the prepared photo and the list of names already in the tree (for matching) are sent to Claude —
   either through the Claude artifact runtime (when the page is opened in Claude) or directly to the Anthropic API
   with the user's own key. Nothing else leaves the browser. */
(function () {
'use strict';
const { t } = window.i18n;
const T = window.i18n.translit;
const S = FT.S, M = FT.model, ST = FT.storage, C = FT.core, SET = FT.settings, UI = FT.ui;
const { esc, FIELDS, fieldLabel, fullName, shortName, labelWithYear, lifeSpan, fmtDate, parseDate, norm, yearOf, relId, makeRel } = M;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const OCR_KEYS = ['firstName', 'patronymic', 'lastName', 'maidenName', 'nickname', 'gender', 'birthDate', 'deathDate', 'birthCity', 'occupation', 'notes'];
const CONF = ['high', 'medium', 'low'];

/* ---------- Provider ---------- */
let provider = null;
const FATAL = ['sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'images_unavailable'];
function parseJsonText(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  if (a < 0) throw { code: 'invalid_json', raw: text };
  s = s.slice(a);
  const b = s.lastIndexOf('}');
  if (b >= 0) { try { return JSON.parse(s.slice(0, b + 1)); } catch (e) { /* fall through to repair */ } }
  const repaired = repairJson(s);
  if (repaired) { try { const o = JSON.parse(repaired); o._repaired = true; return o; } catch (e) { /* give up */ } }
  throw { code: 'invalid_json', raw: text };
}
/* Best-effort repair of a JSON object cut off mid-way (e.g. the output token limit was hit):
   truncate to the last complete value and close every open bracket. */
function repairJson(s) {
  const stack = []; let inStr = false, esc = false, lastGood = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') { inStr = false; lastGood = i; } continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') { stack.pop(); lastGood = i; }
    else if (/[0-9a-z]/i.test(ch) && !/[0-9a-z.]/i.test(s[i + 1] || ' ')) lastGood = i;  // end of a number / true / false / null
  }
  if (lastGood < 0) return null;
  let out = s.slice(0, lastGood + 1);
  // drop a dangling `"key":` or `,"key"` left at the cut, and a trailing comma
  out = out.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, '').replace(/,\s*"(?:[^"\\]|\\.)*"\s*$/, '').replace(/,\s*$/, '');
  // close whatever is still open
  const open = []; inStr = false; esc = false;
  for (const ch of out) { if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; } if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') open.push(ch); else if (ch === '}' || ch === ']') open.pop(); }
  while (open.length) out += open.pop() === '{' ? '}' : ']';
  return out;
}
/* JSON schema for structured output (every object closed with additionalProperties: false). */
const CONF_ENUM = ['high', 'medium', 'low', ''];
function outputSchema() {
  const str = { type: 'string' };
  const conf = { type: 'object', additionalProperties: false, properties: Object.fromEntries(OCR_KEYS.map(k => [k, { type: 'string', enum: CONF_ENUM }])), required: OCR_KEYS };
  const person = { type: 'object', additionalProperties: false, required: ['ref', 'matchId', ...OCR_KEYS, 'rawText', 'box', 'confidence', 'uncertain'],
    properties: { ref: str, matchId: str, ...Object.fromEntries(OCR_KEYS.map(k => [k, k === 'gender' ? { type: 'string', enum: ['m', 'f', ''] } : str])), rawText: str, box: { type: 'array', items: { type: 'number' } }, confidence: conf, uncertain: str } };
  const relation = { type: 'object', additionalProperties: false, required: ['type', 'from', 'to', 'confidence', 'status', 'adopted'],
    properties: { type: { type: 'string', enum: ['parent', 'spouse'] }, from: str, to: str, confidence: { type: 'string', enum: CONF_ENUM }, status: { type: 'string', enum: ['married', 'divorced', 'partner', ''] }, adopted: { type: 'boolean' } } };
  return { type: 'object', additionalProperties: false, required: ['kind', 'kindNote', 'people', 'relations', 'warnings'],
    properties: { kind: { type: 'string', enum: ['tree', 'portrait', 'other'] }, kindNote: str, people: { type: 'array', items: person }, relations: { type: 'array', items: relation }, warnings: { type: 'array', items: str } } };
}
function claudeProvider(sample, limits) {
  return {
    kind: 'claude', maxImages: (limits && limits.images && limits.images.maxCount) || 1,
    json: (prompt, images, { tier, signal, onText }) => sample.json(prompt, { images, modelTier: tier === 'best' ? 'complex' : 'default', signal, onText }),
  };
}
/* Reads a Messages API SSE stream; returns { text, stopReason }. */
async function readSse(res, onText, signal) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', text = '', stopReason = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; if (onText) onText(text); }
        else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
        else if (ev.type === 'error') throw { code: 'api_error', detail: (ev.error && ev.error.message) || 'stream error' };
      }
    }
    if (signal && signal.aborted) throw { code: 'cancelled' };
  }
  return { text, stopReason };
}
function apiProvider(key) {
  return {
    kind: 'api', maxImages: 5,
    async json(prompt, images, { tier, signal, onText }) {
      const content = [];
      for (const blob of images) { const dataUrl = await ST.blobToDataUrl(blob); const { mediaType, data } = ST.dataUrlToBase64(dataUrl); content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } }); }
      content.push({ type: 'text', text: prompt });
      const model = SET.current.model || 'claude-opus-5-5';
      const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' };
      const useFallback = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
      if (useFallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      const makeBody = structured => {
        const body = { model, max_tokens: 64000, stream: true, output_config: { effort: tier === 'best' ? 'max' : 'high' }, messages: [{ role: 'user', content }] };
        if (structured) body.output_config.format = { type: 'json_schema', schema: outputSchema() };
        if (useFallback) body.fallbacks = 'default';
        return body;
      };
      const request = async structured => {
        let res;
        try { res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(makeBody(structured)), signal }); }
        catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled' }; throw { code: 'network' }; }
        if (!res.ok) {
          let detail = ''; try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
          if (res.status === 401 || res.status === 403) throw { code: 'bad_key', detail };
          if (res.status === 429) throw { code: 'rate_limited', detail };
          if (res.status === 413 || /too (large|long)|prompt is too long/i.test(detail)) throw { code: 'prompt_too_large', detail };
          if (res.status === 400 && structured && /output_config|format|schema/i.test(detail)) throw { code: 'no_structured', detail };
          if (res.status === 400 && /image/i.test(detail)) throw { code: 'image_rejected', detail };
          throw { code: 'api_error', detail: `${res.status} ${detail}`.trim() };
        }
        return readSse(res, onText, signal);
      };
      let out;
      try { out = await request(true); }
      catch (e) { if (e && e.code === 'no_structured') out = await request(false); else throw e; }   // older proxies / models without structured output
      if (out.stopReason === 'refusal') throw { code: 'refused' };
      if (!out.text.trim()) throw { code: 'empty_completion' };
      const parsed = parseJsonText(out.text);
      if (out.stopReason === 'max_tokens') parsed._truncated = true;
      return parsed;
    },
  };
}
function refreshProvider() {
  if (S.caps.sample) { provider = claudeProvider(S.caps.sample, S.caps.sampleLimits); S.caps.sampleState = 'ready'; S.caps.sampleNoteKey = ''; }
  else if (!S.caps.claude && ST.apiKey.get()) { provider = apiProvider(ST.apiKey.get()); S.caps.sampleState = 'ready'; S.caps.sampleNoteKey = ''; }
  else if (!S.caps.claude) { provider = null; S.caps.sampleState = 'unavailable'; S.caps.sampleNoteKey = 'caps.needKey'; }
  FT.scheduleRender();
}

/* ---------- Image preparation ---------- */
const up = { state: 'idle', src: null, params: null, canvas: null, previewUrl: null, ctl: null, timer: null, started: 0, phase: 'reading', cropMode: false };
const defaultParams = () => ({ rot: 0, angle: 0, contrast: 1, enhance: false, crop: null });
function subCanvas(src, sx, sy, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
function rotate90(src, times) {
  let c = src;
  for (let i = 0; i < (times % 4 + 4) % 4; i++) {
    const n = document.createElement('canvas'); n.width = c.height; n.height = c.width;
    const ctx = n.getContext('2d'); ctx.translate(n.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(c, 0, 0); c = n;
  }
  return c;
}
/* rotate 90° steps → fine angle → crop → contrast / enhance */
function process() {
  const p = up.params; if (!up.src) return;
  let c = rotate90(up.src, p.rot);
  if (p.angle) {
    const n = document.createElement('canvas'); n.width = c.width; n.height = c.height;
    const ctx = n.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n.width, n.height);
    ctx.translate(n.width / 2, n.height / 2); ctx.rotate(p.angle * Math.PI / 180); ctx.drawImage(c, -c.width / 2, -c.height / 2); c = n;
  }
  if (p.crop) { const r = p.crop; c = subCanvas(c, r.x * c.width, r.y * c.height, Math.max(1, r.w * c.width), Math.max(1, r.h * c.height), 4000); }
  if (p.contrast !== 1 || p.enhance) {
    const n = document.createElement('canvas'); n.width = c.width; n.height = c.height;
    const ctx = n.getContext('2d');
    ctx.filter = `contrast(${p.contrast})${p.enhance ? ' grayscale(1) brightness(1.06)' : ''}`;
    ctx.drawImage(c, 0, 0); c = n;
  }
  up.canvas = c;
  drawPreview();
}
function drawPreview() {
  const pv = $('#upCanvas'); if (!pv || !up.canvas) return;
  const box = pv.parentElement, maxW = Math.max(200, box.clientWidth - 2), maxH = 320;
  const k = Math.min(maxW / up.canvas.width, maxH / up.canvas.height, 1);
  pv.width = Math.round(up.canvas.width * k); pv.height = Math.round(up.canvas.height * k);
  pv.getContext('2d').drawImage(up.canvas, 0, 0, pv.width, pv.height);
}
function setUp(state) {
  up.state = state;
  $('#upIdle').hidden = state !== 'idle';
  $('#upPreview').hidden = state === 'idle';
  $('#upStatus').hidden = state !== 'running';
  const busy = state === 'running';
  $$('#upPreview button, #upPreview input, #upPreview select').forEach(el => { el.disabled = busy; });
  $('#upGo').disabled = busy || S.caps.sampleState !== 'ready';
  $('#upGo').textContent = S.caps.sampleState === 'pending' ? t('up.connecting') : t('up.go');
  if (busy) $('#upStatusText').textContent = t(up.phase === 'collecting' ? 'up.collecting' : 'up.readingPhoto');
  if (state === 'edit') drawPreview();
}
function renderUploadState() {
  const blocked = S.readOnly || S.caps.sampleState === 'unavailable';
  const note = $('#upNote');
  note.hidden = !blocked;
  note.innerHTML = S.readOnly ? esc(t('up.noteReadOnly')) : S.caps.sampleNoteKey ? esc(t(S.caps.sampleNoteKey)) + (S.caps.sampleNoteKey === 'caps.needKey' ? ` <button type="button" class="link" data-open="settings">${esc(t('settings.open'))}</button>` : '') : '';
  $('#upTips').hidden = blocked;
  $('#upPrivacy').textContent = provider ? t(provider.kind === 'api' ? 'up.privacyApi' : 'up.privacyClaude') : t('up.privacyNone');
  if (blocked) { $('#upIdle').hidden = true; $('#upPreview').hidden = true; $('#upStatus').hidden = true; }
  else setUp(up.state);
}
function showUpError(msg) { const e = $('#upError'); e.textContent = msg; e.hidden = !msg; }
function pickFile() { if (S.readOnly || S.caps.sampleState === 'unavailable' || up.state === 'running') return; $('#fileInput').click(); }
async function handleFile(file) {
  showUpError('');
  if (!file || up.state === 'running') return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { showUpError(t('up.errType')); return; }
  if (file.size > 20 * 1024 * 1024) { showUpError(t('up.errSize')); return; }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    up.src = subCanvas(img, 0, 0, img.naturalWidth, img.naturalHeight, 3600);
    up.params = defaultParams(); syncControls(); setUp('edit'); process();
    if (M.isNarrow()) $('#uploadSection').scrollIntoView({ block: 'start', behavior: M.reduceMotion() ? 'auto' : 'smooth' });
  } catch (e) { showUpError(t('up.errOpen')); }
  finally { URL.revokeObjectURL(url); }
}
function syncControls() {
  const p = up.params || defaultParams();
  $('#upAngle').value = p.angle; $('#upAngleVal').textContent = p.angle + '°';
  $('#upContrast').value = p.contrast; $('#upContrastVal').textContent = Math.round(p.contrast * 100) + '%';
  $('#upEnhance').checked = p.enhance;
  $('#upCropReset').hidden = !p.crop;
  $('#upCrop').setAttribute('aria-pressed', String(up.cropMode));
  $('#upPreview').classList.toggle('cropping', up.cropMode);
}
function resetUpload() {
  if (up.previewUrl) URL.revokeObjectURL(up.previewUrl);
  up.previewUrl = null; up.canvas = null; up.src = null; up.params = null; up.cropMode = false; showUpError(''); setUp('idle');
}
/* Crop by dragging on the preview. */
let cropDrag = null;
function bindCrop() {
  const box = $('#upCanvasBox'), rect = $('#upCropBox');
  const pos = e => { const r = box.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  box.addEventListener('pointerdown', e => { if (!up.cropMode || up.state !== 'edit') return; e.preventDefault(); box.setPointerCapture(e.pointerId); cropDrag = { a: pos(e), b: pos(e) }; rect.hidden = false; drawCrop(); });
  box.addEventListener('pointermove', e => { if (!cropDrag) return; cropDrag.b = pos(e); drawCrop(); });
  box.addEventListener('pointerup', () => {
    if (!cropDrag) return;
    const { a, b } = cropDrag; cropDrag = null; rect.hidden = true;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    if (w < 0.03 || h < 0.03) return;
    const old = up.params.crop || { x: 0, y: 0, w: 1, h: 1 };
    up.params.crop = { x: old.x + x * old.w, y: old.y + y * old.h, w: w * old.w, h: h * old.h };
    up.cropMode = false; syncControls(); process();
  });
  function drawCrop() { const { a, b } = cropDrag; rect.style.left = Math.min(a.x, b.x) * 100 + '%'; rect.style.top = Math.min(a.y, b.y) * 100 + '%'; rect.style.width = Math.abs(a.x - b.x) * 100 + '%'; rect.style.height = Math.abs(a.y - b.y) * 100 + '%'; }
}

/* ---------- Request ---------- */
async function buildImages(src, maxCount) {
  const w = src.width, h = src.height, big = Math.max(w, h) >= 1400;
  const imgs = [await ST.canvasToBlob(subCanvas(src, 0, 0, w, h, 2000))];
  if (big && maxCount >= 5) {
    const f = 0.58;
    for (const [fx, fy] of [[0, 0], [1 - f, 0], [0, 1 - f], [1 - f, 1 - f]]) imgs.push(await ST.canvasToBlob(subCanvas(src, fx * w, fy * h, f * w, f * h, 2000)));
    return { imgs, desc: 'You get 5 images of the same sheet. Image 1 is the whole chart: use it for the structure (who is connected to whom) and for all "box" coordinates. Images 2–5 are enlarged, overlapping quarters of the same sheet (top-left, top-right, bottom-left, bottom-right): use them to read small handwriting. A person may appear in several images — list each person only once.' };
  }
  if (big && maxCount >= 3) {
    const f = 0.58, wide = w >= h;
    for (const o of [0, 1 - f]) imgs.push(await ST.canvasToBlob(wide ? subCanvas(src, o * w, 0, f * w, h, 2000) : subCanvas(src, 0, o * h, w, f * h, 2000)));
    return { imgs, desc: `You get 3 images of the same sheet. Image 1 is the whole chart: use it for the structure and for all "box" coordinates. Images 2–3 are enlarged, overlapping ${wide ? 'left and right' : 'top and bottom'} halves: use them to read small handwriting. A person may appear in several images — list each person only once.` };
  }
  return { imgs, desc: 'You get one image: the whole chart.' };
}
function treeForPrompt() {
  const P = [...S.persons.values()];
  if (!P.length) return 'The tree is empty: there are no saved people yet.';
  const ppl = P.slice(0, 600).map(p => { const o = { id: p.id, name: M.rawFullName(p) }; if (p.birthDate) o.born = p.birthDate; if (p.deathDate) o.died = p.deathDate; if (p.birthCity) o.place = p.birthCity; return o; });
  const rels = [...S.relations.values()].slice(0, 1200).map(r => [r.type, r.from, r.to]);
  return JSON.stringify({ people: ppl, relations: rels });
}
function outputSpec(noteLang) {
  return `OUTPUT
Reply with only one JSON object, no other text:
{
  "kind": "tree",
  "kindNote": "",
  "people": [
    {"ref": "n1", "matchId": null, "lastName": "", "firstName": "", "patronymic": "", "maidenName": "", "nickname": "", "gender": "m",
     "birthDate": "", "deathDate": "", "birthCity": "", "occupation": "", "notes": "",
     "rawText": "the exact text written for this person on the photo", "box": [0.12, 0.08, 0.2, 0.06],
     "confidence": {"firstName": "high", "lastName": "medium", "birthDate": "low"}, "uncertain": ""}
  ],
  "relations": [
    {"type": "parent", "from": "n1", "to": "n3", "confidence": "high", "adopted": false},
    {"type": "spouse", "from": "n1", "to": "n2", "confidence": "medium", "status": "married"}
  ],
  "warnings": ["short remarks in ${noteLang} about unreadable or ambiguous parts of the photo"]
}
- "kind": "tree" for a genealogy chart; "portrait" if the image is a photograph of a person or people (not a chart); "other" if it is neither. For "portrait"/"other" leave "people" empty and explain in "kindNote" (in ${noteLang}).
- Every person written on the chart gets exactly one entry with a unique ref (n1, n2, …), even when matched to an existing person.
- "box": position of the person's label on IMAGE 1 as fractions of its width and height: [left, top, width, height], each 0–1. Give your best estimate even when unsure.
- "confidence": one of "high", "medium", "low" for each filled field. Mark "low" when the handwriting is hard to read or the value is a guess; omit fields you did not fill.
- "gender": "m", "f" or "" — infer from the first name / patronymic ending when clear.
- "status" on spouse relations: "married", "divorced" (crossed-out line, "разв.", "бывш.") or "partner"; "" when unknown. "adopted": true only when the chart says so ("приёмный", "усынов.").
- Relations reference refs only. Use "" for unknown fields.`;
}
function rules(noteLang) {
  return `READING RULES
- Keep names in the original script and spelling as written on the paper. Never transliterate or translate names.
- Split each name into lastName (фамилия), firstName (имя), patronymic (отчество). The order may be "Фамилия Имя Отчество" or "Имя Отчество Фамилия"; recognise patronymics by endings -ович, -евич, -ич, -овна, -евна, -ична, -инична.
- If only initials are written (e.g. "Иванов И.П."), keep them as written: firstName "И.", patronymic "П.".
- Maiden name ("урожд. Петрова", "дев. Петрова", "Иванова (Петрова)") → lastName is the married name, maidenName the other one.
- Nicknames / diminutives in quotes or brackets ("Шура", "баба Нюра") → nickname.
- Dates → "YYYY", "YYYY-MM" or "YYYY-MM-DD". "1932–2001" = born 1932, died 2001. "р. 1950", "род. 1950", "*1950" = born. "ум.", "†", "+", "погиб", "умер" = death. A cross without a year → add "Died, year unknown" (in ${noteLang}) to notes. Approximate or doubtful dates ("около 1920", "1920-е", "1920?") → leave the date empty and put the text into notes, confidence "low".
- Crossed-out text: ignore the crossed-out value and use the correction written next to it; mention it in "uncertain".
- birthCity: a place written as the birthplace (город, деревня, село), without prefixes like "г.", "д.", "с.".
- occupation: profession or role if written.
- notes: ONLY information that fits no other field (war service, "пропал без вести", a remark, an approximate date as written). One short line in ${noteLang}, no repetition of the name, dates or places already in their fields, no commentary about legibility (that goes to "uncertain"). Leave "" when there is nothing extra.
- If something is hard to read, give your best reading, set confidence "low", and say in "uncertain" (in ${noteLang}) what exactly is doubtful.

RELATIONSHIP RULES
- "parent": from = parent, to = child. "spouse": partners (married or not); order does not matter.
- Spouses are usually joined by a horizontal line, "+", "=", "∞", "⚭", "муж"/"жена", or a shared box or bracket. Children usually hang from a line that goes down from the couple or from one parent; words like "сын", "дочь", "дети" confirm it.
- A child of a couple gets TWO parent relations, one from each partner.
- Trees can grow downward (ancestors on top, most common), upward or sideways. Decide the direction from dates and context. Arrows may also be used.
- Only include relationships the drawing shows. Siblings are expressed only through shared parents. Do not invent people.`;
}
function buildPrompt(desc) {
  const noteLang = window.i18n.lang === 'ru' ? 'Russian' : 'English';
  return `You are an expert at reading hand-drawn family trees (genealogy charts) photographed on paper, often drawn by elderly relatives: messy cursive, crossed-out words, arrows, abbreviations, mixed Cyrillic (Russian, sometimes Ukrainian or Belarusian).

${desc}

TASK: first decide what the image is. If it is a genealogy chart, extract every person written on it and every relationship the drawing shows.

${rules(noteLang)}

EXISTING TREE
These people are already saved. If a person on the photo is clearly the same as an existing person (same name, compatible patronymic, dates and family position), set "matchId" to the existing id. Namesakes in different generations are different people; when unsure, use null.
${treeForPrompt()}

${outputSpec(noteLang)}`;
}
function buildRegionPrompt(hint, draft) {
  const noteLang = window.i18n.lang === 'ru' ? 'Russian' : 'English';
  return `You are an expert at reading hand-drawn family trees photographed on paper (messy Cyrillic handwriting).

You get ONE image: an enlarged part (crop) of a chart that was already recognised once. Re-read ONLY this part carefully.

USER HINT (trust it over your own reading when they conflict): ${hint || '(none)'}

CURRENT DRAFT for this part — people recognised earlier inside this region, with their refs:
${JSON.stringify(draft)}
- If a person in the crop is one of these draft people, reuse the SAME ref and return the corrected fields (full entry).
- If you find a person not in the draft, add a new entry with a new ref starting with "r" (r1, r2, …).
- Return relationships visible in this crop between any of these refs.

${rules(noteLang)}

${outputSpec(noteLang).replace('position of the person\'s label on IMAGE 1', 'position of the person\'s label on THIS crop')}`;
}

function normConf(v) { v = String(v || '').toLowerCase(); return CONF.includes(v) ? v : 'high'; }
function normBox(b) {
  if (!Array.isArray(b) || b.length < 4) return null;
  const n = b.map(Number); if (n.some(x => !isFinite(x))) return null;
  const x = Math.min(1, Math.max(0, n[0])), y = Math.min(1, Math.max(0, n[1]));
  return { x, y, w: Math.min(1 - x, Math.max(0.01, n[2])), h: Math.min(1 - y, Math.max(0.01, n[3])) };
}
function normalizeResult(raw, { refPrefix = 'n' } = {}) {
  const out = { kind: 'tree', kindNote: '', people: [], relations: [], warnings: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.kind = ['tree', 'portrait', 'other'].includes(raw.kind) ? raw.kind : 'tree';
  out.kindNote = String(raw.kindNote || '').trim();
  const refs = new Set();
  (Array.isArray(raw.people) ? raw.people : []).forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    let ref = String(r.ref || refPrefix + (i + 1)); if (refs.has(ref)) ref += '_' + i; refs.add(ref);
    const fields = {}, conf = {}, extraNotes = [];
    const rconf = r.confidence && typeof r.confidence === 'object' ? r.confidence : {};
    for (const key of OCR_KEYS) {
      let v = r[key] == null ? '' : String(r[key]).trim();
      if (key === 'gender') v = ['m', 'f'].includes(v.toLowerCase()) ? v.toLowerCase() : '';
      const f = FIELDS.find(x => x.key === key);
      if (f && f.type === 'date' && v) { const pd = parseDate(v); if (pd.ok) v = pd.value; else { extraNotes.push(t('rv.onPhoto', { field: fieldLabel(f), value: v })); v = ''; } }
      fields[key] = v;
      if (v) conf[key] = normConf(rconf[key] ?? (typeof r.confidence === 'number' ? (r.confidence < 0.6 ? 'low' : r.confidence < 0.85 ? 'medium' : 'high') : 'high'));
    }
    fields.source = '';
    if (extraNotes.length) { fields.notes = [fields.notes, ...extraNotes].filter(Boolean).join('\n'); conf.notes = conf.notes || 'medium'; }
    if (!fields.firstName && !fields.lastName && !fields.patronymic && !fields.nickname) return;
    const matchId = r.matchId && S.persons.has(String(r.matchId)) ? String(r.matchId) : null;
    out.people.push({ ref, matchId, fields, conf, raw: String(r.rawText || ''), uncertain: String(r.uncertain || ''), box: normBox(r.box) });
  });
  const okRefs = new Set(out.people.map(p => p.ref)), keys = new Set();
  (Array.isArray(raw.relations) ? raw.relations : []).forEach(r => {
    if (!r || (r.type !== 'parent' && r.type !== 'spouse')) return;
    const from = String(r.from ?? ''), to = String(r.to ?? '');
    if (!okRefs.has(from) || !okRefs.has(to) || from === to) return;
    const key = r.type === 'spouse' ? 'S' + [from, to].sort().join('|') : 'P' + from + '|' + to;
    if (keys.has(key)) return; keys.add(key);
    out.relations.push({ id: 'r' + out.relations.length + '_' + Math.random().toString(36).slice(2, 6), type: r.type, from, to, confidence: normConf(r.confidence), status: ['married', 'divorced', 'partner'].includes(r.status) ? r.status : '', adopted: !!r.adopted });
  });
  out.warnings = (Array.isArray(raw.warnings) ? raw.warnings : []).map(w => String(w).trim()).filter(Boolean).slice(0, 10);
  return out;
}
function errorKey(e) {
  switch (e && e.code) {
    case 'no_people': case 'not_granted': case 'images_unavailable': case 'rate_limited': case 'session_expired':
    case 'image_rejected': case 'refused': case 'prompt_too_large': case 'bad_key': case 'network': return 'err.' + e.code;
    case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed': return 'err.unavailable';
    case 'invalid_json': case 'empty_completion': return 'err.invalid_json';
    default: return 'err.default';
  }
}
function errorText(e) { const k = errorKey(e); return t(k) + (e && e.detail && k === 'err.default' ? ` (${e.detail})` : ''); }
function tick() { const s = Math.floor((Date.now() - up.started) / 1000); $('#upTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
async function recognize() {
  if (S.caps.sampleState !== 'ready' || !provider || !up.canvas || up.state === 'running' || S.readOnly) return;
  showUpError('');
  up.ctl = new AbortController();
  up.phase = 'reading'; setUp('running');
  up.started = Date.now(); tick(); up.timer = setInterval(tick, 1000);
  try {
    const { imgs, desc } = await buildImages(up.canvas, provider.maxImages);
    const raw = await provider.json(buildPrompt(desc), imgs, {
      tier: $('#quality').value, signal: up.ctl.signal,
      onText: () => { if (up.phase !== 'collecting') { up.phase = 'collecting'; $('#upStatusText').textContent = t('up.collecting'); } },
    });
    const res = normalizeResult(raw);
    if (raw && raw._truncated) res.warnings.unshift(t('rv.truncated'));
    else if (raw && raw._repaired) res.warnings.unshift(t('rv.repaired'));
    setUp('edit');
    if (res.kind === 'portrait' || (res.kind === 'other' && !res.people.length)) { offerPortrait(res); return; }
    if (!res.people.length) throw { code: 'no_people' };
    openReview(res);
  } catch (e) {
    setUp('edit');
    if (e && e.code === 'cancelled') return;
    if (e && FATAL.includes(e.code)) { S.caps.sampleState = 'unavailable'; S.caps.sampleNoteKey = errorKey(e); FT.scheduleRender(); }
    else if (e && e.code === 'invalid_json' && e.raw) showRawResponse(e.raw);
    else showUpError(errorText(e));
  } finally { clearInterval(up.timer); up.ctl = null; }
}
/* The model answered, but the answer is not usable JSON: show it instead of hiding it. */
function showRawResponse(raw) {
  showUpError(t('err.invalid_json'));
  const d = UI.openTool({ title: t('raw.title'), html: `<p class="lead">${esc(t('raw.lead'))}</p><pre class="raw">${esc(String(raw).slice(0, 20000))}</pre>`, wide: true,
    foot: `<span class="spacer"></span><button type="button" class="btn" data-raw="close">${esc(t('pd.cancel'))}</button><button type="button" class="btn primary" data-raw="retry">${esc(t('raw.retry'))}</button>` });
  d.onclick = e => { const b = e.target.closest('[data-raw]'); if (!b) return; UI.closeTool(); if (b.dataset.raw === 'retry') recognize(); };
}
/* The upload looks like a portrait: offer to attach it to a person instead. */
function offerPortrait(res) {
  const ppl = M.sortPeople([...S.persons.values()]);
  const html = `<p class="lead">${esc(t(res.kind === 'portrait' ? 'portrait.lead' : 'portrait.leadOther'))}</p>${res.kindNote ? `<p class="muted">${esc(res.kindNote)}</p>` : ''}
    <div class="portrait-preview"><img src="${up.canvas.toDataURL('image/jpeg', 0.7)}" alt=""></div>
    ${ppl.length ? `<div class="field"><label for="ptPerson">${esc(t('portrait.attachTo'))}</label><select id="ptPerson">${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === S.selectedId ? 'selected' : ''}>${esc(labelWithYear(p))}</option>`).join('')}</select></div>` : `<p class="muted">${esc(t('portrait.noPeople'))}</p>`}`;
  const d = UI.openTool({ title: t('portrait.title'), html, foot: `<button type="button" class="btn ghost" data-pt="tree">${esc(t('portrait.recogniseAnyway'))}</button><span class="spacer"></span><button type="button" class="btn" data-pt="cancel">${esc(t('pd.cancel'))}</button>${ppl.length ? `<button type="button" class="btn primary" data-pt="attach">${esc(t('portrait.attach'))}</button>` : ''}` });
  d.onclick = async e => {
    const b = e.target.closest('[data-pt]'); if (!b) return;
    if (b.dataset.pt === 'cancel') return UI.closeTool();
    if (b.dataset.pt === 'tree') { UI.closeTool(); if (res.people.length) openReview(res); else showUpError(t('err.no_people')); return; }
    const id = $('#ptPerson', d).value; UI.closeTool();
    const { dataUrl, w, h } = await ST.compressImage(up.canvas, 1600, 0.85);
    if (await UI.attachDataUrl(id, dataUrl, w, h)) { resetUpload(); UI.select(id, { center: true, scrollPanel: true }); }
  };
}

/* ---------- Review (verification loop) ---------- */
let RV = null;
function findNameMatch(f) {
  if (!f.firstName || !(f.lastName || f.birthDate)) return null;
  const c = [...S.persons.values()].filter(p => norm(p.firstName) === norm(f.firstName) && norm(p.lastName) === norm(f.lastName)
    && (!p.patronymic || !f.patronymic || norm(p.patronymic) === norm(f.patronymic))
    && (!p.birthDate || !f.birthDate || yearOf(p.birthDate) === yearOf(f.birthDate)));
  return c.length === 1 ? c[0].id : null;
}
function initUpdate(rp) {
  rp.upd = {}; rp.updFor = rp.matchId;
  const ex = S.persons.get(rp.matchId); if (!ex) return;
  for (const f of FIELDS) {
    const nv = String(rp.fields[f.key] || '').trim(), ov = String(ex[f.key] || '').trim();
    if (!nv) continue;
    if (f.type === 'date') {
      const pd = parseDate(nv); if ((pd.ok ? pd.value : nv) === ov) continue;
      rp.upd[f.key] = { key: f.key, type: f.type, old: fmtDate(ov), value: pd.ok ? fmtDate(pd.value) : nv, take: !ov, kind: ov ? 'replace' : 'fill' };
    } else if (f.key === 'notes') {
      if (ov && norm(ov).includes(norm(nv))) continue;
      rp.upd[f.key] = { key: f.key, type: f.type, old: ov, value: ov ? ov + '\n' + nv : nv, take: true, kind: ov ? 'append' : 'fill' };
    } else {
      if (norm(nv) === norm(ov)) continue;
      rp.upd[f.key] = { key: f.key, type: f.type, old: ov, value: nv, take: !ov, kind: ov ? 'replace' : 'fill' };
    }
  }
}
function makeRp(r, i) {
  const fields = {};
  for (const f of FIELDS) fields[f.key] = f.type === 'date' ? fmtDate(r.fields[f.key]) : (r.fields[f.key] || '');
  return { key: 'p' + i + '_' + Math.random().toString(36).slice(2, 6), ref: r.ref, tempId: 'new:' + r.ref, action: 'new', matchId: null, autoMatched: false, fields, conf: { ...r.conf }, confirmed: new Set(), raw: r.raw, uncertain: r.uncertain, box: r.box, upd: {}, updFor: null };
}
function openReview(res) {
  const used = new Set();
  const ppl = res.people.map((r, i) => {
    const rp = makeRp(r, i);
    let matchId = r.matchId, auto = false;
    if (!matchId) { const m = findNameMatch(r.fields); if (m) { matchId = m; auto = true; } }
    if (matchId && used.has(matchId)) { matchId = null; auto = false; }
    if (matchId) { used.add(matchId); rp.action = 'match'; rp.matchId = matchId; rp.autoMatched = auto; initUpdate(rp); }
    return rp;
  });
  RV = { people: ppl, relations: res.relations.map(r => ({ ...r, accepted: true })), warnings: res.warnings, canvas: up.canvas, imageUrl: up.canvas.toDataURL('image/jpeg', 0.85), wasEmpty: S.persons.size === 0, region: null, selecting: false, asking: false, hover: null };
  $('#review').hidden = false; $('#app').inert = true;
  renderReview();
  $('#reviewTitle').focus();
}
function closeReview() { $('#review').hidden = true; $('#review').innerHTML = ''; $('#app').inert = false; RV = null; }
const byRef = ref => RV.people.find(p => p.ref === ref);
function rvResolve(ref) {
  const rp = byRef(ref);
  if (!rp || rp.action === 'skip') return null;
  if (rp.action === 'match') { const ex = S.persons.get(rp.matchId); return ex ? { id: ex.id, existing: true, label: shortName(ex) } : null; }
  return { id: rp.tempId, existing: false, label: shortName(rp.fields) };
}
function refLabel(ref) { const rp = byRef(ref); if (!rp) return '?'; const ex = rp.action === 'match' && S.persons.get(rp.matchId); return shortName(ex || rp.fields); }
function rvParentEdges(except) {
  const edges = [];
  for (const r of S.relations.values()) if (r.type === 'parent') edges.push([r.from, r.to]);
  for (const rel of RV.relations) {
    if (rel === except || !rel.accepted || rel.type !== 'parent') continue;
    const a = rvResolve(rel.from), b = rvResolve(rel.to);
    if (a && b && a.id !== b.id) edges.push([a.id, b.id]);
  }
  return edges;
}
function rvRelStatus(rel) {
  const a = rvResolve(rel.from), b = rvResolve(rel.to);
  if (!a || !b) return { state: 'skipped', msg: t('rv.relSkipped') };
  if (a.id === b.id) return { state: 'invalid', msg: t('rv.relSame') };
  if (a.existing && b.existing && S.relations.has(relId(rel.type, a.id, b.id))) return { state: 'exists' };
  if (rel.type === 'parent') {
    const edges = rvParentEdges(rel), kids = new Map();
    for (const [p, c] of edges) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(c); }
    const seen = new Set(), st = [b.id];
    while (st.length) { const x = st.pop(); if (x === a.id) return { state: 'invalid', msg: t('rv.relCycle') }; if (seen.has(x)) continue; seen.add(x); st.push(...(kids.get(x) || [])); }
    const ps = new Set(edges.filter(([, c]) => c === b.id).map(([p]) => p)); ps.add(a.id);
    if (ps.size > 2) return { state: 'warn', msg: t('rv.relManyParents', { name: b.label, parents: M.count ? M.count(ps.size, 'count.parents') : window.i18n.count(ps.size, 'count.parents') }) };
  }
  return { state: 'ok' };
}
/* Low-confidence fields that still need an explicit confirmation before applying. */
function pendingFields(rp) {
  if (rp.action === 'skip') return [];
  if (rp.action === 'new') return Object.keys(rp.conf).filter(k => rp.conf[k] === 'low' && rp.fields[k] && !rp.confirmed.has(k));
  return Object.entries(rp.upd).filter(([k, u]) => u.take && rp.conf[k] === 'low' && !rp.confirmed.has(k)).map(([k]) => k);
}
function rvCounts() {
  let add = 0, upd = 0, rel = 0, pending = 0;
  for (const rp of RV.people) { if (rp.action === 'new') add++; else if (rp.action === 'match' && Object.values(rp.upd).some(u => u.take)) upd++; pending += pendingFields(rp).length; }
  for (const r of RV.relations) { if (!r.accepted) continue; const st = rvRelStatus(r).state; if (st === 'ok' || st === 'warn') rel++; }
  return { add, upd, rel, pending, total: add + upd + rel };
}
function updateRvSummary() {
  if (!RV) return;
  const c = rvCounts();
  $('#rvSummary').textContent = c.total ? t('rv.summary', { add: M.people(c.add), upd: M.people(c.upd), rel: c.rel }) + (c.pending ? ' ' + t('rv.pending', { n: c.pending }) : '') : t('rv.nothing');
  $('#rvApply').disabled = !c.total || c.pending > 0;
  $('#rvApply').title = c.pending ? t('rv.pendingHint') : '';
}
const confPill = (rp, k) => { const c = rp.conf[k]; if (!c || c === 'high') return ''; const ok = rp.confirmed.has(k); return `<span class="conf ${c}${ok ? ' ok' : ''}" title="${esc(t('rv.conf.' + c))}">${esc(ok ? t('rv.confirmed') : t('rv.conf.' + c))}</span>`; };
function rvFieldHtml(rp, f) {
  const id = `rv_${rp.key}_${f.key}`, v = esc(rp.fields[f.key] || ''), c = rp.conf[f.key] || 'high', low = c === 'low' && !!rp.fields[f.key] && !rp.confirmed.has(f.key);
  const label = `<label for="${id}">${esc(fieldLabel(f))}${f.required ? ' <span class="req" aria-hidden="true">*</span>' : ''} ${confPill(rp, f.key)}</label>`;
  let ctrl;
  if (f.type === 'textarea') ctrl = `<textarea id="${id}" rows="2" data-f="${f.key}" class="c-${c}">${v}</textarea>`;
  else if (f.type === 'select') ctrl = `<select id="${id}" data-f="${f.key}" class="c-${c}">${f.options.map(o => `<option value="${o}" ${o === (rp.fields[f.key] || '') ? 'selected' : ''}>${esc(M.genderLabel(o))}</option>`).join('')}</select>`;
  else ctrl = `<input id="${id}" type="text" value="${v}" autocomplete="off" data-f="${f.key}" class="c-${c}" ${f.type === 'date' ? `placeholder="${esc(t('field.datePlaceholder'))}"` : ''}>`;
  return `<div class="field span-${f.span || 6}${low ? ' needs-confirm' : ''}">${label}<div class="ctrl-row">${ctrl}${low ? `<button type="button" class="btn sm confirm" data-confirm="${f.key}" title="${esc(t('rv.confirmHint'))}">✓</button>` : ''}</div><p class="field-error" hidden></p></div>`;
}
function rvPersonHtml(rp, exOpts) {
  const pill = rp.action === 'new' ? `<span class="pill new">${esc(t('rv.pillNew'))}</span>` : rp.action === 'match' ? `<span class="pill upd">${esc(t('rv.pillMatch'))}</span>` : `<span class="pill skip">${esc(t('rv.pillSkip'))}</span>`;
  const sel = rp.action === 'match' ? 'match:' + rp.matchId : rp.action;
  const others = RV.people.filter(o => o !== rp && o.action !== 'skip');
  const options = `<option value="new" ${sel === 'new' ? 'selected' : ''}>${esc(t('rv.optNew'))}</option>`
    + (exOpts.length ? `<optgroup label="${esc(t('rv.optGroup'))}">${exOpts.map(o => `<option value="match:${esc(o.id)}" ${sel === 'match:' + o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup>` : '')
    + (others.length ? `<optgroup label="${esc(t('rv.optMergeGroup'))}">${others.map(o => `<option value="merge:${esc(o.ref)}">${esc(t('rv.optMerge', { name: shortName(o.action === 'match' ? S.persons.get(o.matchId) || o.fields : o.fields) }))}</option>`).join('')}</optgroup>` : '')
    + `<option value="skip" ${sel === 'skip' ? 'selected' : ''}>${esc(t('rv.optSkip'))}</option>`;
  const visible = FIELDS.filter(f => f.key !== 'source');
  let body = '';
  if (rp.action === 'new') body = `<div class="form-grid">${visible.map(f => rvFieldHtml(rp, f)).join('')}</div>`;
  else if (rp.action === 'match') {
    const entries = Object.entries(rp.upd);
    body = !entries.length
      ? `<p class="muted">${esc(t('rv.sameData'))}</p>`
      : `<div class="table-wrap"><table class="rv-diff"><thead><tr><th>${esc(t('rv.thField'))}</th><th>${esc(t('rv.thCurrent'))}</th><th>${esc(t('rv.thPhoto'))}</th><th>${esc(t('rv.thAccept'))}</th></tr></thead><tbody>${entries.map(([k, u]) => {
        const c = rp.conf[k] || 'high', low = c === 'low' && u.take && !rp.confirmed.has(k);
        return `<tr class="${low ? 'needs-confirm' : ''}">
          <td>${esc(fieldLabel(u))} ${confPill(rp, k)}</td>
          <td class="old">${u.old ? esc(k === 'gender' ? M.genderLabel(u.old) : u.old) : `<span class="muted">${esc(t('rv.empty'))}</span>`}</td>
          <td><div class="field"><div class="ctrl-row">${u.type === 'textarea' ? `<textarea id="rvu_${rp.key}_${k}" data-u="${k}" rows="3" class="c-${c}">${esc(u.value)}</textarea>` : u.type === 'select' ? `<select id="rvu_${rp.key}_${k}" data-u="${k}" class="c-${c}">${FIELDS.find(f => f.key === k).options.map(o => `<option value="${o}" ${o === u.value ? 'selected' : ''}>${esc(M.genderLabel(o))}</option>`).join('')}</select>` : `<input type="text" id="rvu_${rp.key}_${k}" data-u="${k}" value="${esc(u.value)}" class="c-${c}">`}${low ? `<button type="button" class="btn sm confirm" data-confirm="${k}" title="${esc(t('rv.confirmHint'))}">✓</button>` : ''}</div><p class="field-error" hidden></p></div></td>
          <td><input type="checkbox" data-take="${k}" ${u.take ? 'checked' : ''} aria-label="${esc(t('rv.acceptChange', { field: fieldLabel(u) }))}"></td></tr>`;
      }).join('')}</tbody></table></div>
        ${entries.some(([, u]) => u.kind === 'replace') ? `<p class="hint">${esc(t('rv.replaceHint'))}</p>` : ''}`;
  }
  const lowCount = Object.values(rp.conf).filter(c => c === 'low').length;
  return `<article class="rv-person ${rp.action}${RV.hover === rp.ref ? ' hover' : ''}" data-key="${rp.key}" data-ref="${esc(rp.ref)}">
    <div class="rv-p-head">
      <div class="rv-p-title"><span class="rv-dot" aria-hidden="true">${rp.box ? '◉' : '○'}</span><strong>${esc(fullName(rp.fields))}</strong>${pill}${lowCount ? `<span class="pill warn">${esc(t('rv.lowFields', { n: lowCount }))}</span>` : ''}</div>
      <div class="row">
        <label class="sr-only" for="act_${rp.key}">${esc(t('rv.whatToDo'))}</label>
        <select id="act_${rp.key}" data-rvact>${options}</select>
        <button type="button" class="btn sm ghost" data-split title="${esc(t('rv.splitHint'))}">${esc(t('rv.split'))}</button>
      </div>
    </div>
    ${rp.raw ? `<p class="rv-raw">${esc(t('rv.raw', { text: rp.raw }))}</p>` : ''}
    ${rp.uncertain ? `<p class="rv-unc">${esc(t('rv.doubts', { text: rp.uncertain }))}</p>` : ''}
    ${rp.autoMatched && rp.action === 'match' ? `<p class="rv-unc">${esc(t('rv.autoMatched'))}</p>` : ''}
    ${body}
  </article>`;
}
function rvRelsHtml() {
  const refs = RV.people.filter(p => p.action !== 'skip');
  const refOptions = sel => refs.map(p => `<option value="${esc(p.ref)}" ${p.ref === sel ? 'selected' : ''}>${esc(refLabel(p.ref))}</option>`).join('');
  const addForm = refs.length >= 2 ? `<div class="rv-rel add"><select data-add-from>${refOptions(refs[0].ref)}</select><select data-add-type><option value="parent">${esc(t('rv.parentOf'))}</option><option value="spouse">${esc(t('rv.pairedWith'))}</option></select><select data-add-to>${refOptions(refs[1].ref)}</select><button type="button" class="btn sm" data-add-rel>${esc(t('rv.addRel'))}</button></div>` : '';
  if (!RV.relations.length) return `<p class="muted">${esc(t('rv.noRels'))}</p>${addForm}`;
  let rows = '', exists = 0;
  for (const rel of RV.relations) {
    const st = rvRelStatus(rel);
    if (st.state === 'exists') { exists++; continue; }
    const a = rvResolve(rel.from), b = rvResolve(rel.to);
    const blocked = st.state === 'skipped' || st.state === 'invalid';
    const on = rel.accepted && !blocked;
    rows += `<div class="rv-rel ${st.state}${on ? '' : ' off'}" data-rel="${rel.id}">
      <input type="checkbox" data-relcheck ${on ? 'checked' : ''} ${blocked ? 'disabled' : ''} aria-label="${esc(t('rv.addLink'))}">
      <span class="rv-rel-name${a ? '' : ' struck'}">${esc(refLabel(rel.from))}</span>
      <select data-reltype aria-label="${esc(t('rv.linkType'))}"><option value="parent" ${rel.type === 'parent' ? 'selected' : ''}>${esc(t('rv.parentOf'))}</option><option value="spouse" ${rel.type === 'spouse' ? 'selected' : ''}>${esc(t('rv.pairedWith'))}</option></select>
      <span class="rv-rel-name${b ? '' : ' struck'}">${esc(refLabel(rel.to))}</span>
      ${rel.type === 'parent' ? `<button type="button" class="btn sm ghost" data-relswap title="${esc(t('rv.swapTitle'))}">${esc(t('rv.swap'))}</button><label class="check small"><input type="checkbox" data-reladopted ${rel.adopted ? 'checked' : ''}> ${esc(t('rel.adopted'))}</label>` : `<select data-relstatus aria-label="${esc(t('rel.statusLabel'))}">${['', 'married', 'divorced', 'partner'].map(s => `<option value="${s}" ${rel.status === s ? 'selected' : ''}>${esc(t(s ? 'rel.status.' + s : 'rel.status.none'))}</option>`).join('')}</select>`}
      ${rel.confidence !== 'high' ? `<span class="conf ${rel.confidence}">${esc(t('rv.conf.' + rel.confidence))}</span>` : ''}
      <button type="button" class="chip-x" data-reldel aria-label="${esc(t('rv.removeRel'))}" title="${esc(t('rv.removeRel'))}">×</button>
      ${st.msg ? `<p class="rv-rel-msg">${esc(st.msg)}</p>` : ''}
    </div>`;
  }
  return rows + (exists ? `<p class="muted">${esc(t('rv.existLinks', { links: M.links(exists) }))}</p>` : '') + addForm;
}
function marksHtml() {
  return RV.people.filter(p => p.box).map(p => `<button type="button" class="rv-mark ${p.action}${RV.hover === p.ref ? ' hover' : ''}${Object.values(p.conf).includes('low') ? ' low' : ''}" data-mark="${esc(p.ref)}" style="left:${p.box.x * 100}%;top:${p.box.y * 100}%;width:${p.box.w * 100}%;height:${p.box.h * 100}%" title="${esc(fullName(p.fields))}"><span>${esc(p.ref)}</span></button>`).join('')
    + (RV.region ? `<div class="rv-region" style="left:${RV.region.x * 100}%;top:${RV.region.y * 100}%;width:${RV.region.w * 100}%;height:${RV.region.h * 100}%"></div>` : '');
}
function renderRvRels() { const box = $('#rvRelList'); if (box) box.innerHTML = rvRelsHtml(); updateRvSummary(); }
function renderMarks() { const box = $('#rvMarks'); if (box) box.innerHTML = marksHtml(); }
function renderReview() {
  if (!RV) return;
  const root = $('#review');
  const sc = root.querySelector('.rv-main'), keep = sc ? sc.scrollTop : 0, keepOuter = root.scrollTop;
  const exOpts = M.sortPeople([...S.persons.values()]).map(p => ({ id: p.id, label: labelWithYear(p) }));
  const nMatched = RV.people.filter(p => p.action === 'match').length;
  const sub = t('rv.sub', { people: M.people(RV.people.length), links: M.links(RV.relations.length), matched: RV.wasEmpty ? '' : t('rv.matched', { n: nMatched }) });
  root.innerHTML = `<div class="rv-shell">
    <header class="rv-head">
      <div class="min0"><h2 id="reviewTitle" tabindex="-1">${esc(RV.wasEmpty ? t('rv.titleNew') : t('rv.titleCheck'))}</h2>
      <p class="rv-sub">${esc(sub)}</p></div>
      <button type="button" class="btn" data-rv="close">${esc(t('rv.close'))}</button>
    </header>
    <div class="rv-body">
      <figure class="rv-photo">
        <div class="rv-photo-box${RV.selecting ? ' selecting' : ''}" id="rvPhotoBox"><div class="rv-photo-inner"><img src="${RV.imageUrl}" alt="${esc(t('rv.photoAlt'))}" draggable="false"><div class="rv-marks" id="rvMarks">${marksHtml()}</div><div class="rv-select" id="rvSelect" hidden></div></div></div>
        <figcaption>${esc(RV.selecting ? t('rv.selectHint') : t('rv.photoCap'))}</figcaption>
        <div class="rv-ask">
          <div class="row"><button type="button" class="btn sm ${RV.selecting ? 'primary' : ''}" data-rv="select" aria-pressed="${RV.selecting}">${esc(t('rv.selectRegion'))}</button><button type="button" class="btn sm ghost" data-rv="zoom">${esc(t('rv.zoom'))}</button></div>
          ${RV.region ? `<div class="field"><label for="rvHint">${esc(t('rv.hintLabel'))}</label><textarea id="rvHint" rows="2" placeholder="${esc(t('rv.hintPlaceholder'))}">${esc(RV.hint || '')}</textarea></div>
          <div class="row"><button type="button" class="btn primary sm" data-rv="ask" ${RV.asking ? 'disabled' : ''}>${esc(RV.asking ? t('rv.asking') : t('rv.ask'))}</button><button type="button" class="btn sm ghost" data-rv="clearRegion">${esc(t('rv.clearRegion'))}</button></div>
          <p class="hint">${esc(t('rv.askHint'))}</p>` : `<p class="hint">${esc(t('rv.askIntro'))}</p>`}
          <p class="up-error" id="rvAskError" hidden role="alert"></p>
        </div>
      </figure>
      <div class="rv-main">
        ${RV.warnings.length ? `<div class="rv-warn"><strong>${esc(t('rv.warnTitle'))}</strong><ul>${RV.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${RV.wasEmpty ? `<p class="rv-note">${esc(t('rv.emptyNote'))}</p>` : ''}
        <p class="rv-note">${esc(t('rv.confNote'))}</p>
        <section><h3>${esc(t('rv.people'))} <span class="muted">${RV.people.length}</span></h3>${RV.people.map(rp => rvPersonHtml(rp, exOpts)).join('')}</section>
        <section><h3>${esc(t('rv.links'))} <span class="muted">${RV.relations.length}</span></h3><div id="rvRelList" class="rv-rel-list">${rvRelsHtml()}</div></section>
      </div>
    </div>
    <footer class="rv-foot"><p id="rvSummary"></p><div class="row">
      <button type="button" class="btn ghost" data-rv="rejectAll">${esc(t('rv.rejectAll'))}</button>
      <button type="button" class="btn" data-rv="acceptAll">${esc(t('rv.acceptAll'))}</button>
      <button type="button" class="btn primary" data-rv="apply" id="rvApply">${esc(t('rv.apply'))}</button>
    </div></footer>
  </div>`;
  const sc2 = root.querySelector('.rv-main'); if (sc2) sc2.scrollTop = keep; root.scrollTop = keepOuter;
  updateRvSummary();
}
function rvAll(accept) {
  for (const rp of RV.people) {
    if (!accept) { rp.action = 'skip'; continue; }
    if (rp.action === 'skip') rp.action = rp.matchId && S.persons.has(rp.matchId) ? 'match' : 'new';
    if (rp.action === 'match') { if (rp.updFor !== rp.matchId) initUpdate(rp); for (const u of Object.values(rp.upd)) u.take = true; }
    if (accept) for (const k of Object.keys(rp.conf)) rp.confirmed.add(k);   // "accept all" also confirms uncertain fields
  }
  for (const r of RV.relations) r.accepted = accept;
  renderReview();
}
function mergeInto(rp, targetRef) {
  const target = byRef(targetRef); if (!target || target === rp) return;
  for (const f of FIELDS) if (!target.fields[f.key] && rp.fields[f.key]) { target.fields[f.key] = rp.fields[f.key]; target.conf[f.key] = rp.conf[f.key] || 'medium'; }
  if (rp.raw && !target.raw.includes(rp.raw)) target.raw = [target.raw, rp.raw].filter(Boolean).join(' | ');
  if (!target.box && rp.box) target.box = rp.box;
  for (const rel of RV.relations) { if (rel.from === rp.ref) rel.from = targetRef; if (rel.to === rp.ref) rel.to = targetRef; }
  const seen = new Set();
  RV.relations = RV.relations.filter(rel => { if (rel.from === rel.to) return false; const k = rel.type === 'spouse' ? 'S' + [rel.from, rel.to].sort().join('|') : 'P' + rel.from + '|' + rel.to; if (seen.has(k)) return false; seen.add(k); return true; });
  RV.people = RV.people.filter(p => p !== rp);
  if (target.action === 'match') initUpdate(target);
}
function splitPerson(rp) {
  const i = RV.people.indexOf(rp);
  const copy = makeRp({ ref: rp.ref + 'b', fields: Object.fromEntries(FIELDS.map(f => [f.key, f.type === 'date' ? (parseDate(rp.fields[f.key]).value || '') : rp.fields[f.key]])), conf: rp.conf, raw: rp.raw, uncertain: '', box: rp.box }, RV.people.length);
  copy.fields.firstName = ''; copy.conf = {};  // the copy is a blank sibling entry: same surname, to be filled by hand
  RV.people.splice(i + 1, 0, copy);
}
/* Re-run recognition for a selected region with a hint, merging results into the draft. */
async function askAgain() {
  if (!RV || !RV.region || RV.asking || !provider) return;
  const r = RV.region, c = RV.canvas;
  const pad = 0.04;
  const x0 = Math.max(0, r.x - pad), y0 = Math.max(0, r.y - pad), x1 = Math.min(1, r.x + r.w + pad), y1 = Math.min(1, r.y + r.h + pad);
  const crop = subCanvas(c, x0 * c.width, y0 * c.height, (x1 - x0) * c.width, (y1 - y0) * c.height, 2000);
  const inside = RV.people.filter(p => p.box && p.box.x + p.box.w / 2 >= x0 && p.box.x + p.box.w / 2 <= x1 && p.box.y + p.box.h / 2 >= y0 && p.box.y + p.box.h / 2 <= y1);
  const draft = inside.map(p => ({ ref: p.ref, ...Object.fromEntries(OCR_KEYS.map(k => [k, p.fields[k] || ''])) }));
  RV.hint = $('#rvHint')?.value || '';
  RV.asking = true; renderReview();
  const ctl = new AbortController(); RV.ctl = ctl;
  try {
    const blob = await ST.canvasToBlob(crop);
    const raw = await provider.json(buildRegionPrompt(RV.hint, draft), [blob], { tier: $('#quality').value, signal: ctl.signal });
    const res = normalizeResult(raw, { refPrefix: 'r' });
    let updated = 0, added = 0;
    const existingRefs = new Set(RV.people.map(p => p.ref));
    for (const r2 of res.people) {
      const box = r2.box ? { x: x0 + r2.box.x * (x1 - x0), y: y0 + r2.box.y * (y1 - y0), w: r2.box.w * (x1 - x0), h: r2.box.h * (y1 - y0) } : null;
      const target = byRef(r2.ref);
      if (target) {
        for (const k of OCR_KEYS) { const nv = r2.fields[k]; if (!nv) continue; const f = FIELDS.find(x => x.key === k); const shown = f.type === 'date' ? fmtDate(nv) : nv; if (target.fields[k] !== shown) { target.fields[k] = shown; target.conf[k] = r2.conf[k] || 'high'; target.confirmed.delete(k); } }
        if (r2.raw) target.raw = r2.raw; if (r2.uncertain) target.uncertain = r2.uncertain; if (box) target.box = box;
        if (target.action === 'match') initUpdate(target);
        updated++;
      } else {
        let ref = r2.ref; while (existingRefs.has(ref)) ref += 'x'; existingRefs.add(ref);
        const rp = makeRp({ ...r2, ref, box }, RV.people.length);
        for (const rel of res.relations) { if (rel.from === r2.ref) rel.from = ref; if (rel.to === r2.ref) rel.to = ref; }
        RV.people.push(rp); added++;
      }
    }
    const keys = new Set(RV.relations.map(rel => (rel.type === 'spouse' ? 'S' + [rel.from, rel.to].sort().join('|') : 'P' + rel.from + '|' + rel.to)));
    for (const rel of res.relations) { if (!byRef(rel.from) || !byRef(rel.to)) continue; const k = rel.type === 'spouse' ? 'S' + [rel.from, rel.to].sort().join('|') : 'P' + rel.from + '|' + rel.to; if (keys.has(k)) continue; keys.add(k); RV.relations.push({ ...rel, accepted: true }); }
    for (const w of res.warnings) if (!RV.warnings.includes(w)) RV.warnings.push(w);
    RV.asking = false; RV.region = null; RV.hint = '';
    renderReview();
    C.toast(t('rv.askDone', { updated: M.people(updated), added: M.people(added) }));
  } catch (e) {
    RV.asking = false; renderReview();
    if (!(e && e.code === 'cancelled')) { const el = $('#rvAskError'); el.textContent = errorText(e); el.hidden = false; }
  }
}
async function rvApply(btn) {
  let bad = null;
  for (const rp of RV.people) {
    if (rp.action === 'new') {
      for (const f of FIELDS) {
        const inp = document.getElementById(`rv_${rp.key}_${f.key}`), v = String(rp.fields[f.key] || '').trim();
        let err = '';
        if (f.required && !v) err = t('rv.requiredOrSkip', { field: fieldLabel(f).toLowerCase() });
        else if (f.type === 'date' && v) { const pd = parseDate(v); if (!pd.ok) err = pd.error; }
        UI.setFieldError(inp, err); if (err && !bad) bad = inp || bad;
        if (err && !inp) bad = bad || $(`[data-key="${rp.key}"] select`);
      }
    } else if (rp.action === 'match') {
      for (const [k, u] of Object.entries(rp.upd)) {
        if (u.type !== 'date') continue;
        const inp = document.getElementById(`rvu_${rp.key}_${k}`), pd = parseDate(u.value);
        const err = u.take && !pd.ok ? pd.error : '';
        UI.setFieldError(inp, err); if (err && !bad) bad = inp;
      }
    }
  }
  if (bad) { bad.focus(); bad.scrollIntoView({ block: 'center' }); C.toast(t('rv.fixFields'), { kind: 'error' }); return; }
  const idMap = new Map(), ops = []; let nNew = 0, nUpd = 0, nRel = 0; const names = [];
  for (const rp of RV.people) {
    if (rp.action === 'new') {
      const vals = {};
      for (const f of FIELDS) { let v = String(rp.fields[f.key] || '').trim(); if (f.type === 'date' && v) v = parseDate(v).value; vals[f.key] = v; }
      const rec = M.newPersonRecord(vals, 'photo'); idMap.set(rp.tempId, rec.id); ops.push({ t: 'putPerson', p: rec }); nNew++; names.push(shortName(rec));
    } else if (rp.action === 'match') {
      const ex = S.persons.get(rp.matchId); if (!ex) continue;
      const ch = {};
      for (const [k, u] of Object.entries(rp.upd)) if (u.take) ch[k] = u.type === 'date' ? parseDate(u.value).value : String(u.value).trim();
      if (Object.keys(ch).length) { ops.push({ t: 'putPerson', p: { ...ex, ...ch, updatedAt: M.nowIso() } }); nUpd++; names.push(shortName(ex)); }
    }
  }
  for (const rel of RV.relations) {
    if (!rel.accepted) continue;
    const st = rvRelStatus(rel).state; if (st !== 'ok' && st !== 'warn') continue;
    const a = rvResolve(rel.from), b = rvResolve(rel.to);
    const A = a.existing ? a.id : idMap.get(a.id), B = b.existing ? b.id : idMap.get(b.id);
    if (!A || !B || A === B) continue;
    ops.push({ t: 'putRel', r: makeRel(rel.type, A, B, { status: rel.status, adopted: rel.adopted }) }); nRel++;
  }
  if (!ops.length) { C.toast(t('rv.nothingToApply')); return; }
  btn.disabled = true;
  const inverse = ops.map(C.invert).filter(Boolean);
  const thumb = subCanvas(RV.canvas, 0, 0, RV.canvas.width, RV.canvas.height, 160).toDataURL('image/jpeg', 0.6);
  const ok = await C.applyOps(ops, {
    label: t('rv.applied', { people: M.people(nNew), upd: M.people(nUpd), rel: nRel }), reason: 'photo',
    onProgress: (d, total) => { btn.textContent = t('rv.saving', { d, t: total }); },
  });
  if (ok) {
    ST.ocrLog.push({ id: M.uid('log'), at: M.nowIso(), thumb, added: nNew, updated: nUpd, links: nRel, names: names.slice(0, 6).join(', ') + (names.length > 6 ? '…' : ''), inverse });
    closeReview(); resetUpload();
    // Show the result on the canvas: fit the whole tree, select the first new person and flash everything that was added.
    const newIds = [...idMap.values()], touched = [...new Set([...newIds, ...ops.filter(o => o.t === 'putPerson').map(o => o.p.id)])];
    S.needFit = true; if (newIds.length) S.pendingSelect = newIds[0];
    FT.scheduleRender();
    setTimeout(() => touched.forEach(id => UI.flashNode(id)), 450);
  } else { btn.disabled = false; btn.textContent = t('rv.apply'); }
}

/* ---------- Events ---------- */
function bind() {
  $('#dropZone').onclick = pickFile;
  $('#fileInput').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; handleFile(f); });
  const dz = $('#dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); });
  document.addEventListener('paste', e => {
    if (S.readOnly || S.caps.sampleState === 'unavailable' || !$('#review').hidden || up.state === 'running' || $('#personDialog').open || $('#toolDialog').open) return;
    const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); handleFile(f); }
  });
  $('#upRotate').onclick = () => { up.params.rot = (up.params.rot + 1) % 4; up.params.crop = null; syncControls(); process(); };
  $('#upAngle').addEventListener('input', e => { up.params.angle = +e.target.value; $('#upAngleVal').textContent = up.params.angle + '°'; process(); });
  $('#upContrast').addEventListener('input', e => { up.params.contrast = +e.target.value; $('#upContrastVal').textContent = Math.round(up.params.contrast * 100) + '%'; process(); });
  $('#upEnhance').addEventListener('change', e => { up.params.enhance = e.target.checked; process(); });
  $('#upCrop').onclick = () => { up.cropMode = !up.cropMode; syncControls(); };
  $('#upCropReset').onclick = () => { up.params.crop = null; syncControls(); process(); };
  $('#upReset').onclick = () => { up.params = defaultParams(); up.cropMode = false; syncControls(); process(); };
  $('#upChange').onclick = pickFile;
  $('#upGo').onclick = recognize;
  $('#upStop').onclick = () => { if (up.ctl) up.ctl.abort(); };
  $('#upNote').addEventListener('click', e => { if (e.target.closest('[data-open="settings"]')) FT.tools.openSettings(); });
  window.addEventListener('resize', () => { if (up.state === 'edit') drawPreview(); });
  bindCrop();

  const rv = $('#review');
  const rvP = el => RV.people.find(p => p.key === el.closest('.rv-person').dataset.key);
  const rvR = el => RV.relations.find(r => r.id === el.closest('.rv-rel').dataset.rel);
  rv.addEventListener('click', e => {
    if (!RV) return;
    const b = e.target.closest('[data-rv]');
    if (b) {
      const a = b.dataset.rv;
      if (a === 'close') closeReview(); else if (a === 'acceptAll') rvAll(true); else if (a === 'rejectAll') rvAll(false); else if (a === 'apply') rvApply(b);
      else if (a === 'select') { RV.selecting = !RV.selecting; renderReview(); }
      else if (a === 'zoom') $('#rvPhotoBox').classList.toggle('zoomed');
      else if (a === 'clearRegion') { RV.region = null; RV.hint = ''; renderReview(); }
      else if (a === 'ask') askAgain();
      return;
    }
    const mark = e.target.closest('[data-mark]');
    if (mark) { const el = rv.querySelector(`.rv-person[data-ref="${CSS.escape(mark.dataset.mark)}"]`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); } return; }
    const cf = e.target.closest('[data-confirm]');
    if (cf) { const rp = rvP(cf); rp.confirmed.add(cf.dataset.confirm); renderReview(); return; }
    if (e.target.closest('[data-split]')) { splitPerson(rvP(e.target)); renderReview(); return; }
    const sw = e.target.closest('[data-relswap]');
    if (sw) { const rel = rvR(sw); [rel.from, rel.to] = [rel.to, rel.from]; renderRvRels(); return; }
    const del = e.target.closest('[data-reldel]');
    if (del) { const rel = rvR(del); RV.relations = RV.relations.filter(r => r !== rel); renderRvRels(); return; }
    if (e.target.closest('[data-add-rel]')) {
      const box = $('#rvRelList'), from = $('[data-add-from]', box).value, type = $('[data-add-type]', box).value, to = $('[data-add-to]', box).value;
      if (!from || !to || from === to) return;
      const k = type === 'spouse' ? 'S' + [from, to].sort().join('|') : 'P' + from + '|' + to;
      if (RV.relations.some(r => (r.type === 'spouse' ? 'S' + [r.from, r.to].sort().join('|') : 'P' + r.from + '|' + r.to) === k)) { C.toast(t('link.exists')); return; }
      RV.relations.push({ id: 'm' + Date.now(), type, from, to, confidence: 'high', status: '', adopted: false, accepted: true }); renderRvRels(); return;
    }
  });
  rv.addEventListener('mouseover', e => {
    if (!RV) return;
    const mark = e.target.closest('[data-mark]'), card = e.target.closest('.rv-person');
    const ref = mark ? mark.dataset.mark : card ? card.dataset.ref : null;
    if (ref === RV.hover) return;
    RV.hover = ref;
    $$('.rv-mark', rv).forEach(m => m.classList.toggle('hover', m.dataset.mark === ref));
    $$('.rv-person', rv).forEach(c => c.classList.toggle('hover', c.dataset.ref === ref));
  });
  rv.addEventListener('change', e => {
    const el = e.target; if (!RV) return;
    if (el.matches('[data-rvact]')) {
      const rp = rvP(el), v = el.value;
      if (v === 'new' || v === 'skip') rp.action = v;
      else if (v.startsWith('merge:')) { mergeInto(rp, v.slice(6)); renderReview(); return; }
      else if (v.startsWith('match:')) {
        const id = v.slice(6), other = RV.people.find(p => p !== rp && p.action === 'match' && p.matchId === id);
        rp.action = 'match'; rp.matchId = id; rp.autoMatched = false; initUpdate(rp);
        if (other) C.toast(t('rv.dupMatch', { name: fullName(other.fields) }));
      }
      renderReview(); return;
    }
    if (el.matches('[data-take]')) { rvP(el).upd[el.dataset.take].take = el.checked; renderReview(); return; }
    if (el.matches('[data-relcheck]')) { rvR(el).accepted = el.checked; renderRvRels(); return; }
    if (el.matches('[data-reltype]')) { rvR(el).type = el.value; renderRvRels(); return; }
    if (el.matches('[data-u]') && el.tagName === 'SELECT') { const rp = rvP(el); rp.upd[el.dataset.u].value = el.value; rp.confirmed.add(el.dataset.u); updateRvSummary(); return; }
    if (el.matches('[data-relstatus]')) { rvR(el).status = el.value; return; }
    if (el.matches('[data-reladopted]')) { rvR(el).adopted = el.checked; return; }
    if (el.matches('[data-f]')) { const rp = rvP(el); if (el.tagName === 'SELECT') { rp.fields[el.dataset.f] = el.value; rp.confirmed.add(el.dataset.f); } if (['firstName', 'lastName'].includes(el.dataset.f)) renderRvRels(); if (el.closest('.needs-confirm')) renderReview(); }
  });
  rv.addEventListener('input', e => {
    const el = e.target; if (!RV) return;
    if (el.matches('[data-f]')) {
      const rp = rvP(el); rp.fields[el.dataset.f] = el.value; rp.confirmed.add(el.dataset.f);
      if (['firstName', 'patronymic', 'lastName'].includes(el.dataset.f)) { const s = el.closest('.rv-person').querySelector('.rv-p-title strong'); if (s) s.textContent = fullName(rp.fields); }
      updateRvSummary();
    } else if (el.matches('[data-u]')) { const rp = rvP(el); rp.upd[el.dataset.u].value = el.value; rp.confirmed.add(el.dataset.u); updateRvSummary(); }
    else if (el.id === 'rvHint') RV.hint = el.value;
  });
  // Region selection on the photo
  let sel = null;
  const posIn = (e, box) => { const r = box.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  rv.addEventListener('pointerdown', e => {
    if (!RV || !RV.selecting) return; const inner = e.target.closest('.rv-photo-inner'); if (!inner) return;
    e.preventDefault(); inner.setPointerCapture(e.pointerId); sel = { inner, a: posIn(e, inner), b: posIn(e, inner) }; const box = $('#rvSelect'); box.hidden = false; drawSel();
  });
  rv.addEventListener('pointermove', e => { if (!sel) return; sel.b = posIn(e, sel.inner); drawSel(); });
  rv.addEventListener('pointerup', () => {
    if (!sel) return; const { a, b } = sel; sel = null;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    RV.selecting = false;
    if (w >= 0.02 && h >= 0.02) RV.region = { x, y, w, h };
    renderReview();
  });
  function drawSel() { const box = $('#rvSelect'); if (!box || !sel) return; const { a, b } = sel; box.style.left = Math.min(a.x, b.x) * 100 + '%'; box.style.top = Math.min(a.y, b.y) * 100 + '%'; box.style.width = Math.abs(a.x - b.x) * 100 + '%'; box.style.height = Math.abs(a.y - b.y) * 100 + '%'; }
}

FT.ocr = { refreshProvider, renderUploadState, pickFile, handleFile, resetUpload, recognize, openReview, closeReview, renderReview, normalizeResult, get review() { return RV; }, get upload() { return up; }, bind, setUp, syncControls,
  _parseJsonText: parseJsonText, _outputSchema: outputSchema,
  /* test hook: inject a fake provider */ _setProvider(p) { provider = p; S.caps.sampleState = p ? 'ready' : 'unavailable'; S.caps.sampleNoteKey = ''; FT.scheduleRender(); } };
})();
