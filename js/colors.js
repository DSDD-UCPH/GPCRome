/* Colour palettes and helpers */
window.GPCRome = window.GPCRome || {};

GPCRome.colors = (function () {
   const palettes = {
      'viridis': ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
      'magma': ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
      'blue-green-yellow-red': ['#0000ff', '#00ff00', '#ffff00', '#ff0000'],
      'red-yellow-green': ['#d73027', '#fee08b', '#1a9850'],
      'blue-white-red': ['#2166ac', '#f7f7f7', '#b2182b'],
      'purple-white-green': ['#762a83', '#f7f7f7', '#1b7837'],
      'white-red': ['#fff5f0', '#cb181d'],
      'white-blue': ['#f7fbff', '#08519c'],
      'yellow-green': ['#ffff00', '#00a000'],
      'greys': ['#f0f0f0', '#252525'],
   };

   function hexToRgb(hex) {
      const h = hex.replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      return [0, 2, 4].map(i => parseInt(full.substr(i, 2), 16));
   }

   function rgbToHex(rgb) {
      return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
   }

   /* Colour at position t (0..1) of a palette */
   function sample(name, t, reverse) {
      const stops = palettes[name] || palettes.viridis;
      if (reverse) t = 1 - t;
      t = Math.min(1, Math.max(0, isFinite(t) ? t : 0.5));
      const pos = t * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(pos));
      const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
      const f = pos - i;
      return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
   }

   function gradientCss(name, reverse) {
      const n = 12;
      const parts = [];
      for (let i = 0; i <= n; i++) parts.push(sample(name, i / n, reverse));
      return `linear-gradient(to right, ${parts.join(', ')})`;
   }

   const probe = document.createElement('span');

   function isColor(value) {
      if (typeof value !== 'string' || !value.trim()) return false;
      return CSS.supports('color', value.trim());
   }

   /* Convert any CSS colour to #rrggbb (needed for <input type=color>) */
   function toHex(value) {
      if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
      if (/^#[0-9a-f]{3}$/i.test(value)) return rgbToHex(hexToRgb(value));
      probe.style.color = '';
      probe.style.color = value;
      document.body.appendChild(probe);
      const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g);
      probe.remove();
      return m ? rgbToHex(m.slice(0, 3).map(Number)) : '#000000';
   }

   return { palettes, sample, gradientCss, isColor, toHex };
})();
