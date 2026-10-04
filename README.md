# GPCRome
Interactive mapper of the human GPCR tree – map your own receptor lists and data on the GPCRome and
download publication-ready figures.

Open `index.html` in a browser (or serve the folder with any static web server, e.g.
`python3 -m http.server`). There is no build step; only Handsontable is loaded from a CDN.

---

## Using the mapper

Paste receptors in the **Data** tab, one per line, and press **Map** (or ⌘/Ctrl+Enter).
Any identifier works: gene symbol, UniProt accession or entry name, GPCRdb entry name, HGNC or ChEMBL ID and
common synonyms. The same syntax is accepted in uploaded CSV/TSV files.

| Input | Meaning |
|---|---|
| `ADRB2` | mark a receptor with the default style |
| `ADRB2 7.5` / `ADRB2,7.5` / `ADRB2<TAB>7.5` | with a value (colour and size by value) |
| `ADRB*`, `GPR1??` | wildcards on official identifiers |
| `all` | every receptor on the tree |
| `class:B1` (also `A`, `B2`, `C`, `F`, `T2`, `rogues`, `orphan`) or `@secretin` | a GPCR class |
| `family:adenosine`, `ligand:peptide` | GPCRdb receptor family / ligand type (substring) |
| `fill=red size=8 shape=star stroke=none opacity=0.5 label=yes text="β2AR"` | per-row style |
| `red star label` | bare colours, shapes and `label` also work |
| `set labels=all palette=magma` | change global settings |
| `# comment` | ignored |

Rows are applied top to bottom; later rows override earlier ones (`all fill=#ccc` followed by `ADRB* fill=red`).
A CSV with a header row (`receptor,value,fill,size,shape,stroke,opacity,label,label_text`) is read by column name.

**Settings** (for `set key=value` or `#set key=value` lines in CSV files): `shape`, `size`, `fill`, `stroke`,
`strokeWidth`, `opacity`, `colorByValue`, `sizeByValue`, `sizeMin`, `sizeMax`, `palette`, `reversePalette`,
`valueScale` (`linear`/`log`), `valueMin`, `valueMax`, `legend`, `legendTitle`, `labels` (`none`/`mapped`/`all`),
`labelName` (`gene`/`entry`/`gpcrdb`), `labelSize`, `labelColor`, `unmapped` (`hidden`/`dots`), `treeWidth`,
`treeOpacity`, `background` (`white`/`transparent`), `tree.<class>=on|off`, `tree.<class>.color=#hex`.

**Downloads**: SVG, PNG (2× / 4×), the full table plus settings as CSV (re-upload it to continue) and a CSV of all
mapped receptors with the values and styles used for drawing. **Share link** stores the complete map in the URL.

**Embedding / automation** (e.g. from a KNIME node or another web page):
- `index.html?ids=ADRB2,DRD2,HTR2A` or `index.html?data=<url-encoded input text or CSV>`
- `window.postMessage({type: 'gpcrome', data: 'ADRB2 5\nDRD2 3', append: false}, '*')` to an embedded iframe

---

## Project layout

```
index.html            page layout
css/style.css
js/data/tree.js       generated – tree branches per class (from the PDF)
js/data/receptors.js  generated – receptors, identifiers, GPCRdb annotation and dataset values
js/data/datasets.js  generated – ligand sets, expression by tissue, sequence-identity matrices
js/colors.js          palettes
js/shapes.js          marker shapes
js/registry.js        identifier lookup and selectors (wildcards, class:, family:, ligand:)
js/state.js           state, undo/redo, autosave (localStorage) and share links
js/commands.js        parser for the input text / CSV and CSV export
js/render.js          SVG drawing (tree → shapes by size → labels → legend), zoom/pan, label dragging
js/export.js          SVG/PNG/CSV downloads
js/ui.js              controls, table (Handsontable), search, info card, quick start
data/receptors.tsv    curated list of receptors on the tree: gene, name, class, IDs, position (x, y, leaf angle)
data/synonyms.tsv     additional synonyms (gene → synonym)
data/gpcrdb.json      cached GPCRdb annotation and structure statistics
data/datasets.json    cached ligand, expression, sequence and drug datasets
images/GPCR_from_scratch_v8.pdf   vector source of the tree
images/gpcrome_tree.svg           generated – plain tree, one group per class
tools/                data pipeline (Python 3, `pip install -r tools/requirements.txt`)
```

