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
| `chemokine`, `aminergic`, `adenosine`, `peptide` | a whole family by name: the GPCRdb receptor families and ligand types (the start of the name is enough) |
| `family:adenosine`, `ligand:peptide` | the same, explicitly (`family:` matches families and ligand types, `ligand:` only ligand types) |
| `fill=red size=8 shape=star stroke=none opacity=0.5 label=yes text="β2AR"` | per-row style |
| `red star label` | bare colours, shapes and `label` also work |
| `set labels=all palette=magma` | change global settings |
| `set classLabels=off` | hide the names of the classes (shown by default, as on the original figure) |
| `set tree=olfactory` | draw the olfactory tree instead of the non-olfactory tree (`set tree=non-olfactory` to go back); the toggle at the top does the same |
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
js/data/tree.js       generated – tree branches per class and the class names (from the phylogenies in data/tree/)
js/data/olfactory.js  generated – the olfactory tree with its receptors and datasets (loaded only when that tree is shown)
js/mode.js            picks the non-olfactory or the olfactory tree before the page loads (?tree=olfactory or the saved session)
js/data/receptors.js  generated – receptors, identifiers, GPCRdb annotation and dataset values
js/data/datasets.js  generated – ligand sets, expression by tissue, sequence-identity matrices
js/colors.js          palettes
js/shapes.js          marker shapes
js/registry.js        identifier lookup and selectors (wildcards, class:, family:, ligand:)
js/state.js           state, undo/redo, autosave (localStorage) and share links
js/commands.js        parser for the input text / CSV and CSV export
js/labels.js          label placement: next to the receptor, clear of other labels, markers and branches
js/render.js          SVG drawing (tree → shapes by size → labels → legend), zoom/pan, label dragging
js/export.js          SVG/PNG/CSV downloads
js/ui.js              controls, table (Handsontable), search, info card, quick start
data/receptors.tsv    curated list of receptors on the tree: gene, name, class, IDs, position (x, y, leaf angle)
data/synonyms.tsv     additional synonyms (gene → synonym)
data/gpcrdb.json      cached GPCRdb annotation and structure statistics
data/datasets.json    cached ligand, expression, sequence and drug datasets
data/tree/            IQ-TREE phylogenies: human_gpcr_7tm.nhx (all classes, 7TM) and
                      <B1|B2|C|F>_fulllength.nhx (full length); layout_v8.tsv holds the receptor
                      positions on the previous, hand-drawn tree, which the new layout follows
