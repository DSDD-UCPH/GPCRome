"""Download the optional GPCRome datasets into data/datasets.json.

Sources, all public and refreshed on each run (ligand, expression and drug
responses are cached under data/cache so a rerun only fetches what is missing):

  ChEMBL ligands and bioactivities   GPCRdb /services/ligands (Source = ChEMBL)
  Ligand overlap                     same ligand names, compared in the browser
  Guide to Pharmacology              interactions.csv (human targets)
  Sequence identity and similarity   GPCRdb 7TM and full-length alignments,
                                     percent identity and BLOSUM62 similarity
  Protein expression                 ProteomicsDB protein expression by tissue
  mRNA expression                    ProteomicsDB / Human Protein Atlas RNA-seq (TPM)
  Drugs and clinical phase           GPCRdb /services/drugs (DrugBank, ChEMBL and
                                     Guide to Pharmacology), ChEMBL mechanisms,
                                     DrugCentral drug-target interactions

DrugBank does not publish an open target table; its approval and phase data
are included through the GPCRdb drug set.

Usage:
  python tools/update_datasets.py
  python tools/update_datasets.py --only sequence,drugs
  python tools/update_datasets.py --refresh
  python tools/update_datasets.py --set olfactory      # the olfactory tree -> data/datasets_olfactory.json
  (needs data/olfactory.tsv from tools/build_tree.py)
Then run tools/build_data.py.
"""
import argparse
import base64
import csv
import datetime
import gzip
import io
import json
import ssl
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = None

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
CACHE = DATA / 'cache'
GPCRDB = 'https://gpcrdb.org/services'
CHEMBL = 'https://www.ebi.ac.uk/chembl/api/data/mechanism.json'
GTP_INTERACTIONS = 'https://www.guidetopharmacology.org/DATA/interactions.csv'
GTP_TARGETS = 'https://www.guidetopharmacology.org/DATA/targets_and_families.csv'
DRUGCENTRAL = 'https://unmtid-dbs.net/download/drug.target.interaction.tsv.gz'
PROTEOMICS = 'https://www.proteomicsdb.org/proteomicsdb/logic'
HEADERS = {'User-Agent': 'GPCRome-data/1.0', 'Accept': 'application/json'}
CACHE_VERSION = 1
# The receptors the datasets are collected for: the non-olfactory tree and, separately, the olfactory tree.
# The alignments are merged on an anchor receptor and checked against the identity GPCRdb publishes for a pair.
SETS = {
    'nonolfactory': {'table': 'receptors.tsv', 'out': 'datasets.json', 'anchor': 'adrb2_human', 'pair': 'adrb1_human'},
    'olfactory': {'table': 'olfactory.tsv', 'out': 'datasets_olfactory.json', 'anchor': 'o51e2_human', 'pair': 'o51g1_human'},
}
ENSEMBL_SYMBOL = 'https://rest.ensembl.org/xrefs/symbol/homo_sapiens/{}?content-type=application/json;object_type=gene'
TM_SUFFIX = '/TM1,TM2,TM3,TM4,TM5,TM6,TM7/'
FULL_SUFFIX = '/'


def fetch(url, timeout=120, attempts=4, accept=None):
    headers = dict(HEADERS)
    if accept:
        headers['Accept'] = accept
    delay = 2
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise
            if exc.code in (429, 500, 502, 503, 504) and attempt + 1 < attempts:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt + 1 < attempts:
                time.sleep(delay)
                delay *= 2
                continue
            raise


def fetch_json(url, timeout=120):
    return json.loads(fetch(url, timeout=timeout))


def split(value):
    return [v for v in (value or '').split(';') if v]


def load_tree(table):
    gpcrdb = json.loads((DATA / 'gpcrdb.json').read_text())
    by_acc = {g['accession']: g for g in gpcrdb['receptors']}
    by_gene = {}
    for g in gpcrdb['receptors']:
        for gene in g['genes']:
            by_gene.setdefault(gene.upper(), g)
    rows = []
    with open(DATA / table, newline='') as handle:
        for r in csv.DictReader(handle, delimiter='\t'):
            accs = split(r['uniprot'])
            g = next((by_acc[a] for a in accs if a in by_acc), None) or by_gene.get(r['gene'].upper())
            rows.append({
                'gene': r['gene'],
                'accessions': accs,
                'chembl': split(r['chembl']),
                'entry': g['entry_name'] if g else None,
            })
    return rows


