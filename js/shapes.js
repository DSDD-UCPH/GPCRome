/* Marker shapes as SVG path data, centred on (0, 0) with "radius" r */
window.GPCRome = window.GPCRome || {};

GPCRome.shapes = (function () {
   function polygon(n, r, rotation) {
      const pts = [];
      for (let i = 0; i < n; i++) {
         const a = rotation + (2 * Math.PI * i) / n;
         pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return pts;
   }

   function toPath(pts) {
      return 'M' + pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join('L') + 'Z';
   }

   const up = -Math.PI / 2;
   const builders = {
      circle: r => `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`,
      square: r => { const s = r * 0.886; return `M${-s},${-s}H${s}V${s}H${-s}Z`; },
      'rounded square': r => {
         const s = r * 0.9, c = r * 0.35;
         return `M${-s + c},${-s}H${s - c}Q${s},${-s} ${s},${-s + c}V${s - c}Q${s},${s} ${s - c},${s}` +
            `H${-s + c}Q${-s},${s} ${-s},${s - c}V${-s + c}Q${-s},${-s} ${-s + c},${-s}Z`;
      },
      triangle: r => toPath(polygon(3, r * 1.2, up).map(p => [p[0], p[1] + r * 0.2])),
      diamond: r => toPath(polygon(4, r * 1.15, up)),
      pentagon: r => toPath(polygon(5, r * 1.05, up)),
      hexagon: r => toPath(polygon(6, r, up)),
      octagon: r => toPath(polygon(8, r, up + Math.PI / 8)),
      star: r => {
         const pts = [];
         for (let i = 0; i < 10; i++) {
            const rad = i % 2 ? r * 0.5 : r * 1.25;
            const a = up + (Math.PI * i) / 5;
            pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
         }
         return toPath(pts);
      },
   };

   const names = Object.keys(builders);

   // Distance from the centre to the furthest point, as a multiple of r
   const EXTENT = {
      circle: 1, square: 1.26, 'rounded square': 1.08, triangle: 1.34,
      diamond: 1.15, pentagon: 1.06, hexagon: 1, octagon: 1, star: 1.25,
   };

   function path(shape, r) {
      return (builders[shape] || builders.circle)(r);
   }

   function extent(shape) {
      return EXTENT[shape] || 1;
   }

   return { names, path, extent };
})();
