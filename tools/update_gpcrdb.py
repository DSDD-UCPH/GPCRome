"""Download human receptor annotations and structure statistics from GPCRdb into data/gpcrdb.json.

Usage: python tools/update_gpcrdb.py   (then run tools/build_data.py)
"""
import datetime
import html
import json
import re
import ssl
import urllib.request
from collections import defaultdict
from pathlib import Path

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = None

ROOT = Path(__file__).resolve().parent.parent
API = 'https://gpcrdb.org/services'


def get(endpoint):
    with urllib.request.urlopen(f'{API}/{endpoint}/', timeout=120, context=SSL_CONTEXT) as resp:
        return json.load(resp)


def plain(text):
    return html.unescape(re.sub(r'<[^>]+>', '', text or '')).strip()


def main():
    receptors = [r for r in get('receptorlist') if r['species'] == 'Homo sapiens']
    structures = get('structure')

    stats = defaultdict(lambda: {'structures': 0, 'structures_human': 0, 'ligands': set(), 'resolution': None})
    for s in structures:
        st = stats[s['protein'].split('_')[0]]
        st['structures'] += 1
        if s['species'] == 'Homo sapiens':
            st['structures_human'] += 1
        st['ligands'].update(l['name'] for l in s.get('ligands') or [])
        if s.get('resolution') and (st['resolution'] is None or s['resolution'] < st['resolution']):
            st['resolution'] = s['resolution']

    out = []
    for r in receptors:
        st = stats.get(r['entry_name'].split('_')[0])
        out.append({
            'entry_name': r['entry_name'],
            'accession': r['accession'],
            'genes': r.get('genes') or [],
            'name': plain(r['name']),
            'class': r['receptor_class'],
            'family': plain(r['receptor_family']),
            'ligand_type': plain(r['ligand_type']),
            'structures': st['structures'] if st else 0,
            'structures_human': st['structures_human'] if st else 0,
            'structure_ligands': len(st['ligands']) if st else 0,
            'best_resolution': st['resolution'] if st else None,
        })
    data = {'date': datetime.date.today().isoformat(), 'receptors': sorted(out, key=lambda r: r['entry_name'])}
    (ROOT / 'data' / 'gpcrdb.json').write_text(json.dumps(data, indent=1) + '\n')
    print(f'{len(out)} human receptors, {len(structures)} structures -> data/gpcrdb.json')


if __name__ == '__main__':
    main()