def gtp_reader(url):
    raw = fetch(url, timeout=180, accept='text/csv')
    lines = raw.decode('utf-8-sig').splitlines()
    while lines and lines[0].lstrip('"').startswith('#'):
        lines.pop(0)
    return list(csv.DictReader(io.StringIO('\n'.join(lines))))


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':'), ensure_ascii=False))
    tmp.replace(path)


def load_cached(path):
    if not path.exists():
        return None
    try:
        doc = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    if doc.get('v') != CACHE_VERSION:
        return None
    return doc


# ---------------------------------------------------------------------------
# Sequence identity / similarity
# ---------------------------------------------------------------------------

def load_blosum():
    lines = [ln for ln in (ROOT / 'tools' / 'BLOSUM62').read_text().splitlines() if ln and not ln.startswith('#')]
    header = lines[0].split()
    matrix = {}
    for ln in lines[1:]:
        parts = ln.split()
        for aa, val in zip(header, parts[1:]):
            matrix[(parts[0], aa)] = int(val)
    return matrix


def request_line_len(names, suffix):
    path = '/services/alignment/protein/' + ','.join(names) + suffix
    return len('GET ' + path + ' HTTP/1.1')


def parse_alignment(data):
    if not isinstance(data, dict):
        raise RuntimeError('alignment response was not an object')
    out = {}
    for key, value in data.items():
        if key == 'statistics':
            continue
        if isinstance(value, str):
            out[key] = value
        elif isinstance(value, dict) and isinstance(value.get('AA'), str):
            out[key] = value['AA']
    return out


def gap_align(left, right):
    """Align two copies of the same sequence that differ only by gap columns."""
    i = j = 0
    pairs = []
    while i < len(left) or j < len(right):
        if i < len(left) and j < len(right) and left[i] == right[j]:
            pairs.append((i, j))
            i += 1
            j += 1
        elif i < len(left) and left[i] == '-':
            pairs.append((i, None))
            i += 1
        elif j < len(right) and right[j] == '-':
            pairs.append((None, j))
            j += 1
        else:
            raise RuntimeError('batched alignments could not be merged')
    return pairs


def merge_alignments(anchor, left, right):
    if not left:
        return right
    if not right:
        return left
    pairs = gap_align(left[anchor], right[anchor])
    keys = list(dict.fromkeys(list(left) + list(right)))
    cols = {k: [] for k in keys}
    for i, j in pairs:
        for key, seq in left.items():
            cols[key].append(seq[i] if i is not None else '-')
        for key, seq in right.items():
            if key in left:
                continue
            cols[key].append(seq[j] if j is not None else '-')
    return {k: ''.join(v) for k, v in cols.items()}


def fetch_alignment_group(names, suffix, anchor):
    """One alignment in a shared column set. Splits when the URL is too long or a name is rejected."""
    names = [anchor] + [n for n in dict.fromkeys(names) if n != anchor]
    if len(names) < 2:
        return {}
    if request_line_len(names, suffix) > 4000 and len(names) > 2:
        others = names[1:]
        mid = len(others) // 2
        return merge_alignments(
            anchor,
            fetch_alignment_group(others[:mid], suffix, anchor),
            fetch_alignment_group(others[mid:], suffix, anchor),
        )
    url = f'{GPCRDB}/alignment/protein/{",".join(names)}{suffix}'
    try:
        data = parse_alignment(fetch_json(url, timeout=300))
    except urllib.error.HTTPError as exc:
        others = names[1:]
        if len(others) <= 1:
            print(f'  skipping {others or names}: HTTP {exc.code}')
            if others:
                return fetch_alignment_group([], suffix, anchor)
            raise
        mid = len(others) // 2
        print(f'  alignment of {len(names)} failed (HTTP {exc.code}); splitting')
        return merge_alignments(
            anchor,
            fetch_alignment_group(others[:mid], suffix, anchor),
            fetch_alignment_group(others[mid:], suffix, anchor),
        )
    if anchor not in data:
        raise RuntimeError(f'{anchor} missing from alignment')
    return data


