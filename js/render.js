/* SVG rendering of the tree, receptor markers, labels and legend, plus zoom/pan and interaction */
window.GPCRome = window.GPCRome || {};

GPCRome.render = (function () {
   const NS = 'http://www.w3.org/2000/svg';
   const TREE = window.GPCROME_TREE;
   const SCALE = 2;
   const PAD = 50;
   const W = TREE.width * SCALE, H = TREE.height * SCALE;
   const FULL = { x: -PAD, y: -PAD, w: W + 2 * PAD, h: H + 2 * PAD };
   const FONT = 'Helvetica, Arial, sans-serif';

   const reg = GPCRome.registry;
   let svg, layers = {}, probe, view = Object.assign({}, FULL);
   let content = Object.assign({}, FULL);
   let fitted = true;
   let handlers = { select: () => {}, hover: () => {} };
   let lastComputed = null;
   const metricCache = new Map();
   const CENTROID = (() => {
      let x = 0, y = 0;
      reg.receptors.forEach(r => { x += r.x; y += r.y; });
      const n = reg.receptors.length || 1;
      return { x: (x / n) * SCALE, y: (y / n) * SCALE };
   })();

   function el(name, attrs, parent) {
      const node = document.createElementNS(NS, name);
      Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
      if (parent) parent.appendChild(node);
      return node;
   }

   function fmt(v) {
      if (!isFinite(v)) return '';
      const a = Math.abs(v);
      if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
      return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(3)));
   }

   /* ---------- computation ---------- */

   /*
    * Apply table rows in order: later rows override properties of earlier ones.
    * Returns marks per receptor, match information per row and the value domain.
    */
   function compute(state) {
      const marks = new Map();
      const rowMatches = state.rows.map(row => {
         const res = reg.resolve(row.sel);
         res.receptors.forEach(r => {
            let m = marks.get(r.id);
            if (!m) { m = { r, rows: [] }; marks.set(r.id, m); }
            m.rows.push(row);
            GPCRome.state.ROW_FIELDS.forEach(f => {
               if (f === 'sel') return;
               const res = GPCRome.commands.parseField(f, row[f]);
               if (Array.isArray(res) && res[0] !== '') m[f] = res[0];
            });
         });
         return res;
      });

      const s = state.settings;
      const log = s.valueScale === 'log';
      const tf = log ? v => (v > 0 ? Math.log10(v) : NaN) : v => v;
      const usable = v => typeof v === 'number' && isFinite(tf(v));
      const values = [...marks.values()].map(m => m.value).filter(usable);
      let domain = null;
      if (values.length) {
         const lo = s.valueMin === '' || !usable(Number(s.valueMin)) ? Math.min(...values) : Number(s.valueMin);
         const hi = s.valueMax === '' || !usable(Number(s.valueMax)) ? Math.max(...values) : Number(s.valueMax);
         const mid = (tf(lo) + tf(hi)) / 2;
         domain = [lo, hi, log ? Math.pow(10, mid) : mid];
      }
      const norm = v => (domain[1] === domain[0] ? 0.5 : (tf(v) - tf(domain[0])) / (tf(domain[1]) - tf(domain[0])));

      marks.forEach(m => {
         const hasValue = usable(m.value) && domain;
         const t = hasValue ? Math.min(1, Math.max(0, norm(m.value))) : null;
         m.style = {
            fill: m.fill || (hasValue && s.colorByValue ? GPCRome.colors.sample(s.palette, t, s.reversePalette) : s.fill),
            size: m.size !== undefined && m.size !== '' ? m.size :
               (hasValue && s.sizeByValue ? s.sizeMin + t * (s.sizeMax - s.sizeMin) : s.size),
            shape: m.shape || s.shape,
            stroke: m.stroke || s.stroke,
            opacity: m.opacity !== undefined && m.opacity !== '' ? m.opacity : s.opacity,
         };
      });
      lastComputed = { marks, rowMatches, domain };
      return lastComputed;
   }

   /* ---------- drawing ---------- */

   function init(container, callbacks) {
      Object.assign(handlers, callbacks);
      svg = el('svg', {
         xmlns: NS, viewBox: `${FULL.x} ${FULL.y} ${FULL.w} ${FULL.h}`, 'font-family': FONT,
         class: 'gpcrome-map',
      }, container);
      const defs = el('defs', {}, svg);
      layers.gradient = el('linearGradient', { id: 'gpcrome-legend-gradient', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
      layers.bg = el('rect', { x: FULL.x, y: FULL.y, width: FULL.w, height: FULL.h, fill: '#ffffff', class: 'bg' }, svg);
      layers.tree = el('g', { class: 'tree', transform: `scale(${SCALE})`, 'stroke-linecap': 'round', fill: 'none' }, svg);
      layers.classes = {};
      TREE.classes.forEach(c => {
         const g = el('g', { 'data-cls': c.id, stroke: c.color }, layers.tree);
         TREE.segments[c.id].forEach(([x1, y1, x2, y2, w, op]) => {
            el('line', { x1, y1, x2, y2, 'data-w': w, 'stroke-width': w, 'stroke-opacity': op || TREE.defaultOpacity }, g);
         });
         TREE.paths[c.id].forEach(p => {
            const attrs = { d: p.d };
            if (p.mode === 'stroke') Object.assign(attrs, { 'stroke-width': p.width, 'data-w': p.width, 'stroke-opacity': p.opacity });
            else Object.assign(attrs, { stroke: 'none', fill: c.color, 'fill-opacity': p.opacity, 'data-fill': '1' });
            el('path', attrs, g);
         });
         layers.classes[c.id] = g;
      });
      layers.unmapped = el('g', { class: 'unmapped' }, svg);
      layers.markers = el('g', { class: 'markers' }, svg);
      layers.hits = el('g', { class: 'hits', 'data-export': 'no' }, svg);
      layers.leaders = el('g', { class: 'leaders', 'pointer-events': 'none' }, svg);
      layers.labels = el('g', { class: 'labels' }, svg);
      layers.legend = el('g', { class: 'legend' }, svg);
      layers.highlight = el('g', { class: 'highlight', 'data-export': 'no' }, svg);
      probe = el('text', {
         x: 0, y: 0, 'text-anchor': 'middle', 'font-family': FONT,
         visibility: 'hidden', 'pointer-events': 'none', 'data-export': 'no',
      }, svg);

      reg.receptors.forEach(r => {
         el('circle', { cx: r.x * SCALE, cy: r.y * SCALE, r: 5, 'data-id': r.id, fill: 'transparent' }, layers.hits);
      });

      bindInteraction();
   }

   function drawTree(s) {
      TREE.classes.forEach(c => {
         const g = layers.classes[c.id], t = s.tree[c.id];
         g.setAttribute('display', t.visible ? 'inline' : 'none');
         g.setAttribute('stroke', t.color);
         g.setAttribute('opacity', s.treeOpacity);
         g.querySelectorAll('[data-w]').forEach(n => n.setAttribute('stroke-width', n.dataset.w * s.treeWidth));
         g.querySelectorAll('[data-fill]').forEach(n => n.setAttribute('fill', t.color));
      });
   }

   /* Glyph box for a label. dx/dy shift the text anchor so the glyphs are centred on (cx, cy). */
   function textBox(text, fontSize, weight, style) {
      const key = fontSize + '\0' + weight + '\0' + style + '\0' + text;
      const cached = metricCache.get(key);
      if (cached) return cached;
      const halo = fontSize * 0.16;
      probe.setAttribute('font-size', fontSize);
      probe.setAttribute('font-weight', weight || 'normal');
      probe.setAttribute('font-style', style || 'normal');
      probe.textContent = text || ' ';
      const bb = probe.getBBox();
      const box = bb.width > 0 ? {
         w: bb.width + halo * 2,
         h: bb.height + halo * 2,
         dx: -(bb.x + bb.width / 2),
         dy: -(bb.y + bb.height / 2),
      } : {
         w: Math.max(8, String(text).length * fontSize * 0.62 + halo * 2),
         h: fontSize + halo * 2,
         dx: 0,
         dy: fontSize * 0.35,
      };
      metricCache.set(key, box);
      return box;
   }

   /*
    * Put every label just outside its receptor, along the leaf direction.
    * If that spot hits another label, a marker, a branch tip or the legend,
    * take the nearest clear spot further along the leaf or a short step sideways.
    * Labels the user has dragged stay put and the others move around them.
    */
   function layoutLabels(items, obstacles, blockers, fontSize) {
      if (!items.length) return;
      const gapL = Math.max(1.6, fontSize * 0.14);
      const gapM = Math.max(2.0, fontSize * 0.16);
      const tangWeight = 1.25;
      const rings = 22;
      const tangSteps = 14;

      items.forEach(L => {
         const support = Math.abs(L.cos) * L.w / 2 + Math.abs(L.sin) * L.h / 2;
         L.base = L.ownR + gapM + support;
         L.idealCx = L.px + L.cos * L.base;
         L.idealCy = L.py + L.sin * L.base;
         L.cx = L.pinned ? L.idealCx + L.offx : L.idealCx;
         L.cy = L.pinned ? L.idealCy + L.offy : L.idealCy;
         L.extra = 0;
         L.tang = 0;
      });

      function edgePenalty(L, x, y) {
         const m = 4;
         const left = x - L.w / 2, right = x + L.w / 2, top = y - L.h / 2, bot = y + L.h / 2;
         let p = 0;
         if (left < FULL.x + m) p += FULL.x + m - left;
         if (right > FULL.x + FULL.w - m) p += right - (FULL.x + FULL.w - m);
         if (top < FULL.y + m) p += FULL.y + m - top;
         if (bot > FULL.y + FULL.h - m) p += bot - (FULL.y + FULL.h - m);
         return p * 2.5;
      }

      function lineHitsMarker(L, x2, y2) {
         const dx = x2 - L.px, dy = y2 - L.py;
         const len = Math.hypot(dx, dy);
         const inset = L.ownR + 0.8;
         if (len < inset + 6) return false;
         const x1 = L.px + dx / len * inset, y1 = L.py + dy / len * inset;
         const sx = x2 - x1, sy = y2 - y1;
         const len2 = sx * sx + sy * sy;
         for (let i = 0; i < obstacles.length; i++) {
            const M = obstacles[i];
            if (!M.solid || M.id === L.id) continue;
            let t = ((M.x - x1) * sx + (M.y - y1) * sy) / len2;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const px = x1 + t * sx - M.x, py = y1 + t * sy - M.y;
            const clear = M.r + 1.1;
            if (px * px + py * py < clear * clear) return true;
         }
         return false;
      }

      function overlaps(L, x, y, placed) {
         const hw = L.w / 2, hh = L.h / 2;
         for (let i = 0; i < placed.length; i++) {
            const P = placed[i];
            if (P === L) continue;
            if ((P.w + L.w) / 2 + gapL - Math.abs(P.cx - x) > 0.2 &&
               (P.h + L.h) / 2 + gapL - Math.abs(P.cy - y) > 0.2) return true;
         }
         for (let i = 0; i < obstacles.length; i++) {
            const M = obstacles[i];
            if (Math.abs(M.x - x) > hw + M.r + gapM) continue;
            if (Math.abs(M.y - y) > hh + M.r + gapM) continue;
            const left = x - hw, right = x + hw, top = y - hh, bot = y + hh;
            if (left < M.x && M.x < right && top < M.y && M.y < bot) return true;
            const qx = Math.max(left, Math.min(M.x, right));
            const qy = Math.max(top, Math.min(M.y, bot));
            if (Math.hypot(qx - M.x, qy - M.y) < M.r + gapM - 0.35) return true;
         }
         for (let i = 0; i < blockers.length; i++) {
            const R = blockers[i];
            if (x + hw > R.x && x - hw < R.x + R.w && y + hh > R.y && y - hh < R.y + R.h) return true;
         }
         return false;
      }

      function spot(L, ring, t) {
         const extra = ring * (L.h + gapL);
         const unit = Math.max(6, L.h * 0.9);
         const tang = t === 0 ? 0 : (t % 2 ? 1 : -1) * Math.ceil(t / 2) * unit;
         return {
            extra, tang,
            x: L.px + L.cos * (L.base + extra) - L.sin * tang,
            y: L.py + L.sin * (L.base + extra) + L.cos * tang,
         };
      }

      function leaderClips(L, x, y) {
         const qx = Math.max(x - L.w / 2, Math.min(L.px, x + L.w / 2));
         const qy = Math.max(y - L.h / 2, Math.min(L.py, y + L.h / 2));
         return lineHitsMarker(L, qx, qy);
      }

      function search(L, placed) {
         let best = null, bestCost = Infinity;
         const home = spot(L, 0, 0);
         for (let ring = 0; ring < rings; ring++) {
            if (ring * (L.h + gapL) >= bestCost) break;
            for (let t = 0; t <= tangSteps; t++) {
               const c = spot(L, ring, t);
               let cost = c.extra + Math.abs(c.tang) * tangWeight + edgePenalty(L, c.x, c.y);
               if (cost >= bestCost) continue;
               if (overlaps(L, c.x, c.y, placed)) continue;
               if (leaderClips(L, c.x, c.y)) cost += 46;
               if (cost >= bestCost) continue;
               best = c;
               bestCost = cost;
               if (cost === 0) return best;
            }
         }
         return best || home;
      }

      const placed = items.filter(L => L.pinned);
      const free = items.filter(L => !L.pinned).sort((a, b) =>
         Math.atan2(a.py - CENTROID.y, a.px - CENTROID.x) - Math.atan2(b.py - CENTROID.y, b.px - CENTROID.x) ||
         (a.id < b.id ? -1 : 1));
      free.forEach(L => {
         const c = search(L, placed);
         L.cx = c.x; L.cy = c.y; L.extra = c.extra; L.tang = c.tang;
         placed.push(L);
      });
   }

   function pointRadius(m, s) {
      if (m) {
         let rad = m.style.size * GPCRome.shapes.extent(m.style.shape);
         if (m.style.stroke !== 'none') rad += s.strokeWidth * 0.5;
         return rad;
      }
      return s.unmapped === 'dots' ? 1.8 : 1.7;
   }

   function includeLabelBounds(items) {
      let x0 = FULL.x, y0 = FULL.y, x1 = FULL.x + FULL.w, y1 = FULL.y + FULL.h;
      const m = 8;
      items.forEach(L => {
         x0 = Math.min(x0, L.cx - L.w / 2 - m);
         y0 = Math.min(y0, L.cy - L.h / 2 - m);
         x1 = Math.max(x1, L.cx + L.w / 2 + m);
         y1 = Math.max(y1, L.cy + L.h / 2 + m);
      });
      content = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
   }

   function leaderEnds(L, mode) {
      const left = L.cx - L.w / 2, right = L.cx + L.w / 2, top = L.cy - L.h / 2, bot = L.cy + L.h / 2;
      const qx = Math.max(left, Math.min(L.px, right));
      const qy = Math.max(top, Math.min(L.py, bot));
      const dx = qx - L.px, dy = qy - L.py;
      const dist = Math.hypot(dx, dy);
      const always = mode === 'on';
      if (dist < L.ownR + (always ? 1.6 : 7)) return null;
      const ux = dx / dist, uy = dy / dist;
      const x1 = L.px + ux * (L.ownR + 0.7), y1 = L.py + uy * (L.ownR + 0.7);
      const x2 = qx - ux, y2 = qy - uy;
      if (Math.hypot(x2 - x1, y2 - y1) < (always ? 1.2 : 4)) return null;
      return { x1, y1, x2, y2 };
   }

   function draw(state) {
      const s = state.settings;
      const { marks, domain } = compute(state);
      layers.bg.setAttribute('fill', s.background === 'white' ? '#ffffff' : 'none');
      drawTree(s);

      [layers.unmapped, layers.markers, layers.leaders, layers.labels, layers.legend].forEach(g => { g.textContent = ''; });

      if (s.unmapped === 'dots') {
         reg.receptors.forEach(r => {
            if (!marks.has(r.id) && s.tree[r.cls].visible) {
               el('circle', { cx: r.x * SCALE, cy: r.y * SCALE, r: 1.8, fill: '#9b9b9b', 'fill-opacity': 0.7 }, layers.unmapped);
            }
         });
      }

      // Large shapes first so that small ones stay visible on top
      const ordered = [...marks.values()].filter(m => s.tree[m.r.cls].visible).sort((a, b) => b.style.size - a.style.size);
      ordered.forEach(m => {
         const st = m.style;
         el('path', {
            d: GPCRome.shapes.path(st.shape, st.size),
            transform: `translate(${(m.r.x * SCALE).toFixed(2)},${(m.r.y * SCALE).toFixed(2)})`,
            fill: st.fill, 'fill-opacity': st.opacity,
            stroke: st.stroke === 'none' ? 'none' : st.stroke, 'stroke-width': s.strokeWidth, 'stroke-opacity': Math.min(1, st.opacity + 0.15),
            'data-id': m.r.id,
         }, layers.markers);
      });

      layers.hits.querySelectorAll('circle').forEach(c => {
         const m = marks.get(c.dataset.id);
         c.setAttribute('r', Math.max(5, m ? m.style.size : 0));
         c.setAttribute('display', s.tree[reg.byId[c.dataset.id].cls].visible ? 'inline' : 'none');
      });

      if (s.legend && domain) drawLegend(s, domain, marks);
      let blockers = [];
      if (layers.legend.childNodes.length) {
         try {
            const bb = layers.legend.getBBox();
            if (bb.width > 0 && bb.height > 0) blockers = [{ x: bb.x - 6, y: bb.y - 4, w: bb.width + 12, h: bb.height + 8 }];
         } catch (e) { /* legend not measurable yet */ }
      }

      const obstacles = [];
      const radiusById = new Map();
      reg.receptors.forEach(r => {
         if (!s.tree[r.cls].visible) return;
         const m = marks.get(r.id);
         const rad = pointRadius(m, s);
         obstacles.push({ id: r.id, x: r.x * SCALE, y: r.y * SCALE, r: rad, solid: !!m || s.unmapped === 'dots' });
         radiusById.set(r.id, rad);
      });

      const weight = s.labelBold ? 'bold' : 'normal';
      const fontStyle = s.labelItalic ? 'italic' : 'normal';
      const labels = [];
      reg.receptors.forEach(r => {
         if (!s.tree[r.cls].visible) return;
         const m = marks.get(r.id);
         const flag = m && m.label;
         const show = flag === 'yes' || (flag !== 'no' && (s.labels === 'all' || (s.labels === 'mapped' && m)));
         if (!show) return;
         const text = (m && m.text) || reg.displayName(r, s.labelName);
         const box = textBox(text, s.labelSize, weight, fontStyle);
         const ang = (r.angle * Math.PI) / 180;
         const off = state.offsets[r.id];
         const pinned = !!(off && (Math.abs(off[0]) > 0.2 || Math.abs(off[1]) > 0.2));
         labels.push({
            id: r.id, text, w: box.w, h: box.h, dx: box.dx, dy: box.dy,
            px: r.x * SCALE, py: r.y * SCALE,
            cos: Math.cos(ang), sin: Math.sin(ang),
            ownR: radiusById.get(r.id) || 1.7,
            pinned, offx: pinned ? off[0] : 0, offy: pinned ? off[1] : 0,
         });
      });
      layoutLabels(labels, obstacles, blockers, s.labelSize);
      includeLabelBounds(labels);

      const lineMode = s.labelLine || 'auto';
      labels.forEach(L => {
         const ends = lineMode === 'off' ? null : leaderEnds(L, lineMode);
         if (ends) {
            const g = el('g', { 'data-for': L.id }, layers.leaders);
            const line = { x1: ends.x1.toFixed(2), y1: ends.y1.toFixed(2), x2: ends.x2.toFixed(2), y2: ends.y2.toFixed(2), 'stroke-linecap': 'round' };
            el('line', Object.assign({ stroke: '#ffffff', 'stroke-width': 1.6, 'stroke-opacity': 0.9 }, line), g);
            el('line', Object.assign({ stroke: s.labelColor, 'stroke-width': 0.55, 'stroke-opacity': 0.7 }, line), g);
         }
         const g = el('g', {
            class: 'label', 'data-id': L.id,
            'data-dx': (L.cx - L.idealCx).toFixed(2), 'data-dy': (L.cy - L.idealCy).toFixed(2),
         }, layers.labels);
         el('rect', {
            x: (L.cx - L.w / 2).toFixed(2), y: (L.cy - L.h / 2).toFixed(2),
            width: L.w.toFixed(2), height: L.h.toFixed(2), fill: 'transparent', 'data-export': 'no',
         }, g);
         const attrs = {
            x: (L.cx + L.dx).toFixed(2), y: (L.cy + L.dy).toFixed(2),
            'text-anchor': 'middle', 'font-size': s.labelSize,
            'font-weight': weight, 'font-style': fontStyle,
         };
         el('text', Object.assign({ fill: 'none', stroke: '#ffffff', 'stroke-width': s.labelSize * 0.28, 'stroke-linejoin': 'round', 'stroke-opacity': 0.9 }, attrs), g).textContent = L.text;
         el('text', Object.assign({ fill: s.labelColor }, attrs), g).textContent = L.text;
      });

      layers.bg.setAttribute('x', content.x);
      layers.bg.setAttribute('y', content.y);
      layers.bg.setAttribute('width', content.w);
      layers.bg.setAttribute('height', content.h);
      if (fitted) {
         view = { x: content.x, y: content.y, w: content.w, h: content.h };
         applyView();
      }
   }

   const CLASS_LEGEND_MAX = 6;

   function valueClasses(marks, s) {
      const seen = new Set();
      marks.forEach(m => {
         if (!s.tree[m.r.cls].visible) return;
         if (typeof m.value !== 'number' || !isFinite(m.value)) return;
         if (s.valueScale === 'log' && !(m.value > 0)) return;
         seen.add(Number(m.value.toPrecision(6)));
      });
      return [...seen].sort((a, b) => a - b);
   }

   function scaleT(s, domain) {
      const log = s.valueScale === 'log';
      const tf = log ? v => Math.log10(v) : v => v;
      const span = tf(domain[1]) - tf(domain[0]);
      return v => (span === 0 ? 0.5 : (tf(v) - tf(domain[0])) / span);
   }

   function clamp01(t) {
      return Math.min(1, Math.max(0, t));
   }

   function scaledSize(s, t) {
      const u = clamp01(t);
      return s.sizeByValue ? s.sizeMin + u * (s.sizeMax - s.sizeMin) : s.size;
   }

   function scaledFill(s, t) {
      const u = clamp01(t);
      return s.colorByValue ? GPCRome.colors.sample(s.palette, u, s.reversePalette) : s.fill;
   }

   function legendMarker(g, s, cx, cy, size, fill) {
      el('path', {
         d: GPCRome.shapes.path(s.shape, size),
         transform: `translate(${cx.toFixed(2)},${cy.toFixed(2)})`,
         fill, 'fill-opacity': s.opacity,
         stroke: s.stroke === 'none' || !(s.strokeWidth > 0) ? 'none' : s.stroke,
         'stroke-width': s.strokeWidth,
         'stroke-opacity': Math.min(1, Number(s.opacity) + 0.15),
      }, g);
   }

   function legendTitle(g, s, x, y) {
      if (!s.legendTitle) return y;
      el('text', { x, y, 'font-size': 12, 'font-weight': 'bold', fill: '#222' }, g).textContent = s.legendTitle;
      return y;
   }

   /* One marker per distinct value when a value scale has only a few classes. */
   function drawClassLegend(s, values, tOf, x0) {
      const g = layers.legend;
      layers.gradient.textContent = '';
      const gap = 7;
      const items = values.map(v => {
         const t = tOf(v);
         return { v, size: scaledSize(s, t), fill: scaledFill(s, t) };
      });
      const maxSize = Math.max(...items.map(it => it.size), 4);
      const rows = items.map(it => Math.max(it.size * 2, 13) + gap);
      const blockH = rows.reduce((sum, h) => sum + h, 0);
      const titleH = s.legendTitle ? 18 : 0;
      let y = H - 16 - blockH - titleH;
      legendTitle(g, s, x0, y + 12);
      y += titleH;
      const cx = x0 + maxSize;
      items.forEach((it, i) => {
         const cy = y + (rows[i] - gap) / 2;
         legendMarker(g, s, cx, cy, it.size, it.fill);
         el('text', { x: cx + it.size + 6, y: cy + 4, 'font-size': 11, fill: '#333' }, g).textContent = fmt(it.v);
         y += rows[i];
      });
   }

   /* Continuous colour bar, with min / mean / max sizes centred on the same scale. */
   function drawScaleLegend(s, domain, tOf, x0, width) {
      const g = layers.legend;
      let bottom = H - 8;
      let top = bottom;

      if (s.colorByValue) {
         layers.gradient.textContent = '';
         for (let i = 0; i <= 10; i++) {
            el('stop', { offset: i / 10, 'stop-color': GPCRome.colors.sample(s.palette, i / 10, s.reversePalette) }, layers.gradient);
         }
         const labelY = bottom;
         const barH = 12;
         const barY = labelY - 15;
         el('rect', {
            x: x0, y: barY, width, height: barH,
            fill: 'url(#gpcrome-legend-gradient)', stroke: '#555', 'stroke-width': 0.6, 'fill-opacity': s.opacity,
         }, g);
         el('text', { x: x0, y: labelY, 'font-size': 11, fill: '#333' }, g).textContent = fmt(domain[0]);
         el('text', { x: x0 + width, y: labelY, 'font-size': 11, fill: '#333', 'text-anchor': 'end' }, g).textContent = fmt(domain[1]);
         bottom = barY - 8;
         top = barY - 16;
      }

      if (s.sizeByValue) {
         const samples = [];
         [domain[0], domain[2], domain[1]].forEach(v => {
            if (samples.some(sm => sm.v === v)) return;
            samples.push({ v, t: clamp01(tOf(v)) });
         });
         const maxR = Math.max(...samples.map(sm => scaledSize(s, sm.t)));
         const cy = bottom - maxR;
         const labelY = cy - maxR - 4;
         samples.forEach(sm => {
            const size = scaledSize(s, sm.t);
            const cx = x0 + sm.t * width;
            legendMarker(g, s, cx, cy, size, scaledFill(s, sm.t));
            const anchor = sm.t <= 0.02 ? 'start' : sm.t >= 0.98 ? 'end' : 'middle';
            el('text', {
               x: cx, y: labelY, 'text-anchor': anchor, 'font-size': 10, fill: '#333',
            }, g).textContent = fmt(sm.v);
         });
         top = labelY - 16;
      }

      legendTitle(g, s, x0, top);
   }

   function drawLegend(s, domain, marks) {
      const width = 180, x0 = W - width - 10;
      const tOf = scaleT(s, domain);
      const classes = valueClasses(marks, s);
      if (s.sizeByValue && classes.length > 0 && classes.length <= CLASS_LEGEND_MAX) drawClassLegend(s, classes, tOf, x0);
      else drawScaleLegend(s, domain, tOf, x0, width);
   }

   /* ---------- view and interaction ---------- */

   function applyView() {
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
   }

   function toSvgPoint(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
   }

   function zoom(factor, center) {
      fitted = false;
      const limit = Math.max(FULL.w, content.w, content.h);
      const c = center || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
      const w = Math.min(limit * 1.5, Math.max(Math.min(FULL.w, content.w) / 25, view.w / factor));
      const f = view.w / w;
      view = { x: c.x - (c.x - view.x) / f, y: c.y - (c.y - view.y) / f, w, h: view.h / f };
      applyView();
   }

   function fit() {
      fitted = true;
      view = { x: content.x, y: content.y, w: content.w, h: content.h };
      applyView();
   }

   function focus(r) {
      fitted = false;
      const cx = r.x * SCALE, cy = r.y * SCALE;
      const w = Math.min(view.w, FULL.w / 3), h = (w * FULL.h) / FULL.w;
      view = { x: cx - w / 2, y: cy - h / 2, w, h };
      applyView();
      layers.highlight.textContent = '';
      const ring = el('circle', { cx, cy, r: 14, class: 'pulse' }, layers.highlight);
      setTimeout(() => ring.remove(), 2600);
   }

   function bindInteraction() {
      let pan = null, drag = null;

      svg.addEventListener('wheel', evt => {
         evt.preventDefault();
         zoom(Math.exp(-evt.deltaY * 0.0015), toSvgPoint(evt));
      }, { passive: false });

      svg.addEventListener('pointerdown', evt => {
         const label = evt.target.closest('.label');
         if (label) {
            const id = label.dataset.id;
            const leader = layers.leaders.querySelector(`[data-for="${id}"]`);
            drag = {
               id, node: label, start: toSvgPoint(evt), moved: false,
               base: [parseFloat(label.dataset.dx) || 0, parseFloat(label.dataset.dy) || 0],
               lines: leader ? [...leader.querySelectorAll('line')].map(node => ({
                  node, x2: parseFloat(node.getAttribute('x2')), y2: parseFloat(node.getAttribute('y2')),
               })) : null,
            };
         } else {
            pan = { start: toSvgPoint(evt), client: [evt.clientX, evt.clientY], moved: false, target: evt.target };
         }
         svg.setPointerCapture(evt.pointerId);
      });

      svg.addEventListener('pointermove', evt => {
         if (drag) {
            const p = toSvgPoint(evt);
            const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
            drag.moved = drag.moved || Math.hypot(dx, dy) > 1;
            drag.delta = [dx, dy];
            drag.node.setAttribute('transform', `translate(${dx},${dy})`);
            if (drag.lines) drag.lines.forEach(l => {
               l.node.setAttribute('x2', (l.x2 + dx).toFixed(2));
               l.node.setAttribute('y2', (l.y2 + dy).toFixed(2));
            });
            return;
         }
         if (pan) {
            if (!pan.moved && Math.hypot(evt.clientX - pan.client[0], evt.clientY - pan.client[1]) < 4) return;
            pan.moved = true;
            fitted = false;
            svg.classList.add('panning');
            const p = toSvgPoint(evt);
            view.x -= p.x - pan.start.x;
            view.y -= p.y - pan.start.y;
            applyView();
            return;
         }
         const hit = evt.target.closest && evt.target.closest('.hits circle, .label');
         handlers.hover(hit ? reg.byId[hit.dataset.id] : null, evt);
      });

      svg.addEventListener('pointerup', evt => {
         if (drag) {
            if (drag.moved) GPCRome.state.setOffset(drag.id, [drag.base[0] + drag.delta[0], drag.base[1] + drag.delta[1]]);
            drag = null;
         } else if (pan) {
            if (!pan.moved) {
               const hit = pan.target.closest && pan.target.closest('.hits circle');
               handlers.select(hit ? reg.byId[hit.dataset.id] : null, evt);
            }
            pan = null;
            svg.classList.remove('panning');
         }
      });

      svg.addEventListener('pointerleave', () => handlers.hover(null));

      svg.addEventListener('dblclick', evt => {
         const label = evt.target.closest('.label');
         if (label) GPCRome.state.setOffset(label.dataset.id, null);
      });
   }

   /* Standalone SVG of the full map (without interaction layers) */
   function exportSVG() {
      const copy = svg.cloneNode(true);
      copy.querySelectorAll('[data-export="no"]').forEach(n => n.remove());
      copy.setAttribute('viewBox', `${content.x} ${content.y} ${content.w} ${content.h}`);
      copy.setAttribute('width', content.w);
      copy.setAttribute('height', content.h);
      copy.removeAttribute('class');
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy);
   }

   return {
      init, draw, compute, zoom, fit, focus, exportSVG,
      size: () => ({ width: content.w, height: content.h }),
      last: () => lastComputed,
      fmt,
   };
})();
