/* Rootline — shared namespace and application state.
   Every module attaches itself to window.FT; scripts load in the order listed in index.html. */
(function () {
'use strict';
window.FT = window.FT || {};
FT.S = {
  mode: 'loading',           // 'loading' | 'local' | 'db' | 'demo'
  persons: new Map(),
  relations: new Map(),
  idx: null,                 // relationship index, built by FT.model.buildIndex
  loaded: false,
  readOnly: false, realReadOnly: false, canWrite: null,
  selectedId: null, pendingSelect: null, centerAfter: null, needFit: true,
  backend: null, realFactory: null,
  caps: { sample: null, sampleLimits: null, sampleState: 'pending', sampleNoteKey: '', downloads: null, claude: false },
  history: { undo: [], redo: [] },
};
})();