def pair_scores(seq_a, seq_b, blosum):
    """GPCRdb definitions: skip columns where both sides are gaps; similarity is BLOSUM62 > 0."""
    same = similar = length = 0
    for aa, bb in zip(seq_a, seq_b):
        if aa == '-' and bb == '-':
            continue
        length += 1
        if aa != '-' and bb != '-':
            if aa == bb:
                same += 1
            if blosum.get((aa, bb), -99) > 0:
                similar += 1
    if not length:
        return 0, 0
    return int(round(1000 * same / length)), int(round(1000 * similar / length))


def pack_u16(values):
    parts = []
    for start in range(0, len(values), 8000):
        chunk = values[start:start + 8000]
        parts.append(struct.pack('<' + 'H' * len(chunk), *chunk))
    return base64.b64encode(b''.join(parts)).decode('ascii')


def check_against_api(aligned, entry_to_gene, blosum, anchor, other):
    """The merged 7TM alignment has to reproduce GPCRdb's published identity and similarity."""
    remote = fetch_json(f'{GPCRDB}/alignment/similarity/{anchor},{other}/TM1,TM2,TM3,TM4,TM5,TM6,TM7/')
    got_i, got_s = pair_scores(aligned[anchor], aligned[other], blosum)
    expect_i = int(round(remote[other]['identity'] * 10))
    expect_s = int(round(remote[other]['similarity'] * 10))
    if abs(got_i - expect_i) > 1 or abs(got_s - expect_s) > 1:
        raise RuntimeError(f'7TM scores {got_i / 10}, {got_s / 10} != GPCRdb {expect_i / 10}, {expect_s / 10}')
    gene_a, gene_b = entry_to_gene[anchor], entry_to_gene[other]
    print(f'  7TM {gene_b} vs {gene_a}: identity {got_i / 10}%, similarity {got_s / 10}% (matches GPCRdb)')


def build_sequence(tree, anchor, other):
    blosum = load_blosum()
    entry_to_gene = {r['entry']: r['gene'] for r in tree if r['entry']}
    for entry in (anchor, other):
        if entry not in entry_to_gene:
            raise RuntimeError(f'{entry} is not on the tree')
    entries = sorted(entry_to_gene)
    print(f'  aligning {len(entries)} receptors')
    tm = fetch_alignment_group(entries, TM_SUFFIX, anchor)
    full = fetch_alignment_group(entries, FULL_SUFFIX, anchor)
    for label, seqs in (('7TM', tm), ('full sequence', full)):
        lengths = {len(seq) for seq in seqs.values()}
        if len(lengths) != 1:
            raise RuntimeError(f'{label} alignment columns are inconsistent ({sorted(lengths)[:4]}…)')
        print(f'  {label}: {len(seqs)} sequences, {lengths.pop()} columns')
    check_against_api(tm, entry_to_gene, blosum, anchor, other)
    covered = [e for e in entries if e in tm and e in full]
    gene_of = {e: entry_to_gene[e] for e in covered}
    genes = sorted(set(gene_of.values()))
    index = {g: i for i, g in enumerate(genes)}
    print(f'  scoring {len(genes)} x {len(genes)}')
    packed = {}
    n = len(genes)
    for label, seqs in (('7tm', tm), ('full', full)):
        identity = [0] * (n * n)
        similarity = [0] * (n * n)
        order = [e for e in covered if e in seqs]
        for a_i, entry_a in enumerate(order):
            i = index[gene_of[entry_a]]
            seq_a = seqs[entry_a]
            for entry_b in order[a_i:]:
                j = index[gene_of[entry_b]]
                ident, sim = pair_scores(seq_a, seqs[entry_b], blosum)
                identity[i * n + j] = identity[j * n + i] = ident
                similarity[i * n + j] = similarity[j * n + i] = sim
        prefix = '7tm' if label == '7tm' else 'full'
        packed[f'identity_{prefix}'] = pack_u16(identity)
        packed[f'similarity_{prefix}'] = pack_u16(similarity)
    print(f'  sequence matrices for {len(genes)} receptors ({len(entries) - len(covered)} without an alignment)')
    return {'genes': genes, **packed}


# ---------------------------------------------------------------------------
# Drugs, Guide to Pharmacology, ChEMBL mechanisms, DrugCentral
# ---------------------------------------------------------------------------