images/gpcrome_tree.svg           generated – plain tree, one group per class, with the class names
images/gpcrome_olfactory.svg      generated – the tree of the olfactory receptors
tools/                data pipeline (Python 3, `pip install -r tools/requirements.txt`)
```

### Updating the data

```
python tools/update_gpcrdb.py     # refresh annotation and structure counts from GPCRdb
python tools/update_datasets.py  # ligands, expression, sequence identity and drug counts of the non-olfactory receptors
python tools/update_datasets.py --set olfactory   # the same for the olfactory receptors (data/datasets_olfactory.json)
python tools/build_data.py        # rebuild js/data/receptors.js, datasets.js and olfactory.js
python tools/place.py            # one-off: drag the class names and the olfactory arrow head (saved in data/placement.json, used by build_tree.py)
python tools/build_tree.py        # after changing data/tree/: redraw both trees (or `gpcr` / `olfactory`) and the receptor positions in data/receptors.tsv
```

`update_datasets.py` caches raw responses in `data/cache/` (gitignored). Pass `--refresh` to download them again, or `--only sequence,drugs,expression,ligands` to rerun one part.

The dataset menu can map the following; the olfactory tree has the same menu, but only the datasets that have values for olfactory receptors (about 150 have mRNA expression, 10 a structure, 2 ChEMBL ligands):

| Dataset | What the value is |
|---|---|
| Structures | experimental structures and unique ligands in those structures (GPCRdb) |
| Ligands | unique ChEMBL ligands and bioactivity rows, as integrated by GPCRdb, and Guide to Pharmacology interactions. **Shared with a reference** counts ligands in common with a receptor you pick |
| Sequence | percent identity and BLOSUM62 similarity to a reference receptor, on the GPCRdb 7TM alignment and on the full sequence |
| Expression | ProteomicsDB protein abundance (tissues and fluids) and Human Protein Atlas mRNA (TPM) hosted by ProteomicsDB. Pick a tissue, or the highest tissue |
| Drugs | approved drugs and phase 1–3 candidates. GPCRdb combines DrugBank, ChEMBL and Guide to Pharmacology (DrugBank has no separate open target download). ChEMBL mechanisms, Guide to Pharmacology approved drugs and DrugCentral interactions are listed on their own |

To add or rename a receptor or synonym, edit `data/receptors.tsv` / `data/synonyms.tsv` and run `build_data.py`.
`class`, `x`, `y` and `angle` are written by `build_tree.py`; `angle` is the direction of the leaf, used to place labels.
A receptor added to `receptors.tsv` must be on one of the trees in `data/tree/` (or in `GRAFTS` / `CENTRE_FAN` in `tree_topology.py`).

The tree (`tools/tree_topology.py`) is taken from the 7TM maximum-likelihood tree, which gives the connections
between classes and the topology of class A, the unclassified, taste 2 and vomeronasal receptors; classes B1, B2,
C and F come from their full-length trees, rooted on the branch that matches their root in the 7TM tree. Branch
lengths are not drawn. The layout follows the previous drawing: the classes and the large clades of class A leave
the centre in the direction they had on the previous tree, and every clade is a herringbone of stems and side
branches (`tools/tree_layout.py`), built bottom-up so that receptors (at least 9 units apart, median 11),
branches and receptor-branch pairs keep the distances set in `tools/geometry.py` and cannot overlap or cross.
Branches that would point back towards the centre are avoided. `tools/tree_compact.py` then pulls every clade
in towards the centre until it touches its neighbours (it may turn at most 25 degrees from its direction on the
previous tree) and curves the stems through their nodes, which gives the compact, organic shape of the previous
drawing. The hints from the previous drawing are set in `build_tree.py`; the build prints how far the receptors
moved round the centre and checks that nothing touches. Olfactory receptors are collapsed into an arrow.
Rhodopsin rogues are class A orphans (in GPCRdb) that are also rogue taxa, unstable across bootstrap trees (GPR22,
GPR33, GPR135, GPR183, MRGPRD, MRGPRF); they are drawn at their place in the tree with lighter twigs, so they can be
hidden or toggled together. Other rogue taxa keep a family in GPCRdb and are drawn as ordinary class A receptors among
their relatives (ACKR1, which the 7TM tree puts among orphans, is drawn next to ACKR3). The orphan fan
at the centre holds GPR107, GPR137 and TPRA1, whose 7TM placements are unsupported, and the GOST-domain receptors
that are not in GPCRdb; GNRHR2, GPR32P1 and RGR are drawn next to their closest paralogue.

The names of the classes (`tools/tree_annotate.py`) are placed where there is room, outside the branches, and can be
shown with `classLabels`, each with room beside it for the labels of the receptors; drag a name to move it (double-click puts it back). The olfactory receptors are not in the non-olfactory tree: an arrow, in their colour, points outwards from the branch
where they join class A (the sister of the melanocortin, cannabinoid, LPA, S1P and GPR3/6/12 receptors in the 7TM
tree). They have a tree of their own, drawn the same way and shown instead of the non-olfactory tree (toggle at the top or `set tree=olfactory`);
there an arrow in the colour of class A shows where class A connects. The red Reset button clears the table, all
settings, moved labels and the saved session, and shows the non-olfactory tree again.

Labels (`js/labels.js`) go as close to their receptor as they can without covering another label, a marker or the
legend, and keep off the branches where there is room; a label that has to move away from its receptor gets a
leader line, routed clear of other labels, markers and leader lines. Dragged labels stay where they are.

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
- [x] Class labels on the tree (option)

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
- [x] Make the receptor labels and the class names draggable
- [x] Add a quick start tutorial
- [~] Web service to post data to the GPCRome (URL parameters and `postMessage` – a KNIME node can build on this)
