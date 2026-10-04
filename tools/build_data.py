"""Build js/data/receptors.js and js/data/datasets.js from the curated tables in data/.

  data/receptors.tsv  one row per receptor on the tree (positions in tree coordinates)
  data/synonyms.tsv   extra aliases (gene, synonym)
  data/gpcrdb.json    annotations from GPCRdb (refresh with tools/update_gpcrdb.py)
  data/datasets.json  ligands, expression, sequence and drug counts (tools/update_datasets.py)

Usage: python tools/build_data.py
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'


def read_tsv(name):
    with open(DATA / name, newline='') as f:
        return list(csv.DictReader(f, delimiter='\t'))


def split(value):
    return [v for v in (value or '').split(';') if v]


# kind: count (one number per receptor), reference (depends on a chosen receptor),
# tissue (depends on a chosen tissue). scale/valueMin/valueMax are the presets applied on load.
DATASET_SPECS = [
    {'id': 'structures', 'name': 'Experimental structures (all species)', 'source': 'GPCRdb', 'group': 'Structures', 'kind': 'count', 'scale': 'log'},
    {'id': 'structures_human', 'name': 'Experimental structures (human)', 'source': 'GPCRdb', 'group': 'Structures', 'kind': 'count', 'scale': 'log'},
    {'id': 'structure_ligands', 'name': 'Unique ligands in structures', 'source': 'GPCRdb', 'group': 'Structures', 'kind': 'count', 'scale': 'log'},
    {'id': 'chembl_ligands', 'name': 'Unique ligands', 'source': 'ChEMBL via GPCRdb', 'group': 'Ligands', 'kind': 'count', 'scale': 'log', 'needs': 'chembl_ligands'},
    {'id': 'chembl_datapoints', 'name': 'Bioactivity datapoints', 'source': 'ChEMBL via GPCRdb', 'group': 'Ligands', 'kind': 'count', 'scale': 'log', 'needs': 'chembl_datapoints'},
    {'id': 'chembl_overlap', 'name': 'Ligands shared with a reference', 'source': 'ChEMBL via GPCRdb', 'group': 'Ligands', 'kind': 'reference', 'matrix': 'chembl', 'scale': 'log', 'needs': 'chembl_sets'},
    {'id': 'gtopdb_ligands', 'name': 'Ligands with an interaction', 'source': 'Guide to Pharmacology', 'group': 'Ligands', 'kind': 'count', 'scale': 'log', 'needs': 'gtopdb_ligands'},
    {'id': 'gtopdb_overlap', 'name': 'Ligands shared with a reference', 'source': 'Guide to Pharmacology', 'group': 'Ligands', 'kind': 'reference', 'matrix': 'gtp', 'scale': 'log', 'needs': 'gtp_sets'},
    {'id': 'identity_7tm', 'name': '7TM sequence identity (%)', 'source': 'GPCRdb', 'group': 'Sequence', 'kind': 'reference', 'matrix': 'identity_7tm', 'scale': 'linear', 'valueMin': 0, 'valueMax': 100, 'palette': 'red-yellow-green', 'needs': 'sequence'},
    {'id': 'similarity_7tm', 'name': '7TM sequence similarity (%)', 'source': 'GPCRdb', 'group': 'Sequence', 'kind': 'reference', 'matrix': 'similarity_7tm', 'scale': 'linear', 'valueMin': 0, 'valueMax': 100, 'palette': 'red-yellow-green', 'needs': 'sequence'},
    {'id': 'identity_full', 'name': 'Full-sequence identity (%)', 'source': 'GPCRdb', 'group': 'Sequence', 'kind': 'reference', 'matrix': 'identity_full', 'scale': 'linear', 'valueMin': 0, 'valueMax': 100, 'palette': 'red-yellow-green', 'needs': 'sequence'},
    {'id': 'similarity_full', 'name': 'Full-sequence similarity (%)', 'source': 'GPCRdb', 'group': 'Sequence', 'kind': 'reference', 'matrix': 'similarity_full', 'scale': 'linear', 'valueMin': 0, 'valueMax': 100, 'palette': 'red-yellow-green', 'needs': 'sequence'},
    {'id': 'expr_protein', 'name': 'Protein expression', 'source': 'ProteomicsDB', 'group': 'Expression', 'kind': 'tissue', 'expr': 'protein', 'scale': 'linear', 'sizeByValue': False, 'needs': 'protein'},
    {'id': 'expr_mrna', 'name': 'mRNA expression (TPM)', 'source': 'ProteomicsDB', 'group': 'Expression', 'kind': 'tissue', 'expr': 'mrna', 'scale': 'log', 'needs': 'mrna'},
    {'id': 'gpcrdb_approved', 'name': 'Approved drugs', 'source': 'GPCRdb', 'group': 'Drugs', 'kind': 'count', 'scale': 'log', 'needs': 'gpcrdb_approved',
     'detail': 'Integrated from DrugBank, ChEMBL and Guide to Pharmacology'},
    {'id': 'gpcrdb_clinical', 'name': 'Clinical candidates (phase 1–3)', 'source': 'GPCRdb', 'group': 'Drugs', 'kind': 'count', 'scale': 'log', 'needs': 'gpcrdb_clinical'},
    {'id': 'gpcrdb_phase3', 'name': 'Phase 3 candidates', 'source': 'GPCRdb', 'group': 'Drugs', 'kind': 'count', 'scale': 'linear', 'sizeByValue': False, 'needs': 'gpcrdb_phase3'},
    {'id': 'gpcrdb_phase2', 'name': 'Phase 2 candidates', 'source': 'GPCRdb', 'group': 'Drugs', 'kind': 'count', 'scale': 'linear', 'sizeByValue': False, 'needs': 'gpcrdb_phase2'},
    {'id': 'gpcrdb_phase1', 'name': 'Phase 1 candidates', 'source': 'GPCRdb', 'group': 'Drugs', 'kind': 'count', 'scale': 'linear', 'sizeByValue': False, 'needs': 'gpcrdb_phase1'},
    {'id': 'gpcrdb_max_phase', 'name': 'Highest clinical phase', 'source': 'GPCRdb', 'group': 'Drugs', 'kind': 'count', 'scale': 'linear', 'valueMin': 1, 'valueMax': 4, 'sizeByValue': False, 'needs': 'gpcrdb_max_phase'},
    {'id': 'chembl_approved', 'name': 'Approved drugs', 'source': 'ChEMBL', 'group': 'Drugs', 'kind': 'count', 'scale': 'log', 'needs': 'chembl_approved'},
    {'id': 'chembl_clinical', 'name': 'Clinical candidates (phase 1–3)', 'source': 'ChEMBL', 'group': 'Drugs', 'kind': 'count', 'scale': 'log', 'needs': 'chembl_clinical'},
    {'id': 'gtopdb_approved', 'name': 'Approved drugs', 'source': 'Guide to Pharmacology', 'group': 'Drugs', 'kind': 'count', 'scale': 'log', 'needs': 'gtopdb_approved'},
    {'id': 'drugcentral_moa', 'name': 'Drugs with a mechanism of action', 'source': 'DrugCentral', 'group': 'Drugs', 'kind': 'count', 'scale': 'log', 'needs': 'drugcentral_moa'},
    {'id': 'drugcentral_drugs', 'name': 'Drugs with a measured interaction', 'source': 'DrugCentral', 'group': 'Drugs', 'kind': 'count', 'scale': 'log', 'needs': 'drugcentral_drugs'},
]


def dataset_available(spec, extra):
    needs = spec.get('needs')
    if needs == 'chembl_sets':
        return bool(extra.get('ligands', {}).get('chembl'))
    if needs == 'gtp_sets':
        return bool(extra.get('ligands', {}).get('gtp'))
    if needs == 'sequence':
        return bool(extra.get('sequence', {}).get('genes'))
    if needs == 'protein':
        return bool(extra.get('expression', {}).get('protein', {}).get('tissues'))
    if needs == 'mrna':
        return bool(extra.get('expression', {}).get('mrna', {}).get('tissues'))
    if needs:
        return any(needs in fields for fields in extra.get('counts', {}).values())
    return True


def public_spec(spec):
    return {k: v for k, v in spec.items() if k != 'needs'}


def intern_names(table):
    vocab = {}
    out = {}
    for gene, names in (table or {}).items():
        ids = []
        seen = set()
        for name in names:
            if name not in vocab:
                vocab[name] = len(vocab)
            ident = vocab[name]
            if ident not in seen:
                seen.add(ident)
                ids.append(ident)
        if ids:
            out[gene] = ids
    return out


def intern_ints(table):
    out = {}
    for gene, ids in (table or {}).items():
        seen = set()
        uniq = []
        for ident in ids:
            if ident not in seen:
                seen.add(ident)
                uniq.append(ident)
        if uniq:
            out[gene] = uniq
    return out


def load_extra():
    path = DATA / 'datasets.json'
    if not path.exists():
        return {}
    doc = json.loads(path.read_text())
    sequence = doc.get('sequence') or {}
    expression = doc.get('expression') or {}
    ligands = doc.get('ligands') or {}
    extra = {
        'counts': doc.get('counts') or {},
        'ligands': {},
        'sequence': {k: sequence[k] for k in ('genes', 'identity_7tm', 'similarity_7tm', 'identity_full', 'similarity_full') if k in sequence},
        'expression': {},
    }
    if ligands.get('chembl'):
        extra['ligands']['chembl'] = intern_names(ligands['chembl'])
    if ligands.get('gtp'):
        extra['ligands']['gtp'] = intern_ints(ligands['gtp'])
    for kind in ('protein', 'mrna'):
        table = expression.get(kind) or {}
        if table.get('tissues'):
            extra['expression'][kind] = {
                'tissues': table['tissues'],
                'unit': table.get('unit'),
                'values': table.get('values') or {},
            }
    return extra


def main():
    extra = load_extra()
    rows = read_tsv('receptors.tsv')
    synonyms = {}
    for s in read_tsv('synonyms.tsv'):
        synonyms.setdefault(s['gene'], []).append(s['synonym'])
    gpcrdb = json.loads((DATA / 'gpcrdb.json').read_text())

    by_acc, by_gene = {}, {}
    for g in gpcrdb['receptors']:
        by_acc[g['accession']] = g
        for gene in g['genes']:
            by_gene.setdefault(gene.upper(), g)

    receptors, used = [], set()
    for r in rows:
        accs = split(r['uniprot'])
        g = next((by_acc[a] for a in accs if a in by_acc), None) or by_gene.get(r['gene'])
        if g:
            used.add(g['entry_name'])
            if g['accession'] in accs:
                accs.remove(g['accession'])
                accs.insert(0, g['accession'])
        rec = {
            'id': r['gene'],
            'name': r['name'],
            'cls': r['class'],
            'x': float(r['x']),
            'y': float(r['y']),
            'angle': int(r['angle']),
            'uniprot': accs,
            'entry': split(r['uniprot_entry']),
            'hgnc': split(r['hgnc']),
            'chembl': split(r['chembl']),
            'synonyms': synonyms.get(r['gene'], []),
        }
        counts = extra.get('counts', {}).get(r['gene'], {})
        if g or counts:
            rec['data'] = {}
        if g:
            rec['gpcrdb'] = {k: g[k] for k in ('entry_name', 'name', 'family', 'ligand_type')}
            rec['data'].update({
                'structures': g['structures'],
                'structures_human': g['structures_human'],
                'structure_ligands': g['structure_ligands'],
            })
        for key, value in counts.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                rec['data'][key] = value
        receptors.append(rec)

    off_tree = [{'id': (g['genes'] or [g['entry_name'].split('_')[0].upper()])[0], 'entry': g['entry_name'],
                 'uniprot': g['accession'], 'cls': g['class'], 'name': g['name']}
                for g in gpcrdb['receptors'] if g['entry_name'] not in used]

    # Detect identifiers that resolve to more than one receptor
    owners = {}
    for rec in receptors:
        keys = {rec['id'], *rec['uniprot'], *rec['entry'], *rec['hgnc'], *rec['chembl'], *rec['synonyms']}
        if 'gpcrdb' in rec:
            keys.add(rec['gpcrdb']['entry_name'])
        for k in keys:
            owners.setdefault(k.upper(), set()).add(rec['id'])
    clashes = {k: sorted(v) for k, v in owners.items() if len(v) > 1}
    for k, v in sorted(clashes.items()):
        print(f'warning: identifier {k} is shared by {", ".join(v)}', file=sys.stderr)

    datasets = [public_spec(spec) for spec in DATASET_SPECS if dataset_available(spec, extra)]
    out = {'updated': gpcrdb['date'], 'datasets': datasets, 'receptors': receptors, 'offTree': off_tree}
    path = ROOT / 'js' / 'data' / 'receptors.js'
    path.write_text('/* Generated by tools/build_data.py - do not edit by hand */\n'
                    f'window.GPCROME_DATA = {json.dumps(out, separators=(",", ":"), ensure_ascii=False)};\n')
    browser_extra = {
        'ligands': extra.get('ligands') or {},
        'sequence': {k: v for k, v in (extra.get('sequence') or {}).items() if k != 'counts'},
        'expression': extra.get('expression') or {},
    }
    extra_path = ROOT / 'js' / 'data' / 'datasets.js'
    extra_path.write_text('/* Generated by tools/build_data.py - do not edit by hand */\n'
                          f'window.GPCROME_EXTRA = {json.dumps(browser_extra, separators=(",", ":"), ensure_ascii=False)};\n')
    missing = [r['id'] for r in receptors if 'gpcrdb' not in r]
    print(f'{len(receptors)} receptors ({len(off_tree)} off-tree) -> {path.relative_to(ROOT)}')
    if missing:
        print('not found in GPCRdb:', ' '.join(missing))


if __name__ == '__main__':
    main()