def truthy(value):
    return str(value or '').strip().lower() in ('true', 't', 'yes', 'y', '1', 'approved')


def summarize_gpcrdb_drugs(rows):
    by_name = {}
    for row in rows:
        name = ' '.join((row.get('name') or '').split()).casefold()
        if not name:
            continue
        try:
            phase = int(row.get('clinical') or 0)
        except (TypeError, ValueError):
            phase = 0
        rec = by_name.setdefault(name, {'phase': 0, 'approved': False})
        rec['phase'] = max(rec['phase'], phase)
        if str(row.get('status') or '').strip().lower() == 'approved' or phase >= 4:
            rec['approved'] = True
    phases = Counter()
    approved = clinical = max_phase = 0
    for rec in by_name.values():
        max_phase = max(max_phase, rec['phase'])
        if rec['approved']:
            approved += 1
            continue
        if rec['phase'] in (1, 2, 3):
            clinical += 1
            phases[rec['phase']] += 1
    return {
        'gpcrdb_approved': approved,
        'gpcrdb_clinical': clinical,
        'gpcrdb_phase1': phases[1],
        'gpcrdb_phase2': phases[2],
        'gpcrdb_phase3': phases[3],
        'gpcrdb_max_phase': max_phase,
    }


def empty_drug_counts():
    return summarize_gpcrdb_drugs([])


def fetch_gpcrdb_drug_rows(entry, refresh):
    path = CACHE / 'drugs' / f'{entry}.json'
    cached = None if refresh else load_cached(path)
    if cached is not None:
        return cached['rows']
    try:
        payload = fetch_json(f'{GPCRDB}/drugs/{entry}/', timeout=120)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            payload = []
        else:
            raise
    rows = [{'name': r.get('name'), 'clinical': r.get('clinical'), 'status': r.get('status')} for r in payload or []]
    write_json(path, {'v': CACHE_VERSION, 'rows': rows})
    return rows


def build_gpcrdb_drugs(tree, refresh, workers):
    counts = {r['gene']: empty_drug_counts() for r in tree}
    jobs = [r for r in tree if r['entry']]
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_gpcrdb_drug_rows, r['entry'], refresh): r for r in jobs}
        for future in as_completed(futures):
            rec = futures[future]
            counts[rec['gene']] = summarize_gpcrdb_drugs(future.result())
            done += 1
            if done % 50 == 0 or done == len(jobs):
                print(f'  GPCRdb drugs {done}/{len(jobs)}')
    with_drugs = sum(1 for c in counts.values() if c['gpcrdb_approved'] or c['gpcrdb_clinical'])
    print(f'  {with_drugs} receptors with an approved drug or clinical candidate in GPCRdb')
    return counts


def build_chembl_mechanisms(tree):
    by_target = defaultdict(dict)
    offset = 0
    total = None
    while True:
        url = (f'{CHEMBL}?limit=1000&offset={offset}'
               '&only=target_chembl_id,parent_molecule_chembl_id,molecule_chembl_id,max_phase')
        data = fetch_json(url, timeout=180)
        rows = data.get('mechanisms') or []
        total = data.get('page_meta', {}).get('total_count', total)
        for row in rows:
            parent = row.get('parent_molecule_chembl_id') or row.get('molecule_chembl_id')
            phase = row.get('max_phase')
            if not parent or phase is None:
                continue
            phase = float(phase)
            current = by_target[row['target_chembl_id']].get(parent)
            if current is None or phase > current:
                by_target[row['target_chembl_id']][parent] = phase
        offset += len(rows)
        print(f'  ChEMBL mechanisms {offset}/{total}')
        if not rows or (total is not None and offset >= total):
            break
    counts = {}
    for rec in tree:
        phases = {}
        for chembl_id in rec['chembl']:
            for parent, phase in by_target.get(chembl_id, {}).items():
                if parent not in phases or phase > phases[parent]:
                    phases[parent] = phase
        counts[rec['gene']] = {
            'chembl_approved': sum(1 for phase in phases.values() if phase >= 4),
            'chembl_clinical': sum(1 for phase in phases.values() if 0 < phase < 4),
        }
    print(f'  {sum(1 for c in counts.values() if c["chembl_approved"] or c["chembl_clinical"])} receptors with a ChEMBL drug mechanism')
    return counts


