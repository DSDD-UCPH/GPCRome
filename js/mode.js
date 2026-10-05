/*
 * Which tree is drawn: the non-olfactory GPCRs or, instead of them, the olfactory ones. This has to be known
 * before the registry is built, so it comes from ?tree=olfactory or, failing that, from the saved session; the
 * page reloads when the setting is changed (see ui.js). The olfactory data (js/data/olfactory.js, which
 * replaces the tree, the receptors and the datasets) is only loaded when it is wanted.
 */
(function () {
   let view = 'nonolfactory';
   try {
      const saved = JSON.parse(localStorage.getItem('gpcrome-state-v1') || 'null');
      view = new URLSearchParams(location.search).get('tree') || (saved && saved.settings && saved.settings.treeView) || view;
   } catch (e) { /* no storage: the non-olfactory tree */ }
   window.GPCROME_VIEW = /^olfactory$/i.test(view) ? 'olfactory' : 'nonolfactory';
   if (window.GPCROME_VIEW === 'olfactory') document.write('<script src="js/data/olfactory.js"><\/script>');
})();
