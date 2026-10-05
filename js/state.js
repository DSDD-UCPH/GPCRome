/* Application state: table rows, global settings and label offsets, with undo/redo and persistence */
window.GPCRome = window.GPCRome || {};

GPCRome.state = (function () {
   const STORAGE_KEY = 'gpcrome-state-v1';
   const ROW_FIELDS = ['sel', 'value', 'fill', 'size', 'shape', 'stroke', 'opacity', 'label', 'text'];

   function defaultSettings() {
      const tree = {};
      GPCROME_TREE.classes.forEach(c => { tree[c.id] = { visible: true, color: c.color }; });
      return {
         shape: 'circle',
         size: 6,
         fill: '#e6332a',
         stroke: '#333333',
         strokeWidth: 0.6,
         opacity: 0.85,
         sizeByValue: true,
         colorByValue: true,
         sizeMin: 3,
         sizeMax: 14,
         palette: 'viridis',
         reversePalette: false,
         valueScale: 'linear',
         valueMin: '',
         valueMax: '',
         legend: true,
         legendTitle: 'Value',
         labels: 'none',
         labelName: 'gene',
         labelSize: 10,
         labelColor: '#222222',
         labelBold: false,
         labelItalic: false,
         labelLine: 'auto',
         unmapped: 'hidden',
         treeWidth: 1,
         treeOpacity: 1,
         background: 'white',
         tree,
      };
   }

   let current = { rows: [], settings: defaultSettings(), offsets: {} };
   const undoStack = [], redoStack = [];
   const listeners = [];
   let lastCommit = { key: null, time: 0 };

   function clone(obj) {
      return JSON.parse(JSON.stringify(obj));
   }

   function cleanRow(row) {
      const out = {};
      ROW_FIELDS.forEach(f => {
         const v = row[f];
         out[f] = v === null || v === undefined ? '' : (typeof v === 'string' ? v.trim() : v);
      });
      return out;
   }

   function isEmptyRow(row) {
      return ROW_FIELDS.every(f => row[f] === '' || row[f] === null || row[f] === undefined);
   }

   /* Merge stored settings over defaults so new settings get sensible values */
   function mergeSettings(stored) {
      const s = defaultSettings();
      Object.keys(stored || {}).forEach(k => {
         if (k === 'tree') {
            Object.keys(stored.tree || {}).forEach(c => { if (s.tree[c]) Object.assign(s.tree[c], stored.tree[c]); });
         } else if (k in s) s[k] = stored[k];
      });
      return s;
   }

   function notify(source) {
      listeners.forEach(fn => fn(current, source));
      save();
   }

   /*
    * Apply a change. Changes with the same `coalesce` key within one second are merged
    * into a single undo step (e.g. dragging a colour picker).
    */
   function commit(mutator, opts) {
      opts = opts || {};
      const now = Date.now();
      const merge = opts.coalesce && lastCommit.key === opts.coalesce && now - lastCommit.time < 1000;
      if (!merge) {
         undoStack.push(clone(current));
         if (undoStack.length > 200) undoStack.shift();
         redoStack.length = 0;
      }
      lastCommit = { key: opts.coalesce || null, time: now };
      mutator(current);
      notify(opts.source);
   }

   function setRows(rows, opts) {
      commit(s => { s.rows = rows.map(cleanRow).filter(r => !isEmptyRow(r)); }, opts);
   }

   function setSettings(patch, opts) {
      commit(s => {
         Object.keys(patch).forEach(k => {
            if (k === 'tree') {
               Object.keys(patch.tree).forEach(c => Object.assign(s.settings.tree[c], patch.tree[c]));
            } else s.settings[k] = patch[k];
         });
      }, opts);
   }

   function setOffset(id, offset) {
      commit(s => {
         if (offset) s.offsets[id] = offset.map(v => Math.round(v * 10) / 10);
         else delete s.offsets[id];
      });
   }

   function load(snapshot, opts) {
      commit(s => {
         s.rows = (snapshot.rows || []).map(cleanRow).filter(r => !isEmptyRow(r));
         s.settings = mergeSettings(snapshot.settings);
         s.offsets = snapshot.offsets || {};
      }, opts);
   }

   function reset() {
      load({ rows: [], settings: defaultSettings(), offsets: {} });
   }

   function step(from, to) {
      if (!from.length) return;
      to.push(clone(current));
      current = from.pop();
      lastCommit = { key: null, time: 0 };
      notify('history');
   }

   const undo = () => step(undoStack, redoStack);
   const redo = () => step(redoStack, undoStack);

   let saveTimer = null;
   function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
         try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (e) { /* storage unavailable */ }
      }, 300);
   }

   function restore() {
      try {
         const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
         if (stored) {
            current = { rows: stored.rows || [], settings: mergeSettings(stored.settings), offsets: stored.offsets || {} };
            return true;
         }
      } catch (e) { /* ignore corrupt storage */ }
      return false;
   }

   /* Only store settings that differ from the defaults to keep share links short */
   function compact() {
      const d = defaultSettings(), s = current.settings, out = {};
      Object.keys(s).forEach(k => {
         if (k === 'tree') {
            const t = {};
            Object.keys(s.tree).forEach(c => {
               const diff = {};
               if (s.tree[c].visible !== d.tree[c].visible) diff.visible = s.tree[c].visible;
               if (s.tree[c].color !== d.tree[c].color) diff.color = s.tree[c].color;
               if (Object.keys(diff).length) t[c] = diff;
            });
            if (Object.keys(t).length) out.tree = t;
         } else if (s[k] !== d[k]) out[k] = s[k];
      });
      const rows = current.rows.map(r => {
         const o = {};
         ROW_FIELDS.forEach(f => { if (r[f] !== '') o[f] = r[f]; });
         return o;
      });
      return { rows, settings: out, offsets: current.offsets };
   }

   async function transform(bytes, stream) {
      return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
   }

   async function shareLink() {
      const json = new TextEncoder().encode(JSON.stringify(compact()));
      const packed = await transform(json, new CompressionStream('deflate-raw'));
      let bin = '';
      packed.forEach(b => { bin += String.fromCharCode(b); });
      const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return location.href.split('#')[0].split('?')[0] + '#s=' + b64;
   }

   async function fromShareHash(hash) {
      const m = hash.match(/s=([A-Za-z0-9_-]+)/);
      if (!m) return null;
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const json = await transform(bytes, new DecompressionStream('deflate-raw'));
      return JSON.parse(new TextDecoder().decode(json));
   }

   return {
      ROW_FIELDS, defaultSettings,
      get: () => current,
      subscribe: fn => listeners.push(fn),
      setRows, setSettings, setOffset, load, reset, undo, redo, restore,
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      shareLink, fromShareHash,
   };
})();