def build_gtopdb(tree):
    genes = {r['gene'].upper(): r['gene'] for r in tree}
    acc_to_gene = {}
    for rec in tree:
        for acc in rec['accessions']:
            acc_to_gene.setdefault(acc, rec['gene'])
    rows = gtp_reader(GTP_INTERACTIONS)
    ligands = defaultdict(set)
    approved = defaultdict(set)
    approved_values = Counter()
    for row in rows:
        if (row.get('Target Species') or '').strip().lower() != 'human':
            continue
        gene = genes.get((row.get('Target Gene Symbol') or '').strip().upper())
        if not gene:
            for acc in split(row.get('Target UniProt ID')):
                gene = acc_to_gene.get(acc)
                if gene:
                    break
        if not gene:
            continue
        try:
            ligand_id = int(row.get('Ligand ID'))
        except (TypeError, ValueError):
            continue
        ligands[gene].add(ligand_id)
        flag = (row.get('Approved') or '').strip().lower()
        approved_values[flag] += 1
        if truthy(flag):
            approved[gene].add(ligand_id)
    print('  GtP Approved column:', dict(approved_values))
    counts = {}
    ligand_sets = {}
    for rec in tree:
        gene = rec['gene']
        ids = sorted(ligands.get(gene, ()))
        counts[gene] = {'gtopdb_ligands': len(ids), 'gtopdb_approved': len(approved.get(gene, ()))}
        if ids:
            ligand_sets[gene] = ids
    print(f'  GtP interactions for {sum(1 for c in counts.values() if c["gtopdb_ligands"])} receptors')
    return counts, ligand_sets


def ensembl_gene(symbol, refresh):
    """The Ensembl gene id of a gene symbol, from Ensembl's REST service (cached); None if there is none."""
    path = CACHE / 'ensembl' / f'{symbol}.json'
    cached = None if refresh else load_cached(path)
    if cached is not None:
        return cached['id']
    for attempt in range(4):
        try:
            rows = fetch_json(ENSEMBL_SYMBOL.format(urllib.parse.quote(symbol)), timeout=60)
            break
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404):
                rows = []
                break
            time.sleep(2 * (attempt + 1))
        except (OSError, ValueError):               # dropped connection (Ensembl limits the rate): wait and retry
            time.sleep(2 * (attempt + 1))
    else:
        return None                                  # not cached, so a later run asks again
    found = next((r['id'] for r in rows if str(r.get('id', '')).startswith('ENSG')), None)
    write_json(path, {'v': CACHE_VERSION, 'id': found})
    return found


def build_ensembl(tree, refresh=False, workers=2):
    genes = {r['gene'].upper(): r['gene'] for r in tree}
    rows = gtp_reader(GTP_TARGETS)
    found = {}
    for row in rows:
        symbol = (row.get('HGNC symbol') or '').strip().upper()
        gene = genes.get(symbol)
        if not gene or gene in found:
            continue
        text = ' '.join(str(v or '') for v in row.values())
        # Prefer the dedicated column when the header varies slightly between releases.
        column = next((k for k in row if 'ensembl' in k.lower() and 'human' in k.lower()), None)
        ids = []
        source = row.get(column) if column else ''
        for token in str(source or text).replace('|', ' ').replace(';', ' ').split():
            if token.startswith('ENSG'):
                ids.append(token)
        if ids:
            found[gene] = ids[0]
    # symbols that Guide to Pharmacology does not list (most olfactory receptors): ask Ensembl
    missing = sorted(g for g in genes.values() if g not in found)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for gene, ens in zip(missing, pool.map(lambda g: ensembl_gene(g, refresh), missing)):
            if ens:
                found[gene] = ens
    print(f'  Ensembl ids for {len(found)}/{len(tree)} receptors')
    return found


