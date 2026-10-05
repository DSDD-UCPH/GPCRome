/* User interface wiring */
(function () {
   const $ = sel => document.querySelector(sel);
   const $$ = sel => [...document.querySelectorAll(sel)];
   const reg = GPCRome.registry, state = GPCRome.state, render = GPCRome.render, commands = GPCRome.commands;

   const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

   function toast(msg) {
      const t = $('#toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
   }

   /* ---------- tabs ---------- */
   function showTab(tab) {
      $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-' + tab; });
      if (tab === 'data') grid.render();
   }
   $$('.tabs button').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
   $$('[data-goto]').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.goto)));

   /* ---------- input box ---------- */
   function showMessages(target, errors, extra) {
      const box = $(target);
      const items = errors.slice(0, 8).map(e => `<li>Line ${e.line}: ${esc(e.message)}</li>`);
      if (errors.length > 8) items.push(`<li>… and ${errors.length - 8} more</li>`);
      box.innerHTML = (extra || '') + (items.length ? `<ul class="errors">${items.join('')}</ul>` : '');
   }

   function applyText(text, append) {
      const res = commands.parse(text);
      const cur = state.get();
      const rows = append ? cur.rows.concat(res.rows) : res.rows;
      state.load({
         rows: res.rows.length || !Object.keys(res.settings).length ? rows : cur.rows,
         settings: mergePatch(cur.settings, res.settings),
         offsets: Object.assign({}, cur.offsets, res.offsets),
      });
      const msg = res.rows.length ? `<p class="ok">${res.rows.length} line${res.rows.length > 1 ? 's' : ''} added to the table.</p>` : '';
      showMessages('#input-messages', res.errors, msg);
      return res;
   }

   function mergePatch(settings, patch) {
      const s = JSON.parse(JSON.stringify(settings));
      Object.keys(patch).forEach(k => {
         if (k === 'tree') Object.keys(patch.tree).forEach(c => Object.assign(s.tree[c], patch.tree[c]));
         else s[k] = patch[k];
      });
      return s;
   }

   $('#apply-replace').addEventListener('click', () => applyText($('#quick-input').value, false));
   $('#apply-append').addEventListener('click', () => applyText($('#quick-input').value, true));
   $('#quick-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); applyText(e.target.value, false); }
   });

   $('#upload').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then(text => {
         const res = applyText(text, false);
         toast(`Loaded ${file.name}: ${res.rows.length} rows`);
         e.target.value = '';
      });
   });

   /* ---------- quick sets and datasets ---------- */
   const datasetSelect = $('#dataset');
   let datasetGroup = null, datasetGroupEl = null;
   reg.datasets.forEach(d => {
      if (d.group !== datasetGroup) {
         datasetGroup = d.group;
         datasetGroupEl = document.createElement('optgroup');
         datasetGroupEl.label = d.group || 'Datasets';
         datasetSelect.appendChild(datasetGroupEl);
      }
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name} (${d.source})`;
      if (d.detail) opt.title = d.detail;
      (datasetGroupEl || datasetSelect).appendChild(opt);
   });

   const refSelect = $('#dataset-ref');
   reg.receptors.map(r => r.id).sort().forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      refSelect.appendChild(opt);
   });
   if (reg.byId.ADRB2) refSelect.value = 'ADRB2';

   let activeDataset = null, muteDataset = false;

   function datasetOptions() {
      return { ref: refSelect.value, tissue: $('#dataset-tissue').value };
   }

   function datasetSettings(d, opt, overrides) {
      return Object.assign({
         legendTitle: reg.datasetLegend(d, opt),
         legend: true,
         colorByValue: true,
         sizeByValue: d.sizeByValue !== false,
         valueScale: d.scale || 'linear',
         valueMin: d.valueMin != null ? d.valueMin : '',
         valueMax: d.valueMax != null ? d.valueMax : '',
         palette: d.palette || 'viridis',
         reversePalette: false,
      }, overrides);
   }

   function fillTissues(d) {
      const sel = $('#dataset-tissue');
      const prev = sel.value;
      muteDataset = true;
      sel.innerHTML = '<option value="__max__">Highest tissue</option>' +
         reg.tissuesFor(d).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
      if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
      muteDataset = false;
   }

   function loadDataset(id, overrides) {
      const d = reg.datasets.find(x => x.id === id);
      if (!d) return;
      activeDataset = id;
      const parameterized = d.kind === 'reference' || d.kind === 'tissue';
      $('#dataset-options').hidden = !parameterized;
      $('#dataset-ref-label').hidden = d.kind !== 'reference';
      $('#dataset-tissue-label').hidden = d.kind !== 'tissue';
      if (d.kind === 'tissue') fillTissues(d);
      const opt = datasetOptions();
      const rows = reg.datasetValues(d, opt);
      const settings = Object.assign({}, state.get().settings, datasetSettings(d, opt, overrides));
      state.load({ rows, settings, offsets: state.get().offsets });
      const where = d.kind === 'reference' ? ` vs ${opt.ref}` : d.kind === 'tissue'
         ? ` · ${opt.tissue === '__max__' ? 'highest tissue' : opt.tissue}` : '';
      $('#dataset-current').textContent = reg.datasetLegend(d, opt);
      toast(`${d.name}${where}: ${rows.length} receptors`);
   }

   datasetSelect.addEventListener('change', e => {
      if (e.target.value) loadDataset(e.target.value);
      e.target.value = '';
   });
   refSelect.addEventListener('change', () => { if (!muteDataset && activeDataset) loadDataset(activeDataset); });
   $('#dataset-tissue').addEventListener('change', () => { if (!muteDataset && activeDataset) loadDataset(activeDataset); });

   $$('[data-set]').forEach(btn => btn.addEventListener('click', () => {
      const set = btn.dataset.set;
      if (set === 'all') state.setRows([{ sel: 'all' }]);
      else if (set === 'clear') state.setRows([]);
      else if (set === 'structures') state.setRows(reg.receptors.filter(r => r.data && r.data.structures > 0).map(r => ({ sel: r.id })));
      else if (set === 'invert') {
         const marks = render.compute(state.get()).marks;
         state.setRows(reg.receptors.filter(r => !marks.has(r.id)).map(r => ({ sel: r.id })));
      }
   }));

   const EXAMPLES = {
      structures: () => loadDataset('structures', { valueScale: 'log', colorByValue: true, sizeByValue: true }),
      classes: () => applyText([
         'set labels=none sizeByValue=no colorByValue=no',
         'class:B1 fill=#b33c37 shape=diamond',
         'class:B2 fill=#7c3aa7 shape=diamond',
         'class:C fill=#f39841 shape=square',
         'class:F fill=#9dc947 shape=triangle',
         'ADRB* fill=gold shape=star size=10 label',
      ].join('\n')),
      list: () => applyText(['set labels=mapped', 'ADRB1', 'ADRB2', 'ADRB3', 'DRD2', 'HTR2A', 'OPRM1', 'CNR1', 'GLP1R', 'GCGR', 'SMO', 'GRM5', 'CASR'].join('\n')),
   };
   $$('[data-example]').forEach(btn => btn.addEventListener('click', () => EXAMPLES[btn.dataset.example]()));

   /* ---------- table (Handsontable) ---------- */
   const COLUMNS = [
      { data: 'sel', title: 'Receptor', width: 92 },
      { data: '_match', title: 'Match', width: 82, readOnly: true, renderer: matchRenderer },
      { data: 'value', title: 'Value', width: 52 },
      { data: 'fill', title: 'Fill', width: 72, renderer: colorRenderer },
      { data: 'size', title: 'Size', width: 40 },
      { data: 'shape', title: 'Shape', width: 74, type: 'dropdown', source: [''].concat(GPCRome.shapes.names) },
      { data: 'label', title: 'Label', width: 46, type: 'dropdown', source: ['', 'yes', 'no'] },
      { data: 'stroke', title: 'Outline', width: 78, renderer: colorRenderer },
      { data: 'opacity', title: 'Opacity', width: 60 },
      { data: 'text', title: 'Label text', width: 90 },
   ];
   const EXTRA_COLUMNS = [7, 8, 9];

   function validityRenderer(instance, td, row, col, prop, value) {
      Handsontable.renderers.TextRenderer.apply(this, arguments);
      if (prop !== 'sel' && value !== '' && value !== null && value !== undefined && typeof commands.parseField(prop, value) === 'string') {
         td.classList.add('cell-invalid');
         td.title = commands.parseField(prop, value);
      }
   }

   function colorRenderer(instance, td, row, col, prop, value) {
      validityRenderer.apply(this, arguments);
      if (value && GPCRome.colors.isColor(String(value))) {
         td.innerHTML = `<span class="swatch" style="background:${esc(value)}"></span>${esc(value)}`;
      }
   }

   function matchRenderer(instance, td, row) {
      Handsontable.renderers.TextRenderer.apply(this, arguments);
      const info = matchInfo[instance.toPhysicalRow(row)];
      td.classList.remove('ok', 'bad', 'warn');
      td.classList.add('match');
      if (!info) { td.textContent = ''; return; }
      if (info.kind === 'id') { td.textContent = '✓ ' + info.receptors[0].id; td.classList.add('ok'); }
      else if (info.receptors.length) {
         td.textContent = `✓ ${info.receptors.length} hits`;
         td.title = info.receptors.map(r => r.id).join(', ');
         td.classList.add('ok');
      }
      else if (info.kind === 'offtree') { td.textContent = 'not on tree'; td.classList.add('warn'); td.title = `${info.offTree.id}: ${info.offTree.cls}`; }
      else { td.textContent = '✗ not found'; td.classList.add('bad'); }
   }

   let matchInfo = [];
   let gridSync = false;

   const grid = new Handsontable($('#grid'), {
      data: [],
      columns: COLUMNS.map(c => Object.assign({ renderer: validityRenderer }, c)),
      colHeaders: true,
      rowHeaders: true,
      rowHeaderWidth: 34,
      height: 320,
      wordWrap: false,
      minSpareRows: 1,
      contextMenu: ['row_above', 'row_below', 'remove_row', '---------', 'undo', 'redo', '---------', 'copy', 'cut'],
      manualRowMove: true,
      manualColumnResize: true,
      hiddenColumns: { columns: EXTRA_COLUMNS, indicators: false },
      undo: false,
      outsideClickDeselects: true,
      licenseKey: 'non-commercial-and-evaluation',
      afterChange: (changes, source) => { if (source !== 'loadData' && !gridSync) pushGrid(); },
      afterRemoveRow: () => { if (!gridSync) pushGrid(); },
      afterRowMove: () => { if (!gridSync) pushGrid(); },
   });

   GPCRome.grid = grid;

   function pushGrid() {
      const rows = grid.getSourceData().map(r => {
         const o = {};
         state.ROW_FIELDS.forEach(f => { o[f] = r[f] === null || r[f] === undefined ? '' : r[f]; });
         return o;
      });
      state.setRows(rows, { source: 'grid' });
   }

   $('#all-columns').addEventListener('change', e => {
      const plugin = grid.getPlugin('hiddenColumns');
      if (e.target.checked) plugin.showColumns(EXTRA_COLUMNS); else plugin.hideColumns(EXTRA_COLUMNS);
      grid.render();
   });

   /* ---------- style controls ---------- */
   const shapePicker = $('#shape-picker');
   shapePicker.innerHTML = GPCRome.shapes.names.map(n => {
      const d = GPCRome.shapes.path(n, 7);
      return `<button type="button" data-value="${esc(n)}" title="${esc(n)}" aria-label="${esc(n)}"><svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="${d}"/></svg></button>`;
   }).join('');
   $$('[data-options="palettes"]').forEach(sel => Object.keys(GPCRome.colors.palettes).forEach(n => sel.insertAdjacentHTML('beforeend', `<option value="${n}">${n}</option>`)));

   const defaults = state.defaultSettings();
   $$('[data-setting]').forEach(input => {
      const key = input.dataset.setting;
      const handler = () => {
         let v;
         if (input.type === 'checkbox') v = input.checked;
         else if (typeof defaults[key] === 'number') { v = Number(input.value); if (!isFinite(v) || input.value === '') return; }
         else if (key === 'valueMin' || key === 'valueMax') {
            v = input.value.trim();
            if (v !== '' && !isFinite(Number(v))) { input.classList.add('invalid'); return; }
            input.classList.remove('invalid');
            v = v === '' ? '' : Number(v);
         } else v = input.value;
         state.setSettings({ [key]: v }, { coalesce: 'setting:' + key });
      };
      input.addEventListener(input.type === 'range' || input.type === 'color' || input.type === 'text' ? 'input' : 'change', handler);
   });

   $$('[data-choice]').forEach(group => {
      const key = group.dataset.choice;
      group.addEventListener('click', e => {
         const btn = e.target.closest('button[data-value]');
         if (!btn || btn.classList.contains('active')) return;
         const v = typeof defaults[key] === 'boolean' ? btn.dataset.value === 'true' : btn.dataset.value;
         state.setSettings({ [key]: v });
      });
   });

   /* Conditions for elements with data-when; ctx describes the mapped data */
   const WHEN = {
      singleColor: s => !s.colorByValue,
      gradient: s => s.colorByValue,
      fixedSize: s => !s.sizeByValue,
      sizeByValue: s => s.sizeByValue,
      byValue: (s, ctx) => (s.colorByValue || s.sizeByValue) && ctx.hasValues,
      missingValues: (s, ctx) => ctx.missingValues,
      noValues: (s, ctx) => (s.colorByValue || s.sizeByValue) && ctx.marks > 0 && !ctx.hasValues,
      outline: s => s.strokeWidth > 0,
      legend: s => s.legend,
      labelsNone: s => s.labels === 'none',
      labelsShown: (s, ctx) => s.labels !== 'none' || ctx.flaggedLabels,
      hasRows: (s, ctx) => ctx.rows > 0,
   };

   function dataContext(st) {
      const marks = [...render.last().marks.values()];
      return {
         rows: st.rows.length,
         marks: marks.length,
         hasValues: !!render.last().domain,
         missingValues: marks.some(m => typeof m.value !== 'number' || !isFinite(m.value)),
         flaggedLabels: st.rows.some(r => {
            const res = commands.parseField('label', r.label);
            return Array.isArray(res) && res[0] === 'yes';
         }),
      };
   }

   function syncControls(st) {
      const s = st.settings;
      $$('[data-setting]').forEach(input => {
         const v = s[input.dataset.setting];
         if (document.activeElement === input && input.type !== 'checkbox' && input.type !== 'range') return;
         if (input.type === 'checkbox') input.checked = !!v;
         else input.value = v;
         const out = input.parentElement.querySelector('output');
         if (out) out.textContent = v;
      });
      $$('[data-choice]').forEach(group => {
         const v = String(s[group.dataset.choice]);
         group.querySelectorAll('button[data-value]').forEach(b => {
            const on = b.dataset.value === v;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on);
         });
      });
      const ctx = dataContext(st);
      $$('[data-when]').forEach(el => { el.hidden = !WHEN[el.dataset.when](s, ctx); });
      $('#palette-preview').style.background = GPCRome.colors.gradientCss(s.palette, s.reversePalette);
   }

   $('#reset-style').addEventListener('click', () => {
      const d = state.defaultSettings();
      d.tree = state.get().settings.tree;
      state.setSettings(d);
   });

   /* ---------- tree classes ---------- */
   const counts = {};
   reg.receptors.forEach(r => { counts[r.cls] = (counts[r.cls] || 0) + 1; });
   const CLASS_SELECTOR = { rhodopsin: 'class:rhodopsin', rogues: 'class:rogues', orphan: 'class:orphan', adhesion: 'class:B2', secretin: 'class:B1', glutamate: 'class:C', frizzled: 'class:F', tas2: 'class:T2' };
   $('#class-list').innerHTML = reg.classes.slice().reverse().map(c => `
      <div class="class-row" data-cls="${c.id}">
         <input type="checkbox" title="Show/hide">
         <input type="color" title="Branch colour">
         <span class="class-name">${esc(c.name)}</span>
         <span class="count">${counts[c.id] || 0}</span>
         <button class="small" data-map="${c.id}" title="Add ${CLASS_SELECTOR[c.id]} to the table">map</button>
      </div>`).join('');
   $$('.class-row').forEach(row => {
      const cls = row.dataset.cls;
      row.querySelector('input[type=checkbox]').addEventListener('change', e => state.setSettings({ tree: { [cls]: { visible: e.target.checked } } }));
      row.querySelector('input[type=color]').addEventListener('input', e => state.setSettings({ tree: { [cls]: { color: e.target.value } } }, { coalesce: 'tree:' + cls }));
      row.querySelector('[data-map]').addEventListener('click', () => state.setRows(state.get().rows.concat([{ sel: CLASS_SELECTOR[cls] }])));
   });
   function treePatch(fn) {
      const t = {};
      reg.classes.forEach(c => { t[c.id] = fn(c); });
      state.setSettings({ tree: t });
   }
   $('#tree-show-all').addEventListener('click', () => treePatch(() => ({ visible: true })));
   $('#tree-grey').addEventListener('click', () => treePatch(() => ({ color: '#b4b4b4' })));
   $('#tree-reset').addEventListener('click', () => treePatch(c => ({ color: c.color })));

   function syncTree(s) {
      $$('.class-row').forEach(row => {
         const t = s.tree[row.dataset.cls];
         row.querySelector('input[type=checkbox]').checked = t.visible;
         row.querySelector('input[type=color]').value = t.color;
         row.classList.toggle('off', !t.visible);
      });
   }

   /* ---------- map, tooltip and info card ---------- */
   const tooltip = $('#tooltip');
   let selected = null;

   render.init($('#map'), {
      hover: (r, evt) => {
         if (!r) { tooltip.hidden = true; return; }
         const m = render.last().marks.get(r.id);
         const value = m && m.value !== undefined ? `<div>Value: <b>${render.fmt(m.value)}</b></div>` : '';
         tooltip.innerHTML = `<b>${esc(r.id)}</b> <span class="muted">${esc(reg.classById[r.cls].name)}</span>
            <div>${esc(r.gpcrdb ? r.gpcrdb.name : r.name)}</div>${value}`;
         const box = $('#map-area').getBoundingClientRect();
         tooltip.style.left = (evt.clientX - box.left + 14) + 'px';
         tooltip.style.top = (evt.clientY - box.top + 14) + 'px';
         tooltip.hidden = false;
      },
      select: r => { selected = r; showInfo(); },
   });

   function exactRows(r) {
      return state.get().rows.map((row, i) => [row, i]).filter(([row]) => {
         const res = reg.resolve(row.sel);
         return res.kind === 'id' && res.receptors[0] === r;
      });
   }

   function textOrLink(text, url, title) {
      const safe = esc(text);
      if (!url) return safe;
      const tip = title ? ` title="${esc(title)}"` : '';
      return `<a href="${esc(url)}" target="_blank" rel="noopener"${tip}>${safe}</a>`;
   }

   function drugLine(data, label, pairs) {
      const present = pairs.filter(([, key]) => data[key] != null);
      if (!present.some(([, key]) => data[key] > 0)) return null;
      return [label, present.map(([name, key, url, title]) => `${textOrLink(name, url, title)} ${esc(data[key])}`).join(' · ')];
   }

   function expressionLine(r, kind, label, url, title) {
      const peak = reg.expressionPeak(r.id, kind);
      if (!peak) return null;
      const unit = kind === 'mrna' ? ' TPM' : '';
      return [label, textOrLink(`${render.fmt(peak.value)}${unit} · highest in ${peak.tissue}`, url, title)];
   }

   function showInfo() {
      const card = $('#info-card');
      if (!selected) { card.hidden = true; return; }
      const r = selected;
      const m = render.last().marks.get(r.id);
      const g = r.gpcrdb;
      const rows = exactRows(r);
      const gpcrdbUrl = g ? `https://gpcrdb.org/protein/${g.entry_name}/` : '';
      const uniprotUrl = r.uniprot[0] ? `https://www.uniprot.org/uniprotkb/${r.uniprot[0]}/entry` : '';
      const chemblUrl = r.chembl[0] ? `https://www.ebi.ac.uk/chembl/explore/target/${r.chembl[0]}` : '';
      const gtopUrl = `https://www.guidetopharmacology.org/GRAC/DatabaseSearchForward?searchString=${encodeURIComponent(r.id)}&searchCategories=all&species=Human&type=all&comments=includeComments&order=rank&submit=Search+Database`;
      const hgncUrl = r.hgnc[0] ? `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${r.hgnc[0]}` : '';
      const proteinUrl = r.uniprot[0] ? `https://www.proteomicsdb.org/proteomicsdb/#protein/proteinDetails/${r.uniprot[0]}/summary` : '';
      const hpaUrl = `https://www.proteinatlas.org/search/${encodeURIComponent(r.id)}`;
      const drugcentralUrl = r.uniprot[0] ? `https://drugcentral.org/target/${r.uniprot[0]}` : '';
      const links = [
         gpcrdbUrl && ['GPCRdb', gpcrdbUrl],
         uniprotUrl && ['UniProt', uniprotUrl],
         ['GtoPdb', gtopUrl],
         chemblUrl && ['ChEMBL', chemblUrl],
         hgncUrl && ['HGNC', hgncUrl],
      ].filter(Boolean);
      const dl = [
         ['Class', esc(reg.classById[r.cls].name)],
         g && ['Family', textOrLink(g.family, gpcrdbUrl, 'Open family in GPCRdb')],
         g && ['Ligand type', textOrLink(g.ligand_type, gpcrdbUrl, 'Open ligand type in GPCRdb')],
         ['UniProt', textOrLink([r.uniprot[0], r.entry[0]].filter(Boolean).join(' · '), uniprotUrl, 'Open in UniProt')],
         r.data && r.data.structures != null && ['Structures', textOrLink(`${r.data.structures} (human ${r.data.structures_human})`, gpcrdbUrl, 'Open structures in GPCRdb')],
         r.data && r.data.structure_ligands != null && ['Ligands in structures', textOrLink(String(r.data.structure_ligands), gpcrdbUrl, 'Open in GPCRdb')],
         r.data && r.data.chembl_ligands > 0 && ['ChEMBL ligands', textOrLink(`${r.data.chembl_ligands} (${r.data.chembl_datapoints} datapoints)`, chemblUrl, 'Open in ChEMBL')],
         r.data && r.data.gtopdb_ligands > 0 && ['GtP ligands', textOrLink(String(r.data.gtopdb_ligands), gtopUrl, 'Open in Guide to Pharmacology')],
         r.data && drugLine(r.data, 'Approved drugs', [
            ['GPCRdb', 'gpcrdb_approved', gpcrdbUrl, 'Open in GPCRdb'],
            ['ChEMBL', 'chembl_approved', chemblUrl, 'Open in ChEMBL'],
            ['GtP', 'gtopdb_approved', gtopUrl, 'Open in Guide to Pharmacology'],
         ]),
         r.data && drugLine(r.data, 'Clinical candidates', [
            ['GPCRdb', 'gpcrdb_clinical', gpcrdbUrl, 'Open in GPCRdb'],
            ['ChEMBL', 'chembl_clinical', chemblUrl, 'Open in ChEMBL'],
         ]),
         r.data && r.data.gpcrdb_max_phase > 0 && ['Highest phase (GPCRdb)', textOrLink(String(r.data.gpcrdb_max_phase), gpcrdbUrl, 'Open in GPCRdb')],
         r.data && r.data.drugcentral_drugs > 0 && ['DrugCentral', textOrLink(`${r.data.drugcentral_drugs} drugs (${r.data.drugcentral_moa} with a mechanism)`, drugcentralUrl, 'Open in DrugCentral')],
         expressionLine(r, 'protein', 'Protein expression', proteinUrl, 'Open in ProteomicsDB'),
         expressionLine(r, 'mrna', 'mRNA expression', hpaUrl, 'Open in the Human Protein Atlas'),
      ].filter(Boolean);
      let mapped = '<p class="muted">Not in your map.</p>';
      if (m) {
         const st = m.style;
         mapped = `<p><span class="swatch" style="background:${esc(st.fill)}"></span>${esc(st.shape)}, size ${render.fmt(st.size)}` +
            (m.value !== undefined ? `, value <b>${render.fmt(m.value)}</b>` : '') +
            ` <span class="muted">(from ${m.rows.map(x => esc(x.sel)).join(', ')})</span></p>`;
      }
      card.innerHTML = `
         <button class="close" title="Close">×</button>
         <h4>${esc(r.id)}</h4>
         <div class="subtitle">${esc(g ? g.name : '')}${g ? ' · ' : ''}${esc(r.name)}</div>
         <dl>${dl.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
         ${mapped}
         <div class="links">${links.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}</div>
         <div class="button-row">
            ${rows.length ? '<button data-act="remove">Remove from table</button>' : '<button data-act="add" class="primary">Add to table</button>'}
            <button data-act="label">${m && (m.label === 'yes' || (m.label !== 'no' && state.get().settings.labels !== 'none')) ? 'Hide label' : 'Show label'}</button>
            <button data-act="zoom">Zoom</button>
         </div>`;
      card.hidden = false;
      card.querySelector('.close').onclick = () => { selected = null; card.hidden = true; };
      card.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => infoAction(b.dataset.act, r); });
   }

   function infoAction(act, r) {
      const rows = state.get().rows.map(x => Object.assign({}, x));
      const own = exactRows(r).map(([, i]) => i);
      if (act === 'add') rows.push({ sel: r.id });
      else if (act === 'remove') { own.reverse().forEach(i => rows.splice(i, 1)); }
      else if (act === 'label') {
         const m = render.last().marks.get(r.id);
         const shown = m && (m.label === 'yes' || (m.label !== 'no' && state.get().settings.labels !== 'none'));
         if (own.length) own.forEach(i => { rows[i].label = shown ? 'no' : 'yes'; });
         else rows.push({ sel: r.id, label: shown ? 'no' : 'yes' });
      } else if (act === 'zoom') { render.focus(r); return; }
      state.setRows(rows);
   }

   $('#zoom-in').addEventListener('click', () => render.zoom(1.4));
   $('#zoom-out').addEventListener('click', () => render.zoom(1 / 1.4));
   $('#zoom-fit').addEventListener('click', () => render.fit());

   /* ---------- search ---------- */
   const search = $('#search'), results = $('#search-results');
   let hits = [], active = 0;
   function showResults() {
      hits = reg.search(search.value, 10);
      active = 0;
      results.innerHTML = hits.map((r, i) => `<li data-i="${i}" class="${i === 0 ? 'active' : ''}"><b>${esc(r.id)}</b> <span>${esc(r.gpcrdb ? r.gpcrdb.name : r.name)}</span></li>`).join('') ||
         (search.value.trim() ? '<li class="none">No receptor found</li>' : '');
      results.hidden = !search.value.trim();
   }
   function choose(r) {
      if (!r) return;
      results.hidden = true;
      search.value = '';
      search.blur();
      selected = r;
      render.focus(r);
      showInfo();
   }
   search.addEventListener('input', showResults);
   search.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
         e.preventDefault();
         active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % Math.max(1, hits.length);
         results.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === active));
      } else if (e.key === 'Enter') choose(hits[active]);
      else if (e.key === 'Escape') { results.hidden = true; search.blur(); }
   });
   results.addEventListener('mousedown', e => {
      const li = e.target.closest('li[data-i]');
      if (li) choose(hits[Number(li.dataset.i)]);
   });
   search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));

   /* ---------- header actions ---------- */
   $('#undo').addEventListener('click', () => state.undo());
   $('#redo').addEventListener('click', () => state.redo());

   $('#share').addEventListener('click', async () => {
      const url = await state.shareLink();
      history.replaceState(null, '', url);
      try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard'); }
      catch (e) { toast('Link is in the address bar'); }
   });

   const menu = $('.menu-items');
   $('#download-btn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
   document.addEventListener('click', () => { menu.hidden = true; });
   menu.addEventListener('click', e => {
      const kind = e.target.dataset.export;
      if (kind === 'svg') GPCRome.exporter.svg();
      else if (kind === 'png2') GPCRome.exporter.png(2);
      else if (kind === 'png4') GPCRome.exporter.png(4);
      else if (kind === 'settings') GPCRome.exporter.settingsCSV();
      else if (kind === 'mapped') GPCRome.exporter.mappedCSV();
   });

   document.addEventListener('keydown', e => {
      const t = e.target;
      const typing = (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable) && !t.closest('.handsontable');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); return; }
      if (e.key === 'Escape') { $('#modal').hidden = true; selected = null; showInfo(); }
      if (typing || grid.getActiveEditor()?.isOpened()) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? state.redo() : state.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); state.redo(); }
   });

   /* ---------- quick start ---------- */
   const STEPS = [
      ['Welcome to the GPCRome mapper', `<p>Map your own receptor data on the tree of all ~400 non-olfactory human GPCRs and download a publication-ready figure.</p>
         <p>Everything runs in your browser – your data never leaves your computer.</p>`],
      ['1 · Add receptors', `<p>Paste receptors in the <b>Data</b> tab and press <b>Map</b>. Any identifier works: gene symbols, UniProt accessions or entry names, HGNC and ChEMBL IDs, old names and synonyms.</p>
         <p>Add a number to colour and size the markers by value: <code>ADRB2 7.5</code>, or upload a CSV/TSV file. Wildcards (<code>ADRB*</code>) and selectors (<code>class:B1</code>, <code>family:opioid</code>) select groups.</p>
         <p>To style several receptors at once, put the appearance on its own line and list them underneath, for example <code>fill=red shape=star size=8 opacity=0.6</code>. The next style line starts a new group.</p>
         <p>The dataset menu maps built-in counts: structures, ChEMBL and Guide to Pharmacology ligands, drugs and clinical phase, ProteomicsDB expression for a chosen tissue, and sequence identity to a reference receptor.</p>`],
      ['2 · Fine-tune in the table', `<p>The table works like a spreadsheet: edit cells, paste from Excel, reorder or delete rows (right-click).</p>
         <p>Per row you can set fill, size, shape, label and more. Later rows override earlier ones, so <code>all</code> grey followed by a few highlighted receptors is easy.</p>`],
      ['3 · Style the map', `<p>The <b>Style</b> tab sets defaults for markers, value colouring and labels. The <b>Tree</b> tab toggles and recolours each GPCR class.</p>
         <p>Hover a receptor for details, click it for links to GPCRdb, UniProt, GtoPdb and ChEMBL. Labels are spaced clear of each other and the markers; drag a label to move it, or double-click it to reset.</p>`],
      ['4 · Save and share', `<p><b>Download</b> the map as SVG (vector) or PNG, and your table plus settings as CSV – upload that CSV later to continue.</p>
         <p><b>Share link</b> copies a URL that restores this exact map. Undo/redo with ⌘/Ctrl+Z.</p>`],
   ];
   const ABOUT = ['How to cite', `<p>This GPCR tree mapper is developed by Albert J. Kooistra in the
      <a href="https://dsdd.one/" target="_blank" rel="noopener">Data Science for Drug Design</a> research group at the University of Copenhagen, in collaboration with Chris de Graaf (<a href="https://structuretx.com/" target="_blank" rel="noopener">Structure Therapeutics</a>).</p>
      <p>The tree is based on the modified GPCR tree presented by <a href="https://www.nature.com/articles/nrd3859" target="_blank" rel="noopener">Stevens, Katritch <i>et al.</i></a> and the original tree by
      <a href="https://molpharm.aspetjournals.org/content/63/6/1256" target="_blank" rel="noopener">Fredriksson <i>et al.</i></a>. It was updated using refined sequence alignments focusing on the 7TM bundle; names and reference sequences follow the latest UniProt.</p>
      <p>Annotation and the built-in datasets come from <a href="https://gpcrdb.org" target="_blank" rel="noopener">GPCRdb</a>, <a href="https://www.uniprot.org/" target="_blank" rel="noopener">UniProt</a>, <a href="https://www.ebi.ac.uk/chembl/" target="_blank" rel="noopener">ChEMBL</a>, <a href="https://www.guidetopharmacology.org/" target="_blank" rel="noopener">Guide to Pharmacology</a>, <a href="https://www.proteomicsdb.org/" target="_blank" rel="noopener">ProteomicsDB</a>, <a href="https://www.proteinatlas.org/" target="_blank" rel="noopener">Human Protein Atlas</a> and <a href="https://drugcentral.org/" target="_blank" rel="noopener">DrugCentral</a>.</p>
      <p>The publication is in preparation. Please cite:<br><b>Kooistra AJ, de Graaf C. GPCR Tree Mapper. Accessed [date].</b></p>`];
   let step = 0, pages = STEPS;
   function showModal(list, i) {
      pages = list; step = i || 0;
      const [title, body] = pages[step];
      $('#modal-content').innerHTML = `<h2>${title}</h2>${body}`;
      $('#modal-steps').textContent = pages.length > 1 ? `${step + 1} / ${pages.length}` : '';
      $('#modal-prev').hidden = step === 0;
      $('#modal-next').textContent = step === pages.length - 1 ? 'Start mapping' : 'Next';
      $('#modal').hidden = false;
   }
   $('#modal-next').addEventListener('click', () => {
      if (step < pages.length - 1) showModal(pages, step + 1);
      else { $('#modal').hidden = true; localStorage.setItem('gpcrome-tutorial-seen', '1'); }
   });
   $('#modal-prev').addEventListener('click', () => showModal(pages, step - 1));
   $('.modal-close').addEventListener('click', () => { $('#modal').hidden = true; localStorage.setItem('gpcrome-tutorial-seen', '1'); });
   $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });
   $('#help').addEventListener('click', () => showModal(STEPS));
   $('#about-link').addEventListener('click', e => { e.preventDefault(); showModal([ABOUT]); });
   $('#data-date').textContent = reg.updated;

   /* ---------- state -> view ---------- */
   function update(s, source) {
      render.draw(s);
      matchInfo = render.last().rowMatches;
      if (source !== 'grid') {
         gridSync = true;
         grid.loadData(s.rows.map(r => Object.assign({}, r)));
         gridSync = false;
      } else grid.render();
      syncControls(s);
      syncTree(s.settings);
      $('#undo').disabled = !state.canUndo();
      $('#redo').disabled = !state.canRedo();
      $('#empty-hint').hidden = s.rows.length > 0 || s.settings.labels === 'all';

      const missing = s.rows.map((row, i) => [row, matchInfo[i]]).filter(([, m]) => !m.receptors.length);
      const off = missing.filter(([, m]) => m.kind === 'offtree');
      const none = missing.filter(([, m]) => m.kind !== 'offtree');
      let html = '';
      if (none.length) html += `<p class="bad">Not found (${none.length}): ${none.slice(0, 30).map(([r]) => esc(r.sel)).join(', ')}${none.length > 30 ? ', …' : ''}</p>`;
      if (off.length) html += `<p class="warn">Not on the tree, mostly olfactory receptors (${off.length}): ${off.slice(0, 30).map(([r]) => esc(r.sel)).join(', ')}${off.length > 30 ? ', …' : ''}</p>`;
      $('#unmatched').innerHTML = html;
      if (selected) showInfo();
   }
   state.subscribe(update);

   /* ---------- start-up: share link, URL parameters, saved session ---------- */
   async function start() {
      const params = new URLSearchParams(location.search);
      let loaded = false;
      if (location.hash.includes('s=')) {
         try { const snap = await state.fromShareHash(location.hash); if (snap) { state.load(snap); loaded = true; } }
         catch (e) { toast('Could not read the shared link'); }
      }
      if (!loaded && (params.get('ids') || params.get('data'))) {
         const text = params.get('data') || params.get('ids').split(/[,;\s]+/).join('\n');
         applyText(text, false);
         loaded = true;
      }
      if (!loaded) state.restore();
      update(state.get());
      if (!localStorage.getItem('gpcrome-tutorial-seen') && !loaded) showModal(STEPS);
   }

   /* External tools (e.g. a KNIME node or a parent page) can post data: {type: 'gpcrome', data: '...', append: false} */
   window.addEventListener('message', e => {
      if (e.data && e.data.type === 'gpcrome' && typeof e.data.data === 'string') applyText(e.data.data, !!e.data.append);
   });

   start();
})();
