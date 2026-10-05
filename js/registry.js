/* Receptor registry: identifier lookup and selector resolution */
window.GPCRome = window.GPCRome || {};

GPCRome.registry = (function () {
   const data = window.GPCROME_DATA;
   const tree = window.GPCROME_TREE;
   const receptors = data.receptors;
   const classes = tree.classes;
   const classById = Object.fromEntries(classes.map(c => [c.id, c]));

   const CLASS_ALIASES = {
      a: ['rhodopsin', 'rogues'], rhodopsin: ['rhodopsin'], rogues: ['rogues'],
      b: ['secretin', 'adhesion'], b1: ['secretin'], secretin: ['secretin'], b2: ['adhesion'], adhesion: ['adhesion'],
      c: ['glutamate'], glutamate: ['glutamate'], f: ['frizzled'], frizzled: ['frizzled'],
      t: ['tas2'], t2: ['tas2'], tas2: ['tas2'], taste2: ['tas2'], orphan: ['orphan'], other: ['orphan'],
      v: ['vomeronasal'], v1: ['vomeronasal'], vomeronasal: ['vomeronasal'],
      o: ['olfactory1', 'olfactory2'], olfactory: ['olfactory1', 'olfactory2'], o1: ['olfactory1'], o2: ['olfactory2'],
   };

   const norm = s => String(s).trim().toUpperCase().replace(/\s+/g, ' ');

   const byId = {};
   const index = new Map();
   const offTreeIndex = new Map();
   // Wildcards only match official identifiers; historical synonyms give surprising hits
   const wildIndex = new Map();

   function keysFor(r) {
      const keys = [...r.synonyms];
      if (r.gpcrdb) keys.push(r.gpcrdb.name, r.gpcrdb.entry_name, r.gpcrdb.entry_name.replace(/_human$/i, ''));
      keys.push(...r.chembl, ...r.hgnc, ...r.uniprot);
      r.entry.forEach(e => keys.push(e, e.replace(/_HUMAN$/, '')));
      keys.push(r.id);
      return keys;
   }

   // Insert in increasing priority so official identifiers win over aliases
   receptors.forEach(r => {
      byId[r.id] = r;
      const keys = [r.id, ...r.uniprot, ...r.entry, ...r.entry.map(e => e.replace(/_HUMAN$/, ''))];
      if (r.gpcrdb) keys.push(r.gpcrdb.entry_name);
      keys.forEach(k => wildIndex.set(norm(k), r));
   });
   [r => r.synonyms, r => keysFor(r).slice(r.synonyms.length, -1), r => [r.id]].forEach(pick => {
      receptors.forEach(r => pick(r).forEach(k => k && index.set(norm(k), r)));
   });
   data.offTree.forEach(o => {
      [o.id, o.entry, o.entry.replace(/_human$/i, ''), o.uniprot].forEach(k => {
         if (k && !index.has(norm(k))) offTreeIndex.set(norm(k), o);
      });
   });

   function lookup(id) {
      return index.get(norm(id)) || null;
   }

   /*
    * Whole families by name: the GPCRdb receptor families (Chemokine receptors, Adenosine receptors, ...) and
    * ligand types (Aminergic receptors, Peptide receptors, ...), each also without its trailing "receptors".
    */
   const groups = new Map();
   receptors.forEach(r => {
      if (!r.gpcrdb) return;
      [r.gpcrdb.family, r.gpcrdb.ligand_type].forEach(name => {
         const key = name.toLowerCase();
         [key, key.replace(/ receptors?$/, '')].forEach(k => {
            if (!groups.has(k)) groups.set(k, new Set());
            groups.get(k).add(r);
         });
      });
   });

   /* Receptors of the groups named `term`: exactly, else those whose name starts with it (3 letters or more) */
   function group(term) {
      const t = term.toLowerCase().trim();
      if (groups.has(t)) return [...groups.get(t)];
      if (t.length < 3) return [];
      const hits = new Set();
      groups.forEach((set, k) => { if (k.startsWith(t)) set.forEach(r => hits.add(r)); });
      return [...hits];
   }

   function globToRegex(glob) {
      const escaped = norm(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&');
      return new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
   }

   function unique(list) {
      return [...new Set(list)];
   }

   /*
    * Resolve a selector to receptors. Supported:
    *   ADRB2 | P07550 | adrb2_human | HGNC:286 | ...   single identifier
    *   ADRB* | GPR1??                                   wildcards on any identifier
    *   all | *                                          every receptor on the tree
    *   class:secretin | class:B1 | @secretin            GPCR class (branch)
    *   family:adenosine                                 GPCRdb receptor family or ligand type (substring)
    *   ligand:peptide                                   GPCRdb ligand type (substring)
    *   chemokine | aminergic | adenosine                a whole family or ligand type by name
    */
   function resolve(selector) {
      const sel = String(selector || '').trim();
      if (!sel) return { kind: 'empty', receptors: [] };
      const lower = sel.toLowerCase();
      if (lower === 'all' || sel === '*') return { kind: 'all', receptors: receptors.slice() };

      const m = sel.match(/^(class|family|ligand|@)\s*:?\s*(.+)$/i);
      if (m) {
         const type = m[1].toLowerCase(), term = m[2].trim().toLowerCase();
         if (type === 'class' || type === '@') {
            const ids = CLASS_ALIASES[term.replace(/^class\s*/, '').replace(/\s+/g, '')] ||
               classes.filter(c => c.name.toLowerCase().includes(term)).map(c => c.id);
            return { kind: 'class', receptors: receptors.filter(r => ids.includes(r.cls)) };
         }
         const fields = type === 'family' ? ['family', 'ligand_type'] : ['ligand_type'];
         return {
            kind: type,
            receptors: receptors.filter(r => r.gpcrdb && fields.some(f => r.gpcrdb[f].toLowerCase().includes(term))),
         };
      }

      if (/[*?]/.test(sel)) {
         const re = globToRegex(sel);
         const hits = [];
         wildIndex.forEach((r, key) => { if (re.test(key)) hits.push(r); });
         return { kind: 'wildcard', receptors: unique(hits) };
      }

      const r = lookup(sel);
      if (r) return { kind: 'id', receptors: [r] };
      const off = offTreeIndex.get(norm(sel));
      if (off) return { kind: 'offtree', receptors: [], offTree: off };
      const family = group(sel);
      if (family.length) return { kind: 'family', receptors: family };
      return { kind: 'none', receptors: [] };
   }

   /* Up to `limit` receptors whose identifiers or names contain the query */
   const GREEK = { 'Α': 'ALPHA', 'Β': 'BETA', 'Γ': 'GAMMA', 'Δ': 'DELTA', 'Κ': 'KAPPA', 'Μ': 'MU' };
   const searchNorm = s => norm(s).replace(/[ΑΒΓΔΚΜ]/g, c => GREEK[c]).replace(/[\s-]+/g, '');

   function search(query, limit) {
      const words = String(query).trim().split(/\s+/).map(searchNorm).filter(Boolean);
      const q = words.join('');
      if (!q) return [];
      const scored = [];
      receptors.forEach(r => {
         let best = Infinity;
         if (r.id.startsWith(q)) best = 0;
         else {
            const keys = keysFor(r).concat(r.name).map(searchNorm);
            for (const K of keys) {
               if (K === q) { best = Math.min(best, 1); break; }
               if (K.startsWith(q)) best = Math.min(best, 2);
               else if (K.includes(q)) best = Math.min(best, 3);
            }
            if (best === Infinity && words.length > 1) {
               const all = keys.join('|');
               if (words.every(w => all.includes(w))) best = 4;
            }
         }
         if (best < Infinity) scored.push([best, r]);
      });
      scored.sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id));
      return scored.slice(0, limit || 10).map(s => s[1]);
   }

   function displayName(r, type) {
      if (type === 'entry') return (r.entry[0] || r.id + '_HUMAN').toLowerCase();
      if (type === 'gpcrdb') return r.gpcrdb ? r.gpcrdb.name : r.id;
      return r.id;
   }

   const extra = window.GPCROME_EXTRA || {};
   let sequenceCache = null;

   function sequenceTable() {
      if (sequenceCache) return sequenceCache;
      const seq = extra.sequence;
      if (!seq || !seq.genes) return null;
      const bins = {};
      ['identity_7tm', 'similarity_7tm', 'identity_full', 'similarity_full'].forEach(key => {
         if (seq[key]) bins[key] = atob(seq[key]);
      });
      sequenceCache = { genes: seq.genes, n: seq.genes.length, bins, index: Object.fromEntries(seq.genes.map((g, i) => [g, i])) };
      return sequenceCache;
   }

   function matrixValue(bin, index) {
      const o = index * 2;
      return (bin.charCodeAt(o) + bin.charCodeAt(o + 1) * 256) / 10;
   }

   function sharedCount(a, b) {
      if (!a || !b || !a.length || !b.length) return 0;
      const small = a.length < b.length ? a : b;
      const large = small === a ? b : a;
      const set = new Set(large);
      let n = 0;
      for (let i = 0; i < small.length; i++) if (set.has(small[i])) n++;
      return n;
   }

   function countValues(d) {
      return receptors.filter(r => r.data && typeof r.data[d.id] === 'number' && r.data[d.id] > 0)
         .map(r => ({ sel: r.id, value: r.data[d.id] }));
   }

   function referenceValues(d, ref) {
      if (d.matrix === 'chembl' || d.matrix === 'gtp') {
         const table = (extra.ligands || {})[d.matrix] || {};
         const base = table[ref] || [];
         return receptors.filter(r => table[r.id] && table[r.id].length)
            .map(r => ({ sel: r.id, value: sharedCount(base, table[r.id]) }))
            .filter(row => row.value > 0);
      }
      const seq = sequenceTable();
      if (!seq || seq.index[ref] === undefined || !seq.bins[d.matrix]) return [];
      const bin = seq.bins[d.matrix];
      const j = seq.index[ref];
      return receptors.filter(r => seq.index[r.id] !== undefined).map(r => ({
         sel: r.id,
         value: matrixValue(bin, seq.index[r.id] * seq.n + j),
      })).filter(row => row.value > 0);
   }

   function tissueValues(d, tissue) {
      const table = (extra.expression || {})[d.expr];
      if (!table) return [];
      const highest = !tissue || tissue === '__max__';
      const idx = highest ? -1 : table.tissues.indexOf(tissue);
      if (!highest && idx < 0) return [];
      const rows = [];
      receptors.forEach(r => {
         const vals = table.values[r.id];
         if (!vals) return;
         let value = null;
         if (highest) {
            vals.forEach(v => { if (typeof v === 'number' && (value === null || v > value)) value = v; });
         } else value = vals[idx];
         if (typeof value === 'number' && value > 0) rows.push({ sel: r.id, value });
      });
      return rows;
   }

   function datasetValues(d, opt) {
      opt = opt || {};
      if (!d) return [];
      if (d.kind === 'reference') return referenceValues(d, opt.ref);
      if (d.kind === 'tissue') return tissueValues(d, opt.tissue);
      return countValues(d);
   }

   function datasetLegend(d, opt) {
      opt = opt || {};
      if (!d) return '';
      if (d.kind === 'reference') return `${d.name} · ${opt.ref || ''}`;
      if (d.kind === 'tissue') return `${d.name} · ${!opt.tissue || opt.tissue === '__max__' ? 'highest tissue' : opt.tissue}`;
      return d.name;
   }

   function tissuesFor(d) {
      const table = extra.expression && extra.expression[d.expr];
      return table ? table.tissues.slice() : [];
   }

   /* Highest measured value, for the info card. */
   function expressionPeak(id, kind) {
      const table = extra.expression && extra.expression[kind];
      const vals = table && table.values[id];
      if (!vals) return null;
      let best = null, tissue = '';
      vals.forEach((v, i) => {
         if (typeof v === 'number' && v > 0 && (best === null || v > best)) { best = v; tissue = table.tissues[i]; }
      });
      return best === null ? null : { value: best, tissue, unit: table.unit };
   }

   return { receptors, classes, classById, byId, datasets: data.datasets, updated: data.updated,
            lookup, resolve, search, displayName, datasetValues, datasetLegend, tissuesFor, expressionPeak };
})();