def build_drugcentral(tree):
    genes = {r['gene'].upper(): r['gene'] for r in tree}
    acc_to_gene = {}
    for rec in tree:
        for acc in rec['accessions']:
            acc_to_gene.setdefault(acc, rec['gene'])
    raw = fetch(DRUGCENTRAL, timeout=180, accept='application/gzip')
    text = gzip.decompress(raw).decode('utf-8')
    drugs = defaultdict(set)
    moa = defaultdict(set)
    for row in csv.DictReader(io.StringIO(text), delimiter='\t'):
        if (row.get('ORGANISM') or '').strip() != 'Homo sapiens':
            continue
        if (row.get('TARGET_CLASS') or '').strip() != 'GPCR':
            continue
        gene = genes.get((row.get('GENE') or '').strip().upper()) or acc_to_gene.get((row.get('ACCESSION') or '').strip())
        if not gene:
            continue
        drug_id = (row.get('STRUCT_ID') or row.get('DRUG_NAME') or '').strip()
        if not drug_id:
            continue
        drugs[gene].add(drug_id)
        if (row.get('MOA') or '').strip() == '1':
            moa[gene].add(drug_id)
    counts = {}
    for rec in tree:
        gene = rec['gene']
        counts[gene] = {'drugcentral_drugs': len(drugs.get(gene, ())), 'drugcentral_moa': len(moa.get(gene, ()))}
    print(f'  DrugCentral interactions for {sum(1 for c in counts.values() if c["drugcentral_drugs"])} receptors')
    return counts


# ---------------------------------------------------------------------------
# ChEMBL ligands via GPCRdb
# ---------------------------------------------------------------------------

def summarize_chembl_ligands(payload):
    names = set()
    datapoints = 0
    for row in payload:
        if row.get('Source') != 'ChEMBL':
            continue
        datapoints += 1
        name = ' '.join((row.get('Ligand name') or '').split()).casefold()
        if name:
            names.add(name)
    return {'datapoints': datapoints, 'ligands': sorted(names)}


def fetch_ligand_summary(entry, refresh):
    path = CACHE / 'ligands' / f'{entry}.json'
    cached = None if refresh else load_cached(path)
    if cached is not None:
        return cached
    try:
        payload = fetch_json(f'{GPCRDB}/ligands/{entry}/', timeout=180)
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        payload = []
    summary = summarize_chembl_ligands(payload if isinstance(payload, list) else [])
    summary['v'] = CACHE_VERSION
    write_json(path, summary)
    return summary


def build_ligands(tree, refresh, workers):
    counts = {}
    ligands = {}
    jobs = [r for r in tree if r['entry']]
    failed = []
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_ligand_summary, r['entry'], refresh): r for r in jobs}
        for future in as_completed(futures):
            rec = futures[future]
            done += 1
            try:
                summary = future.result()
            except Exception as exc:
                failed.append((rec['gene'], str(exc)))
                print(f'  ligand failed {rec["gene"]}: {exc}')
                continue
            counts[rec['gene']] = {'chembl_ligands': len(summary['ligands']), 'chembl_datapoints': summary['datapoints']}
            if summary['ligands']:
                ligands[rec['gene']] = summary['ligands']
            if done % 25 == 0 or done == len(jobs):
                print(f'  ChEMBL ligands {done}/{len(jobs)}')
    for rec in tree:
        counts.setdefault(rec['gene'], {'chembl_ligands': 0, 'chembl_datapoints': 0})
    print(f'  {sum(1 for c in counts.values() if c["chembl_ligands"])} receptors with ChEMBL ligands, {len(failed)} failed')
    return counts, ligands, failed


# ---------------------------------------------------------------------------
# ProteomicsDB expression
# ---------------------------------------------------------------------------

def protein_expression(accession):
    url = (
        f'{PROTEOMICS}/api/proteinexpression.xsodata/InputParams('
        f"PROTEINFILTER='{accession}',MS_LEVEL=1,TISSUE_ID_SELECTION='',"
        "TISSUE_CATEGORY_SELECTION='tissue;fluid',SCOPE_SELECTION=1,GROUP_BY_TISSUE=1,"
        'CALCULATION_METHOD=0,EXP_ID=-1)/Results?'
        '$select=TISSUE_NAME,NORMALIZED_INTENSITY&$format=json'
    )
    data = fetch_json(url, timeout=90)
    totals = defaultdict(list)
    for row in data.get('d', {}).get('results', []):
        name = (row.get('TISSUE_NAME') or '').strip()
        if not name or row.get('NORMALIZED_INTENSITY') in (None, ''):
            continue
        totals[name].append(float(row['NORMALIZED_INTENSITY']))
    return {name: round(sum(vals) / len(vals), 3) for name, vals in totals.items()}