### Updating the data

```
python tools/update_gpcrdb.py     # refresh annotation and structure counts from GPCRdb
python tools/update_datasets.py  # ligands, expression, sequence identity and drug counts
python tools/build_data.py        # rebuild js/data/receptors.js and js/data/datasets.js
python tools/build_tree.py        # only after changing the PDF: rebuild js/data/tree.js and images/gpcrome_tree.svg
```

`update_datasets.py` caches raw responses in `data/cache/` (gitignored). Pass `--refresh` to download them again, or `--only sequence,drugs,expression,ligands` to rerun one part.

The dataset menu can map:

| Dataset | What the value is |
|---|---|
| Structures | experimental structures and unique ligands in those structures (GPCRdb) |
| Ligands | unique ChEMBL ligands and bioactivity rows, as integrated by GPCRdb, and Guide to Pharmacology interactions. **Shared with a reference** counts ligands in common with a receptor you pick |
| Sequence | percent identity and BLOSUM62 similarity to a reference receptor, on the GPCRdb 7TM alignment and on the full sequence |
| Expression | ProteomicsDB protein abundance (tissues and fluids) and Human Protein Atlas mRNA (TPM) hosted by ProteomicsDB. Pick a tissue, or the highest tissue |
| Drugs | approved drugs and phase 1–3 candidates. GPCRdb combines DrugBank, ChEMBL and Guide to Pharmacology (DrugBank has no separate open target download). ChEMBL mechanisms, Guide to Pharmacology approved drugs and DrugCentral interactions are listed on their own |

To add or rename a receptor or synonym, edit `data/receptors.tsv` / `data/synonyms.tsv` and run `build_data.py`.
Positions are in PDF coordinates (points); `angle` is the direction of the leaf, used to place labels.

---

## Roadmap

### Need to haves
- [x] Cleanup and documentation of code + stripping redundant code/libraries (jQuery, warna, canvas extensions removed)
- [x] Create proper interface/layout
- [x] Complete and updatable dictionary of all receptors + synonyms (gene, UniProt, entry names, HGNC, ChEMBL, GPCRdb, synonyms)
- [x] SVG drawing/download (tree redrawn as vector from the original PDF)
- [x] GPCR receptor labelling with toggle
- [x] Toggling and colouring of individual classes
- [x] Interactive edit mode in Excel like format ([Handsontable](https://handsontable.com), non-commercial licence)
- [x] CSV-type download and upload of settings
- [x] Simple inline scripting functionality (one-line commands and `set` lines)
- [x] Download in multiple outputs SVG/PNG/CSV
- [x] Drawing order: tree, then shapes ordered by size, finally receptor labels
- [ ] Class labels on the tree

### Nice to haves
- [x] Link receptors to external databases (GPCRdb, UniProt, GtoPdb, ChEMBL, HGNC)
- [x] Show the value used for drawing the shape for that receptor (tooltip, info card, mapped-receptors CSV)
- [x] Integration of datasets:
  - [x] ChEMBL (# unique ligands per receptor, # datapoints per receptor, overlapping ligands based on reference)
  - [x] PDB/GPCRdb (# experimental structures, # unique ligands in structures)
  - [x] Protein/mRNA expression data from ProteomicsDB (tissue selector, or the highest tissue)
  - [x] GPCRdb – sequence identity/similarity (7TM domain, full sequence)
  - [x] GPCRdb/DrugCentral/DrugBank/GtP/ChEMBL – overview # drugs/clinical candidates/clinical phase
- [x] Sharing decorated GPCRomes via a unique link
- [x] Undo/Redo option
- [x] Make the receptor labels draggable
- [x] Add a quick start tutorial
- [~] Web service to post data to the GPCRome (URL parameters and `postMessage` – a KNIME node can build on this)
