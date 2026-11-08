# Rootline — family tree

A browser app for building a family tree: add people and relationships by hand, import JSON or GEDCOM, or upload a photo of a hand-drawn chart and let Claude recognise the names, dates and links. Everything is reviewed on a verification screen before it is saved.

No build step. Open `index.html` in a browser (or serve the folder with any static server). The interface is bilingual: EN / RU switch in the top bar.

## Files

| Path | What it holds |
| --- | --- |
| `index.html` | Markup only. Static text carries `data-i18n` / `data-i18n-attr` keys. |
| `css/styles.css` | Styles: tokens, four themes (light, dark, parchment, minimal), tree, panel, dialogs, review screen. |
| `js/i18n.js` | EN/RU dictionary, `t()` / `count()` helpers, Cyrillic→Latin transliteration, language switch. |
| `js/state.js` | The shared `FT` namespace and application state `FT.S`. |
| `js/model.js` | Data model, field list, dates, names, relationship index and checks, schema migration, import validation, duplicates, generations/branches, statistics, problem detection. |
| `js/storage.js` | Tree backends (localStorage or the Claude artifact database), photo store (IndexedDB), backups ring, settings, recognition log, API key, downloads, image compression. |
| `js/settings.js` | Appearance settings: themes, font pairings (Google Fonts loaded on demand), font size, node size, node options, layout direction and spacing. |
| `js/core.js` | Change batches with undo/redo, automatic backups, replace-tree, toasts. |
| `js/tree.js` | dagre layout (top-down or left-right), SVG rendering with photos and colour coding, pan/zoom, canvas renderer for PNG/PDF. |
| `js/ui.js` | Details panel, person and relation dialogs, photo gallery and lightbox, search, generic tool dialog. |
| `js/export.js` | JSON export, GEDCOM 5.5.1 export and import, PNG, tree PDF, person card PDF (jsPDF loaded on demand). |
| `js/tools.js` | Settings, export, import (summary, replace/merge, duplicate resolution), backups, statistics, problems and merge, recognition log. |
| `js/ocr.js` | Photo preparation (rotate, straighten, crop, contrast), the Claude request, result normalisation, the review screen with confidence levels, markers, merge/split, link editing, "ask again" for a region, portrait detection, log entries. |
| `js/app.js` | Boot, top bar, menu, sample tree, keyboard shortcuts, language change. |

Scripts are classic (non-module) and load in the order listed in `index.html`; each attaches itself to `window.FT`.

## Where recognition runs

Recognition is done by Claude. Two ways:

- Page opened inside Claude: the artifact runtime's `sample` capability is used with the signed-in account.
- Page opened anywhere else: an Anthropic API key entered in Settings is stored in `localStorage` and requests go straight to `api.anthropic.com` (model selectable, default `claude-opus-5-5`).

Requests are streamed (SSE), ask for a structured JSON answer that matches a schema (`output_config.format`, with a plain-JSON fallback), use effort `max` in the "Best accuracy" mode and `high` in "Faster", and allow 64k output tokens. A truncated or damaged answer is repaired when possible and flagged on the review screen; an unparseable one is shown raw with a retry button.

## Editing links on the canvas

Every card has link ports (dots that appear on hover): top/left = parent, bottom/right = child, sides = partner. Drag a port onto another card to create the link; the nearest card within 40 px snaps like a magnet. Drag an existing child line to move the child to another parent (the new parent's only partner is attached too), or drag a marriage line by one end to replace that partner. Each drop is validated (no cycles, at most two parents) and saved immediately, with undo.

What is sent: the prepared photo (after rotate/crop/contrast, downscaled to 2000 px, plus enlarged quarters for big photos) and a list of names/dates already in the tree so the model can match existing people. Nothing else leaves the browser. Without either option recognition is disabled and the app says so.

## Storage

- Tree: `localStorage` key `family-tree-v1` (or the artifact database `trees/main/persons|relations|photos` inside Claude).
- Photos: IndexedDB database `rootline-photos` (compressed to max 1600 px JPEG, quality 0.85).
- Backups: `rootline-backups` — the last 5 states, snapshotted before changes (at most once per 20 s), restorable from the menu.
- Settings `rootline-settings`, language `family-tree-lang`, recognition log `rootline-ocr-log`, API key `rootline-api-key`.

## JSON schema (version 2)

```json
{
  "app": "rootline", "schema": 2, "exportedAt": "ISO date",
  "settings": { "theme": "light", "fontPair": "literata", "fontSize": 14, "nodeSize": "normal",
                "showDates": true, "showPlaces": true, "showPhotos": true, "colorBy": "none",
                "direction": "TB", "spacing": 1 },
  "persons": [ {
    "id": "p_…", "schema": 2,
    "firstName": "", "patronymic": "", "lastName": "", "maidenName": "", "nickname": "", "gender": "m|f|",
    "birthDate": "YYYY | YYYY-MM | YYYY-MM-DD", "deathDate": "", "birthCity": "", "occupation": "", "source": "", "notes": "",
    "photos": ["ph_…"], "mainPhoto": "ph_…", "placeholder": false,
    "extra": {}, "origin": "manual|photo|demo|import|gedcom", "createdAt": "ISO", "updatedAt": "ISO"
  } ],
  "relations": [
    { "id": "par_<parent>_<child>", "type": "parent", "from": "p_parent", "to": "p_child", "adopted": false, "createdAt": "ISO" },
    { "id": "sp_<a>_<b>", "type": "spouse", "from": "p_a", "to": "p_b", "status": "married|divorced|partner|", "createdAt": "ISO" }
  ],
  "photos": [ { "id": "ph_…", "personId": "p_…", "dataUrl": "data:image/jpeg;base64,…", "w": 1600, "h": 1200 } ]
}
```

Version 1 files (from the first release) are migrated on load: the old `source` tag becomes `origin`, new fields default to empty strings.

## Development

There is no test runner in the repo. During development the app was exercised with a headless Chrome script (playwright-core) that adds people, uploads photos, exports and re-imports JSON/GEDCOM, drives the review screen with a fake recognition provider, and takes screenshots of each theme.