def hpa_tissues():
    """Anatomical tissues in the Human Protein Atlas RNA-seq experiment hosted by ProteomicsDB."""
    url = (f'{PROTEOMICS}/api_v2/api.xsodata/OmicsSample?$format=json&$top=500'
           '&$select=OmicsSampleId,TissueName&$filter=OmicsExperimentId%20eq%200')
    samples = fetch_json(url)['d']['results']
    tissues = {}
    for sample in samples:
        name = (sample.get('TissueName') or '').strip()
        # Cell-line symbols (MCF7, hTCEpi) are not lowercase anatomical names.
        if not name or name != name.lower() or not name[0].isalpha():
            continue
        tissues.setdefault(name, []).append(sample['OmicsSampleId'])
    return tissues


def mrna_expression(ensembl, measurement_ids):
    clauses = ' or '.join(f'MeasurementId eq {i}' for i in measurement_ids)
    filt = urllib.parse.quote(f"ProbeAccession eq '{ensembl}' and ({clauses})")
    url = (f'{PROTEOMICS}/api_v2/api.xsodata/OmicsExpression?$format=json&$top=500'
           f'&$select=MeasurementId,Value&$filter={filt}')
    rows = fetch_json(url, timeout=90).get('d', {}).get('results', [])
    return {row['MeasurementId']: float(row['Value']) for row in rows if row.get('Value') not in (None, '')}


def build_expression(tree, ensembl, refresh, workers):
    protein_cache_path = CACHE / 'protein_expression.json'
    protein_cache = {} if refresh else (load_cached(protein_cache_path) or {}).get('by_accession', {})
    accessions = sorted({acc for rec in tree for acc in rec['accessions'] if acc not in protein_cache})
    print(f'  protein expression: {len(accessions)} accessions to fetch, {len(protein_cache)} cached')

    def fetch_protein(acc):
        try:
            return acc, protein_expression(acc), None
        except Exception as exc:
            return acc, None, str(exc)

    failed = []
    if accessions:
        done = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for acc, values, err in pool.map(fetch_protein, accessions):
                done += 1
                if err:
                    failed.append((acc, err))
                else:
                    protein_cache[acc] = values
                if done % 40 == 0 or done == len(accessions):
                    print(f'  protein expression {done}/{len(accessions)}')
                    write_json(protein_cache_path, {'v': CACHE_VERSION, 'by_accession': protein_cache})
        write_json(protein_cache_path, {'v': CACHE_VERSION, 'by_accession': protein_cache})

    tissues = sorted({name for values in protein_cache.values() for name in values})
    protein_values = {}
    for rec in tree:
        merged = {}
        for acc in rec['accessions']:
            for name, value in protein_cache.get(acc, {}).items():
                merged.setdefault(name, value)
        if merged:
            protein_values[rec['gene']] = [merged.get(name) for name in tissues]

    print(f'  mRNA: Human Protein Atlas tissues via ProteomicsDB')
    tissue_samples = hpa_tissues()
    tissue_names = sorted(tissue_samples)
    id_to_tissue = {sample_id: name for name, ids in tissue_samples.items() for sample_id in ids}
    measurement_ids = sorted(id_to_tissue)
    print(f'  {len(tissue_names)} tissues, {len(measurement_ids)} samples')
    mrna_cache_path = CACHE / 'mrna_expression.json'
    mrna_cache = {} if refresh else (load_cached(mrna_cache_path) or {}).get('by_ensembl', {})
    todo = sorted({ens for ens in ensembl.values() if ens not in mrna_cache})

    def fetch_mrna(ens):
        try:
            return ens, mrna_expression(ens, measurement_ids), None
        except Exception as exc:
            return ens, None, str(exc)

    if todo:
        done = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for ens, values, err in pool.map(fetch_mrna, todo):
                done += 1
                if err:
                    failed.append((ens, err))
                else:
                    # Store by tissue name. Several samples of one tissue are averaged.
                    buckets = defaultdict(list)
                    for sample_id, value in values.items():
                        buckets[id_to_tissue[sample_id]].append(value)
                    mrna_cache[ens] = {name: round(sum(vals) / len(vals), 2) for name, vals in buckets.items()}
                if done % 40 == 0 or done == len(todo):
                    print(f'  mRNA {done}/{len(todo)}')
                    write_json(mrna_cache_path, {'v': CACHE_VERSION, 'by_ensembl': mrna_cache})
        write_json(mrna_cache_path, {'v': CACHE_VERSION, 'by_ensembl': mrna_cache})

    mrna_values = {}
    for rec in tree:
        ens = ensembl.get(rec['gene'])
        values = mrna_cache.get(ens) if ens else None
        if values:
            mrna_values[rec['gene']] = [values.get(name) for name in tissue_names]
    print(f'  protein for {len(protein_values)} receptors across {len(tissues)} tissues; '
          f'mRNA for {len(mrna_values)} receptors; {len(failed)} failed')
    return {
        'protein': {'tissues': tissues, 'unit': 'ProteomicsDB normalized intensity', 'values': protein_values},
        'mrna': {'tissues': tissue_names, 'unit': 'TPM', 'values': mrna_values},
    }, failed


