/*
 * Label placement.
 *
 * A label goes as close to its receptor as it can: first just beyond the leaf, along its direction, then
 * round the other sides and further out. A place is usable only if the label does not cover another
 * label, a marker or the legend. Of the usable places the cheapest wins: the distance from the leaf, the
 * turn away from the leaf direction, every branch the label would lie on, a label that is nearer to
 * another receptor than to its own, and every leader line (from the receptor to a label that is not next
 * to it) that would run through something.
 * Labels are placed most crowded first; labels the user has dragged stay where they are.
 */
window.GPCRome = window.GPCRome || {};

GPCRome.labels = (function () {
   // the places tried for a label: turned away from the leaf direction by up to 180 degrees, and out
   // in steps of a third of the font size, wider beyond the 20th
   const TURNS = [0, ...Array.from({ length: 11 }, (_, i) => [(i + 1) * 15, -(i + 1) * 15]).flat(), 180]
      .map(deg => ({ deg, rad: (deg * Math.PI) / 180 }));
   const RINGS = 64;
   const TURN_COST = 0.03;                         // per degree turned away
   const BRANCH_COST = 9, BRANCH_LENGTH_COST = 0.3, BRANCH_WIDTH = 0.35;
   const LEADER_CLIPS = 40, LEADER_CROSSES = 8;   // a leader line through a marker or label, across another leader
   const AMBIGUOUS = 12, EDGE_COST = 2.5;

   /* A uniform grid over rectangles: some() and sum() visit every id near a rectangle once. */
   function Grid(size) {
      const cells = new Map(), seen = new Map();
      let stamp = 0;
      const span = (a, b) => [Math.floor(a / size), Math.floor(b / size)];
      return {
         insert(id, x0, y0, x1, y1) {
            const [i0, i1] = span(x0, x1), [j0, j1] = span(y0, y1);
            for (let i = i0; i <= i1; i++) {
               for (let j = j0; j <= j1; j++) {
                  const key = i * 65536 + j;
                  if (!cells.has(key)) cells.set(key, []);
                  cells.get(key).push(id);
               }
            }
         },
         some(x0, y0, x1, y1, test) {
            stamp++;
            const [i0, i1] = span(x0, x1), [j0, j1] = span(y0, y1);
            for (let i = i0; i <= i1; i++) {
               for (let j = j0; j <= j1; j++) {
                  const list = cells.get(i * 65536 + j);
                  if (!list) continue;
                  for (let k = 0; k < list.length; k++) {
                     if (seen.get(list[k]) === stamp) continue;
                     seen.set(list[k], stamp);
                     if (test(list[k])) return true;
                  }
               }
            }
            return false;
         },
         sum(x0, y0, x1, y1, value) {
            let total = 0;
            this.some(x0, y0, x1, y1, id => { total += value(id); return false; });
            return total;
         },
      };
   }

   /* Length of the part of the segment that lies inside the rectangle (Liang-Barsky). */
   function lengthInside(x1, y1, x2, y2, left, top, right, bottom) {
      const dx = x2 - x1, dy = y2 - y1;
      const p = [-dx, dx, -dy, dy], q = [x1 - left, right - x1, y1 - top, bottom - y1];
      let t0 = 0, t1 = 1;
      for (let i = 0; i < 4; i++) {
         if (p[i] === 0) {
            if (q[i] < 0) return 0;
         } else {
            const t = q[i] / p[i];
            if (p[i] < 0) { if (t > t1) return 0; if (t > t0) t0 = t; }
            else { if (t < t0) return 0; if (t < t1) t1 = t; }
         }
      }
      return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
   }

   function segmentsCross(a, b) {
      const side = (s, x, y) => (s[2] - s[0]) * (y - s[1]) - (s[3] - s[1]) * (x - s[0]);
      return side(a, b[0], b[1]) * side(a, b[2], b[3]) < 0 && side(b, a[0], a[1]) * side(b, a[2], a[3]) < 0;
   }

   function distanceToRect(px, py, left, top, right, bottom) {
      return Math.hypot(Math.max(left - px, 0, px - right), Math.max(top - py, 0, py - bottom));
   }

   const boundsOf = s => [Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3])];

   /*
    * items:  { id, w, h, px, py, cos, sin, ownR, pinned, offx, offy }, set up by the caller: the leaf, its
    *         direction, the size of its marker and the box of the text. Every item gets cx, cy (the centre
    *         of its box), idealCx, idealCy (just beyond the leaf) and leader ([x1, y1, x2, y2] or null).
    * scene:  { obstacles: [{ id, x, y, r, solid }]  markers, and unmapped receptors, to keep clear of
    *           blockers:  [{ x, y, w, h }]           rectangles to keep clear of
    *           branches:  [[x1, y1, x2, y2, width]]  the drawn tree
    *           bounds:    { x, y, w, h }             the drawing; labels stay inside if they can
    *           fontSize, leaderMin }                 leader lines start this far from the marker
    */
   function layout(items, scene) {
      if (!items.length) return;
      const { obstacles, blockers, branches, bounds, fontSize, leaderMin } = scene;
      const gapL = Math.max(1.6, fontSize * 0.14);      // between labels
      const gapM = Math.max(2.0, fontSize * 0.16);      // between a label and a marker
      const step = Math.max(1.5, fontSize * 0.3);
      const byId = new Map(items.map(L => [L.id, L]));

      const markerGrid = Grid(40), branchGrid = Grid(40);                  // the scene
      obstacles.forEach((M, i) => markerGrid.insert(i, M.x - M.r, M.y - M.r, M.x + M.r, M.y + M.r));
      branches.forEach((b, i) => branchGrid.insert(i, ...boundsOf(b)));
      const labelGrid = Grid(48), leaderGrid = Grid(48);                   // what has been placed so far

      // every turn with every step outwards, cheapest first
      const outward = k => step * (k <= 20 ? k : 20 + (k - 20) * 3);
      const order = [];
      TURNS.forEach((t, ti) => { for (let k = 0; k < RINGS; k++) order.push({ ti, extra: outward(k), base: outward(k) + TURN_COST * Math.abs(t.deg) }); });
      order.sort((a, b) => a.base - b.base || a.extra - b.extra || a.ti - b.ti);

      items.forEach(L => {
         const support = Math.abs(L.cos) * L.w / 2 + Math.abs(L.sin) * L.h / 2;
         L.idealCx = L.px + L.cos * (L.ownR + gapM + support);
         L.idealCy = L.py + L.sin * (L.ownR + gapM + support);
         L.leader = null;
         if (L.pinned) { L.cx = L.idealCx + L.offx; L.cy = L.idealCy + L.offy; return; }
         // for every turn: the direction, and how close along it the box can come to the marker
         const heading = Math.atan2(L.sin, L.cos);
         L.dirs = TURNS.map(t => {
            const ux = Math.cos(heading + t.rad), uy = Math.sin(heading + t.rad);
            let lo = 0, hi = L.ownR + gapM + L.w + L.h;
            for (let i = 0; i < 14; i++) {
               const mid = (lo + hi) / 2, x = L.px + ux * mid, y = L.py + uy * mid;
               if (distanceToRect(L.px, L.py, x - L.w / 2, y - L.h / 2, x + L.w / 2, y + L.h / 2) < L.ownR + gapM) lo = mid; else hi = mid;
            }
            return { ux, uy, near: hi };
         });
      });

      /* The leader line to a box at (x, y), or null if the box is close enough not to need one. */
      function leaderFor(L, x, y) {
         const qx = Math.max(x - L.w / 2, Math.min(L.px, x + L.w / 2));
         const qy = Math.max(y - L.h / 2, Math.min(L.py, y + L.h / 2));
         const dx = qx - L.px, dy = qy - L.py, dist = Math.hypot(dx, dy);
         if (dist < L.ownR + leaderMin) return null;
         const ux = dx / dist, uy = dy / dist;
         return [L.px + ux * (L.ownR + 0.7), L.py + uy * (L.ownR + 0.7), qx - ux, qy - uy];
      }

      /* Whether the box covers another label, a marker or a blocker. */
      function covers(L, x, y, left, top, right, bottom) {
         if (labelGrid.some(left - gapL, top - gapL, right + gapL, bottom + gapL, id => {
            const P = byId.get(id);
            return P !== L && (P.w + L.w) / 2 + gapL - Math.abs(P.cx - x) > 0.2 && (P.h + L.h) / 2 + gapL - Math.abs(P.cy - y) > 0.2;
         })) return true;
         if (markerGrid.some(left - gapM, top - gapM, right + gapM, bottom + gapM, i => {
            const M = obstacles[i];
            return M.id !== L.id && ((left < M.x && M.x < right && top < M.y && M.y < bottom) ||
               distanceToRect(M.x, M.y, left, top, right, bottom) < M.r + gapM - 0.35);
         })) return true;
         return blockers.some(R => right > R.x && left < R.x + R.w && bottom > R.y && top < R.y + R.h);
      }

      /* What lying on the branches of the tree costs: more for longer and thicker ones, not its own twig. */
      function branchCost(L, left, top, right, bottom) {
         return branchGrid.sum(left, top, right, bottom, i => {
            const b = branches[i];
            if (Math.hypot(b[0] - L.px, b[1] - L.py) < 1.2 || Math.hypot(b[2] - L.px, b[3] - L.py) < 1.2) return 0;
            const len = lengthInside(b[0], b[1], b[2], b[3], left, top, right, bottom);
            return len > 0.4 ? (BRANCH_COST + BRANCH_LENGTH_COST * len) * (1 + BRANCH_WIDTH * (b[4] - 1)) : 0;
         });
      }

      /* What a leader line costs if it runs through a marker or a label, or across another leader. */
      function leaderCost(L, leader) {
         const [x0, y0, x1, y1] = boundsOf(leader);
         let cost = 0;
         if (markerGrid.some(x0 - 4, y0 - 4, x1 + 4, y1 + 4, i => {
            const M = obstacles[i];
            if (!M.solid || M.id === L.id) return false;
            const sx = leader[2] - leader[0], sy = leader[3] - leader[1];
            const t = Math.max(0, Math.min(1, ((M.x - leader[0]) * sx + (M.y - leader[1]) * sy) / (sx * sx + sy * sy || 1)));
            return Math.hypot(leader[0] + t * sx - M.x, leader[1] + t * sy - M.y) < M.r + 1.1;
         })) cost += LEADER_CLIPS;
         if (labelGrid.some(x0, y0, x1, y1, id => {
            const P = byId.get(id);
            return P !== L && lengthInside(leader[0], leader[1], leader[2], leader[3], P.cx - P.w / 2, P.cy - P.h / 2, P.cx + P.w / 2, P.cy + P.h / 2) > 0;
         })) cost += LEADER_CLIPS;
         return cost + LEADER_CROSSES * leaderGrid.sum(x0, y0, x1, y1, id => (id !== L.id && segmentsCross(leader, byId.get(id).leader) ? 1 : 0));
      }

      /* A box without a leader line must be nearer to its own receptor than to any other. */
      function ambiguous(L, left, top, right, bottom) {
         const own = distanceToRect(L.px, L.py, left, top, right, bottom);
         return markerGrid.some(left - own, top - own, right + own, bottom + own, i => {
            const M = obstacles[i];
            return M.id !== L.id && distanceToRect(M.x, M.y, left, top, right, bottom) < own - 0.5;
         });
      }

      /* What the box at (x, y) costs beyond the distance and turn, or Infinity if it covers something. */
      function penalty(L, x, y, limit) {
         const left = x - L.w / 2, right = x + L.w / 2, top = y - L.h / 2, bottom = y + L.h / 2;
         if (covers(L, x, y, left, top, right, bottom)) return Infinity;
         const m = 4;
         let cost = EDGE_COST * (Math.max(0, bounds.x + m - left) + Math.max(0, right - (bounds.x + bounds.w - m)) +
            Math.max(0, bounds.y + m - top) + Math.max(0, bottom - (bounds.y + bounds.h - m)));
         if (cost >= limit) return cost;
         cost += branchCost(L, left, top, right, bottom);
         if (cost >= limit) return cost;
         const leader = leaderFor(L, x, y);
         if (leader) return cost + leaderCost(L, leader);
         return cost + (ambiguous(L, left, top, right, bottom) ? AMBIGUOUS : 0);
      }

      function search(L) {
         let best = null, bestCost = Infinity;
         for (let i = 0; i < order.length && order[i].base < bestCost; i++) {
            const o = order[i], d = L.dirs[o.ti], t = d.near + o.extra;
            const x = L.px + d.ux * t, y = L.py + d.uy * t;
            const cost = o.base + penalty(L, x, y, bestCost - o.base);
            if (cost < bestCost) { best = { x, y }; bestCost = cost; }
         }
         return best;
      }

      function put(L, x, y) {
         L.cx = x; L.cy = y;
         L.leader = leaderFor(L, x, y);
         labelGrid.insert(L.id, x - L.w / 2, y - L.h / 2, x + L.w / 2, y + L.h / 2);
         if (L.leader) leaderGrid.insert(L.id, ...boundsOf(L.leader));
      }

      items.filter(L => L.pinned).forEach(L => put(L, L.cx, L.cy));
      // the most crowded first: their neighbours are the ones that need the room
      const free = items.filter(L => !L.pinned);
      free.forEach(L => { L.crowd = free.reduce((n, M) => n + (Math.hypot(M.px - L.px, M.py - L.py) < fontSize * 6 ? 1 : 0), 0); });
      free.sort((a, b) => b.crowd - a.crowd || (a.id < b.id ? -1 : 1)).forEach(L => {
         const spot = search(L) || { x: L.idealCx, y: L.idealCy };
         put(L, spot.x, spot.y);
      });
   }

   return { layout };
})();
