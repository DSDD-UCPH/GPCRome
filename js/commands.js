/*
 * Text input: receptor lists, CSV/TSV tables and one-line commands.
 *
 *   ADRB2                          mark with the default style
 *   ADRB2 7.5                      mark with a value (also "ADRB2,7.5" or tab separated)
 *   ADRB* fill=red shape=star      wildcards and style properties
 *   class:secretin size=10 label   class/family/ligand selectors, bare words for colours, shapes and "label"
 *   fill=red shape=star size=8     a style line applies to the receptors listed below it
 *   ADRB2                          (until the next style line; style clear ends the group)
 *   set palette=magma labels=all   change global settings
 *   chemokine / family:aminergic   a whole receptor family, by name
 *   set tree=olfactory             the olfactory tree instead of the non-olfactory tree (set tree=non-olfactory)
 *   # comment
 */
window.GPCRome = window.GPCRome || {};

GPCRome.commands = (function () {
   const { ROW_FIELDS, defaultSettings } = GPCRome.state;

   const FIELD_ALIASES = {
      receptor: 'sel', receptors: 'sel', id: 'sel', gene: 'sel', selector: 'sel', sel: 'sel', target: 'sel',
      value: 'value', val: 'value', score: 'value',
      fill: 'fill', color: 'fill', colour: 'fill',
      size: 'size', radius: 'size',
      shape: 'shape',
      stroke: 'stroke', border: 'stroke', outline: 'stroke',
      opacity: 'opacity', alpha: 'opacity', transparency: 'opacity',
      label: 'label',
      text: 'text', label_text: 'text', labeltext: 'text',
   };
   const CSV_HEADER = ['receptor', 'value', 'fill', 'size', 'shape', 'stroke', 'opacity', 'label', 'label_text'];

   const ENUMS = {
      shape: () => GPCRome.shapes.names,
      palette: () => Object.keys(GPCRome.colors.palettes),
      labels: () => ['none', 'mapped', 'all'],
      valueScale: () => ['linear', 'log'],
      labelName: () => ['gene', 'entry', 'gpcrdb'],
      unmapped: () => ['hidden', 'dots'],
      background: () => ['white', 'transparent'],
      treeView: () => ['nonolfactory', 'olfactory'],
   };

   const TRUE = ['yes', 'y', 'true', 'on', '1', 'show'];
   const FALSE = ['no', 'n', 'false', 'off', '0', 'hide'];

   function normShape(v) {
      return String(v).toLowerCase().replace(/[-_]+/g, ' ').trim();
   }

   function normLabel(v) {
      const s = String(v).toLowerCase().trim();
      if (!s) return '';
      if (TRUE.includes(s)) return 'yes';
      if (FALSE.includes(s)) return 'no';
      return null;
   }

   /* Split a line on a delimiter (or whitespace when delim is null), honouring double quotes */
   function split(line, delim) {
      const out = [];
      let cur = '', quoted = false, started = false;
      for (let i = 0; i < line.length; i++) {
         const ch = line[i];
         if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
            else quoted = !quoted;
            started = true;
         } else if (!quoted && (delim ? ch === delim : /\s/.test(ch))) {
            if (delim || started) out.push(cur.trim());
            cur = ''; started = false;
         } else {
            cur += ch;
            if (!/\s/.test(ch)) started = true;
         }
      }
      if (delim || started) out.push(cur.trim());
      return out;
   }

   function detectDelimiter(line) {
      if (line.includes('\t')) return '\t';
      const unquoted = line.replace(/"[^"]*"/g, '');
      if (unquoted.includes(',')) return ',';
      if (unquoted.includes(';')) return ';';
      return null;
   }

   /* Validate and normalise one row property; returns [value] or an error string */
   function parseField(field, raw) {
      const v = String(raw).trim();
      if (v === '') return [''];
      switch (field) {
         case 'value':
         case 'size':
         case 'opacity': {
            const pct = field === 'opacity' && /%$/.test(v);
            const n = Number(v.replace(',', '.').replace(/%$/, ''));
            if (!isFinite(n)) return `"${v}" is not a number (${field})`;
            const num = pct ? n / 100 : n;
            if (field === 'opacity' && (num < 0 || num > 1)) return `opacity must be between 0 and 1`;
            return [num];
         }
         case 'stroke':
            if (v.toLowerCase() === 'none') return ['none'];
         // falls through
         case 'fill':
            return GPCRome.colors.isColor(v) ? [v] : `"${v}" is not a colour`;
         case 'shape': {
            const s = normShape(v);
            return GPCRome.shapes.names.includes(s) ? [s] : `unknown shape "${v}"`;
         }
         case 'label': {
            const l = normLabel(v);
            return l === null ? `label must be yes or no` : [l];
         }
         default:
            return [v];
      }
   }

   function parseSetting(key, raw, out) {
      const defaults = defaultSettings();
      const v = String(raw).trim();
      const tm = key.match(/^tree\.([a-z0-9]+)(?:\.(visible|color))?$/i);
      if (tm) {
         const cls = tm[1].toLowerCase(), prop = tm[2] ? tm[2].toLowerCase() : 'visible';
         if (!defaults.tree[cls]) return `unknown class "${tm[1]}"`;
         out.tree = out.tree || {};
         out.tree[cls] = out.tree[cls] || {};
         if (prop === 'visible') {
            const l = normLabel(v);
            if (l === null) return `tree.${cls} must be on or off`;
            out.tree[cls].visible = l === 'yes';
         } else {
            if (!GPCRome.colors.isColor(v)) return `"${v}" is not a colour`;
            out.tree[cls].color = GPCRome.colors.toHex(v);
         }
         return null;
      }
      const name = Object.keys(defaults).find(k => k.toLowerCase() === (key.toLowerCase() === 'tree' ? 'treeview' : key.toLowerCase()));
      if (!name || name === 'tree') return `unknown setting "${key}"`;
      const def = defaults[name];
      if (typeof def === 'boolean') {
         const l = normLabel(v);
         if (l === null) return `${name} must be yes or no`;
         out[name] = l === 'yes';
      } else if (typeof def === 'number') {
         const n = Number(v);
         if (!isFinite(n)) return `${name} must be a number`;
         out[name] = n;
      } else if (name === 'valueMin' || name === 'valueMax') {
         if (v !== '' && v !== 'auto' && !isFinite(Number(v))) return `${name} must be a number or auto`;
         out[name] = v === 'auto' || v === '' ? '' : Number(v);
      } else if (name === 'labelLine') {
         const map = {
            on: 'on', enable: 'on', enabled: 'on', show: 'on', yes: 'on', true: 'on',
            auto: 'auto', automatic: 'auto',
            off: 'off', disable: 'off', disabled: 'off', hide: 'off', no: 'off', none: 'off', false: 'off',
         };
         const m = map[v.toLowerCase()];
         if (!m) return 'labelLine must be enable, auto or disable';
         out[name] = m;
      } else if (ENUMS[name]) {
         const val = name === 'shape' ? normShape(v) : name === 'treeView' ? v.toLowerCase().replace(/^(non[- _]?olfactory|gpcrs?|main|default)$/, 'nonolfactory').replace(/^(olfactory|or|ors)$/, 'olfactory') : v;
         const allowed = ENUMS[name]();
         const match = allowed.find(a => a.toLowerCase() === val.toLowerCase());
         if (!match) return `${name} must be one of: ${allowed.join(', ')}`;
         out[name] = match;
      } else if (name === 'fill' || name === 'stroke' || name === 'labelColor') {
         if (!GPCRome.colors.isColor(v)) return `"${v}" is not a colour`;
         out[name] = GPCRome.colors.toHex(v);
      } else {
         out[name] = v;
      }
      return null;
   }

   function emptyRow() {
      const r = {};
      ROW_FIELDS.forEach(f => { r[f] = ''; });
      return r;
   }

   /* Interpret the tokens after the selector of a command line */
   function parseTokens(tokens, row, errors, lineNo) {
      tokens.forEach(tok => {
         if (!tok) return;
         const kv = tok.match(/^([a-z_]+)\s*[=:]\s*(.*)$/i);
         if (kv) {
            const field = FIELD_ALIASES[kv[1].toLowerCase()];
            if (!field || field === 'sel') {
               errors.push({ line: lineNo, message: `unknown property "${kv[1]}"` });
               return;
            }
            const res = parseField(field, kv[2]);
            if (typeof res === 'string') errors.push({ line: lineNo, message: res });
            else row[field] = res[0];
            return;
         }
         const n = Number(tok.replace(',', '.'));
         if (tok !== '' && isFinite(n)) { row.value = n; return; }
         const lower = tok.toLowerCase();
         if (lower === 'label' || lower === 'labelled' || lower === 'labeled') { row.label = 'yes'; return; }
         if (lower === 'nolabel') { row.label = 'no'; return; }
         if (GPCRome.shapes.names.includes(normShape(tok))) { row.shape = normShape(tok); return; }
         if (GPCRome.colors.isColor(tok)) { row.fill = tok; return; }
         errors.push({ line: lineNo, message: `could not interpret "${tok}"` });
      });
   }

   /* A token that sets appearance, with no receptor attached. */
   function isStyleToken(tok) {
      if (!tok) return false;
      const kv = tok.match(/^([a-z_]+)\s*[=:]/i);
      if (kv) return !!FIELD_ALIASES[kv[1].toLowerCase()] && FIELD_ALIASES[kv[1].toLowerCase()] !== 'sel';
      if (isFinite(Number(tok.replace(',', '.')))) return true;
      const lower = tok.toLowerCase();
      if (lower === 'label' || lower === 'labelled' || lower === 'labeled' || lower === 'nolabel') return true;
      if (GPCRome.shapes.names.includes(normShape(tok))) return true;
      if (GPCRome.colors.isColor(tok)) return true;
      return false;
   }

   function isHeader(cells, delimited) {
      const known = cells.map(c => FIELD_ALIASES[c.toLowerCase().replace(/\s+/g, '_')]);
      if (known[0] !== 'sel' || cells.length < 2) return false;
      return delimited ? known.filter(Boolean).length >= 2 : known.every(Boolean);
   }

   /*
    * Parse free text or a CSV/TSV file.
    * Returns { rows, settings, offsets, errors }.
    */
   function parse(text) {
      const result = { rows: [], settings: {}, offsets: {}, errors: [] };
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      let columns = null;
      /* Style lines apply to the receptors that follow. Consecutive style lines combine;
         a style line after a receptor starts a new group. */
      let group = null;
      let groupUsed = false;

      function setGroup(tokens, lineNo) {
         const base = !group || groupUsed ? emptyRow() : Object.assign(emptyRow(), group);
         parseTokens(tokens, base, result.errors, lineNo);
         group = base;
         groupUsed = false;
      }

      function inherit(row) {
         if (!group) return;
         ROW_FIELDS.forEach(f => {
            if (f !== 'sel' && row[f] === '' && group[f] !== '') row[f] = group[f];
         });
         groupUsed = true;
      }

      lines.forEach((rawLine, i) => {
         const lineNo = i + 1;
         const line = rawLine.trim();
         if (!line) return;

         const directive = line.match(/^#?\s*(set|offset)\s+(.*)$/i);
         if (directive && (line.startsWith('#') || /^set\s/i.test(line))) {
            const body = directive[2].replace(/^"|"$/g, '');
            if (directive[1].toLowerCase() === 'offset') {
               const p = split(body.replace(/[,=]/g, ' '), null);
               if (p.length === 3 && isFinite(p[1]) && isFinite(p[2])) result.offsets[p[0]] = [Number(p[1]), Number(p[2])];
               else result.errors.push({ line: lineNo, message: 'offset needs: ID dx dy' });
               return;
            }
            split(body, null).forEach(tok => {
               const kv = tok.match(/^([a-z0-9_.]+)\s*=\s*(.*)$/i);
               const err = kv ? parseSetting(kv[1], kv[2], result.settings) : `expected key=value, got "${tok}"`;
               if (err) result.errors.push({ line: lineNo, message: err });
            });
            return;
         }
         if (line.startsWith('#') || line.startsWith('//')) return;

         const delim = detectDelimiter(line);
         const cells = split(line, delim);
         const head = (cells[0] || '').toLowerCase();
         if (head === 'style' || head === 'with') {
            const rest = cells.slice(1);
            if (!rest.length || (rest.length === 1 && /^(clear|reset|none)$/i.test(rest[0]))) {
               group = null;
               groupUsed = false;
               return;
            }
            if (!rest.every(isStyleToken)) {
               result.errors.push({ line: lineNo, message: 'a style line only sets colour, shape, size and similar properties; list the receptors on the following lines' });
               return;
            }
            setGroup(rest, lineNo);
            return;
         }
         if (!columns && cells.length && cells.every(isStyleToken)) {
            setGroup(cells, lineNo);
            return;
         }
         if (!columns && result.rows.length === 0 && isHeader(cells, !!delim)) {
            columns = cells.map(c => FIELD_ALIASES[c.toLowerCase().replace(/\s+/g, '_')] || null);
            return;
         }

         const row = emptyRow();
         if (columns) {
            cells.forEach((c, k) => {
               const field = columns[k];
               if (!field) return;
               if (field === 'sel') { row.sel = c; return; }
               const res = parseField(field, c);
               if (typeof res === 'string') result.errors.push({ line: lineNo, message: res });
               else row[field] = res[0];
            });
         } else {
            row.sel = cells[0];
            parseTokens(cells.slice(1), row, result.errors, lineNo);
         }
         if (row.sel) {
            inherit(row);
            result.rows.push(row);
         }
      });
      return result;
   }

   function csvCell(v) {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
   }

   function settingLines(settings) {
      const d = defaultSettings(), lines = [];
      Object.keys(settings).forEach(k => {
         if (k === 'tree') {
            Object.keys(settings.tree).forEach(c => {
               const t = settings.tree[c];
               if (t.visible !== d.tree[c].visible) lines.push(`#set tree.${c}=${t.visible ? 'on' : 'off'}`);
               if (t.color !== d.tree[c].color) lines.push(`#set tree.${c}.color=${t.color}`);
            });
         } else if (settings[k] !== d[k]) {
            const v = typeof settings[k] === 'boolean' ? (settings[k] ? 'yes' : 'no') : settings[k];
            lines.push(`#set ${k}=${/\s/.test(String(v)) ? '"' + v + '"' : v}`);
         }
      });
      return lines;
   }

   /* Serialise the full state (settings, label offsets and rows) as CSV */
   function toCSV(state) {
      const lines = ['# GPCRome mapper settings - edit freely, lines starting with #set change global settings'];
      lines.push(...settingLines(state.settings));
      Object.keys(state.offsets).forEach(id => lines.push(`#offset ${id} ${state.offsets[id].join(' ')}`));
      lines.push(CSV_HEADER.join(','));
      state.rows.forEach(r => lines.push(ROW_FIELDS.map(f => csvCell(r[f])).join(',')));
      return lines.join('\n') + '\n';
   }

   /* Rows as command text (for editing in the text box) */
   function toText(rows) {
      return rows.map(r => {
         const parts = [/\s/.test(r.sel) ? `"${r.sel}"` : r.sel];
         if (r.value !== '') parts.push(String(r.value));
         ['fill', 'size', 'shape', 'stroke', 'opacity', 'label', 'text'].forEach(f => {
            if (r[f] !== '') {
               const v = String(r[f]);
               parts.push(`${f}=${/\s/.test(v) ? '"' + v + '"' : v}`);
            }
         });
         return parts.join(' ');
      }).join('\n');
   }

   return { parse, parseField, toCSV, toText, settingLines };
})();
