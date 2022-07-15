# GPCRome
Interactive plotter of the GPCR tree

---

## Need to haves:
* Cleanup and documentation of code + stripping redundant code/libraries
* Create proper interface/layout
* Create complete dictionary (and updatable) of all receptors + synonyms using different naming conventions
* SVG drawing/download
* GPCR receptor labeling with toggle
* Toggling and coloring of individual classes
* Interactive edit mode in Excel like format (e.g. [Handsontable](https://jspreadsheets.com/handsontable.html))
* CSV-type download and upload of settings
* Simple inline scripting functionality
* Download improvement in multiple outptus SVG/PNG/CSV
* Improve drawing order (first tree, then shapes ordered by size and type, finally draw receptor labels)

---

## Nice to haves:
* Link receptors to external databases
* If availabe, show the value used for drawing the shape for that receptor
* Integration of datasets:
  * ChEMBL (# unique ligands per receptor, # datapoints per receptor, overlapping ligands based on reference)
  * PDB/GPCRdb (# experimental structures, # unique ligands in structs)
  * Protein/mRNA expression data from Proteomics DB
    * Keep tissue selection in mind
  * GPCRdb - Sequence identity/similarity (7TM domain, full sequence)
  * GPCRdb/DrugCentral/DrugBank/GtP/ChEMBL - overview # drugs/clinical candidates/clinical phase
  * ...
* Sharing decorated GPCRomes via a unique link
* Undo/Redo option
* Make the receptor labels draggable
* Add a quick start tutorial
* Web service to post data to the GPCRome, also handy for creation of a KNIME node
