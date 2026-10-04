/* Downloads: SVG, PNG, settings CSV and the resolved per-receptor table */
window.GPCRome = window.GPCRome || {};

GPCRome.exporter = (function () {
   function download(filename, blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
   }

   function svg() {
      download('gpcrome.svg', new Blob([GPCRome.render.exportSVG()], { type: 'image/svg+xml' }));
   }

   function png(scale) {
      const { width, height } = GPCRome.render.size();
      const img = new Image();
      const url = URL.createObjectURL(new Blob([GPCRome.render.exportSVG()], { type: 'image/svg+xml' }));
      img.onload = () => {
         const canvas = document.createElement('canvas');
         canvas.width = Math.round(width * scale);
         canvas.height = Math.round(height * scale);
         canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
         URL.revokeObjectURL(url);
         canvas.toBlob(blob => download('gpcrome.png', blob), 'image/png');
      };
      img.src = url;
   }

   function settingsCSV() {
      const text = GPCRome.commands.toCSV(GPCRome.state.get());
      download('gpcrome-settings.csv', new Blob([text], { type: 'text/csv' }));
   }

   /* One line per receptor with the values and style actually used for drawing */
   function mappedCSV() {
      const { marks } = GPCRome.render.compute(GPCRome.state.get());
      const cell = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
      const lines = ['gene,uniprot,class,family,name,value,fill,size,shape,stroke,opacity'];
      [...marks.values()].sort((a, b) => a.r.id.localeCompare(b.r.id)).forEach(m => {
         const r = m.r, st = m.style;
         const cls = GPCRome.registry.classById[r.cls].name;
         lines.push([r.id, r.uniprot[0] || '', cls, r.gpcrdb ? r.gpcrdb.family : '', r.name,
            m.value === undefined ? '' : m.value, st.fill, Math.round(st.size * 100) / 100, st.shape, st.stroke, st.opacity]
            .map(cell).join(','));
      });
      download('gpcrome-mapped-receptors.csv', new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
   }

   return { svg, png, settingsCSV, mappedCSV, download };
})();