def merge_counts(*maps):
    out = defaultdict(dict)
    for mapping in maps:
        for gene, fields in mapping.items():
            out[gene].update(fields)
    return dict(out)


def main():
    parser = argparse.ArgumentParser(description='Download optional GPCRome datasets')
    parser.add_argument('--only', default='sequence,drugs,expression,ligands',
                        help='comma-separated: sequence, drugs, expression, ligands')
    parser.add_argument('--set', default='nonolfactory', choices=sorted(SETS),
                        help='the receptors to collect for: the non-olfactory tree or the olfactory tree')
    parser.add_argument('--refresh', action='store_true', help='ignore cached responses')
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    only = {part.strip() for part in args.only.split(',') if part.strip()}
    spec = SETS[args.set]
    tree = load_tree(spec['table'])
    path = DATA / spec['out']
    doc = json.loads(path.read_text()) if path.exists() else {}
    doc['date'] = datetime.date.today().isoformat()
    failed = []

    if 'sequence' in only:
        print('sequence')
        doc['sequence'] = build_sequence(tree, spec['anchor'], spec['pair'])
        write_json(path, doc)
    if 'drugs' in only:
        print('drugs')
        gpcrdb_counts = build_gpcrdb_drugs(tree, args.refresh, args.workers)
        chembl_counts = build_chembl_mechanisms(tree)
        gtp_counts, gtp_ligands = build_gtopdb(tree)
        dc_counts = build_drugcentral(tree)
        doc['counts'] = merge_counts(doc.get('counts', {}), gpcrdb_counts, chembl_counts, gtp_counts, dc_counts)
        doc.setdefault('ligands', {})['gtp'] = gtp_ligands
        doc['ensembl'] = build_ensembl(tree, args.refresh)
        write_json(path, doc)
    if 'expression' in only:
        print('expression')
        if 'ensembl' not in doc:
            doc['ensembl'] = build_ensembl(tree, args.refresh)
        expression, expr_failed = build_expression(tree, doc['ensembl'], args.refresh, args.workers)
        doc['expression'] = expression
        failed.extend(expr_failed)
        write_json(path, doc)
    if 'ligands' in only:
        print('ligands')
        ligand_counts, chembl_ligands, ligand_failed = build_ligands(tree, args.refresh, args.workers)
        doc['counts'] = merge_counts(doc.get('counts', {}), ligand_counts)
        doc.setdefault('ligands', {})['chembl'] = chembl_ligands
        failed.extend(ligand_failed)
        write_json(path, doc)

    doc['notes'] = {
        'chembl_ligands': 'Unique ChEMBL ligand names and bioactivity rows as integrated by GPCRdb.',
        'drugs': 'GPCRdb drugs combine DrugBank, ChEMBL and Guide to Pharmacology. DrugBank has no separate open target download.',
        'similarity': 'Percent identity, and percent of columns with BLOSUM62 > 0, on the GPCRdb alignment. Columns where both sequences are gapped are ignored.',
        'expression': 'Protein values are ProteomicsDB normalized intensities for tissues and fluids. mRNA is Human Protein Atlas RNA-seq (TPM) hosted by ProteomicsDB.',
    }
    write_json(path, doc)
    print(f'DONE datasets -> data/{spec["out"]} ({len(failed)} failures)')
    if failed:
        for name, err in failed[:20]:
            print(f'  {name}: {err}')


if __name__ == '__main__':
    main()
