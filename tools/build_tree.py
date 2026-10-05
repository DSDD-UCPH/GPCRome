"""Draw the GPCRome trees.

The topology comes from the maximum-likelihood phylogenies in data/tree/ (see tree_topology.py);
layout_v8.tsv holds the receptor positions on the previous, hand-drawn tree (GPCR_from_scratch_v8).

Branch lengths are not drawn. The GPCR tree is laid out like the previous one: the large clades keep the
direction they had from the centre of that drawing, every clade is a herringbone of stems and side
branches, and receptors and branches keep a fixed distance from each other (tree_layout.py). The layout
is then pulled in towards the centre and the stems are curved (tree_compact.py). Olfactory receptors are
collapsed into an arrow where they connect to class A; the unstable ("rogue") class A orphans are drawn
at their place in the tree with lighter twigs. The olfactory receptors have a tree of their own, drawn
the same way, with an arrow where class A connects to it. The names of the classes are placed in the
margins (tree_annotate.py).

Writes js/data/tree.js, images/gpcrome_tree.svg and the class, x, y and angle columns of
data/receptors.tsv; and data/olfactory.tsv, data/olfactory_tree.json and images/gpcrome_olfactory.svg
(tools/build_data.py makes js/data/olfactory.js from them).

Usage: python tools/build_tree.py [gpcr|olfactory]
"""
import csv
import json
import math
import sys
from pathlib import Path

import numpy as np

from tree_annotate import ARROW_ROOM, aim_arrow, place_labels
from tree_compact import Squeezer, bend, verify
from tree_layout import Layout
from tree_topology import TREES, build_olfactory_topology, build_topology, tip_counts

ROOT = Path(__file__).resolve().parent.parent

# Class order is also the drawing order (first = bottom).
CLASSES = [
    ('rhodopsin', 'Rhodopsin (class A)', '#5080b7'),
    ('rogues', 'Rhodopsin rogues', '#8bb3e0'),
    ('orphan', 'Orphan', '#99989d'),
    ('adhesion', 'Adhesion (class B2)', '#7c3aa7'),
    ('secretin', 'Secretin (class B1)', '#b53c37'),
    ('glutamate', 'Glutamate (class C)', '#f39841'),
    ('frizzled', 'Frizzled (class F)', '#9dc947'),
    ('tas2', 'Taste 2 (class T2)', '#769734'),
    ('vomeronasal', 'Vomeronasal (class V1)', '#3f9c93'),
    ('olfactory', 'Olfactory receptors (not drawn)', '#8b5e3c'),
]
OLFACTORY_CLASSES = [
    ('rhodopsin', 'Rhodopsin (class A)', '#5080b7'),
    ('olfactory2', 'Olfactory/extra-nasal 2 (class O2)', '#8b5e3c'),
    ('olfactory1', 'Olfactory/extra-nasal 1 (class O1)', '#c9a283'),
]
NAMES = {'rhodopsin': 'RHODOPSIN', 'adhesion': 'ADHESION', 'secretin': 'SECRETIN', 'glutamate': 'GLUTAMATE',
         'frizzled': 'FRIZZLED', 'tas2': 'TAS2', 'vomeronasal': 'VOMERONASAL', 'orphan': 'ORPHAN',
         'olfactory1': 'OLFACTORY 1', 'olfactory2': 'OLFACTORY 2'}
OPACITY = 0.75
MARGIN = 8.0

OLD_CENTRE = (276.34, 222.86)           # the centre of the previous drawing
MIN_CLADE = {'A': 14, 'other': 10}      # clades of this many receptors or more get a direction from it ...
TURN_LIMIT = 65                         # ... within this many degrees of the direction of their parent
SPREAD = 1.3                            # class A is fanned out this much wider (and flatter) than it was
PASSES = 3                              # layouts; each avoids branches that point back to the centre as the one before drew them
SQUEEZE_SWEEPS = 4


def old_positions():
    with open(TREES / 'layout_v8.tsv', newline='') as f:
        return {r['gene']: (float(r['x']), float(r['y'])) for r in csv.DictReader(f, delimiter='\t')}


def relative(tree, absolute):
    """Directions relative to the branch a clade hangs from (those of the root's children stay absolute)."""
    return {c: a if c.parent is tree else a - absolute[c.parent] for c, a in absolute.items()}


def branch_length(c, kids, size):
    """The stem that carries on stays short, a clade that forks off gets a branch of its own."""
    rest = max((size[k] for k in kids if k is not c), default=0)
    return 8.0 if size[c] > 1.6 * rest else 10.0 + 3.0 * math.sqrt(size[c])


def keep_apart(kids, absolute, gap=30):
    by_angle = sorted(kids, key=lambda c: absolute[c])
    for a, b in zip(by_angle, by_angle[1:]):
        if absolute[b] - absolute[a] < gap:
            mid = (absolute[a] + absolute[b]) / 2
            absolute[a], absolute[b] = mid - gap / 2, mid + gap / 2


def layout_hints(tree, nona, aside, fan, size, old):
    """Directions, branch lengths and sides for the layout, read off the previous drawing.

    Large clades leave in the direction of their receptors on the old drawing as seen from its centre
    (but never turn back by more than TURN_LIMIT from the branch they hang from); of two siblings the
    smaller one keeps the side of the larger one it had on the old drawing. Everything smaller is
    laid out by the herringbone rules.
    """
    where = {}                          # sums of the old positions of the receptors below every node, and how many
    for n in reversed(list(tree.walk())):
        if n.children:
            where[n] = tuple(map(sum, zip(*(where[c] for c in n.children))))
        else:
            where[n] = (*old[n.name], 1) if n.name in old else (0.0, 0.0, 0)
    centre = {n: (x / k, y / k) for n, (x, y, k) in where.items() if k}

    in_a = set(aside.walk())
    absolute = {nona: -105.0, aside: 82.0, fan: 175.0}
    length = {nona: 20.0, aside: 20.0, fan: 12.0}

    def walk(v, parent_angle):
        kids = [c for c in v.children if size[c] >= MIN_CLADE['A' if v in in_a else 'other']]
        for c in kids:
            a = parent_angle
            if c in centre:
                a = math.degrees(math.atan2(centre[c][1] - OLD_CENTRE[1], centre[c][0] - OLD_CENTRE[0]))
                if c in in_a:
                    a = 90 + SPREAD * (a - 90)
            absolute[c] = parent_angle + max(-TURN_LIMIT, min(TURN_LIMIT, (a - parent_angle + 180) % 360 - 180))
            length[c] = branch_length(c, kids, size)
        keep_apart(kids, absolute)
        for c in kids:
            walk(c, absolute[c])
    walk(nona, absolute[nona])
    walk(aside, absolute[aside])

    side = {}
    for v in tree.walk():
        if len(v.children) < 2 or v not in centre:
            continue
        stem = max(v.children, key=lambda c: size[c])
        for c in v.children:
            if c is not stem and c in centre and stem in centre:
                cross = (centre[stem][0] - centre[v][0]) * (centre[c][1] - centre[v][1]) \
                    - (centre[stem][1] - centre[v][1]) * (centre[c][0] - centre[v][0])
                if abs(cross) > 1e-6:
                    side[c] = 1 if cross > 0 else -1
    return relative(tree, absolute), length, side


def fan_hints(tree, arrow, olf, size):
    """Directions and branch lengths for a tree without an old drawing: the arrow leaves upwards and the
    clades fan out downwards, every large clade taking a share of the angle of its parent's fan in
    proportion to its size."""
    absolute = {arrow: -90.0, olf: 90.0}
    length = {arrow: ARROW_ROOM, olf: 16.0}

    def walk(v, direction, half):
        kids = [c for c in v.children if size[c] >= MIN_CLADE['other']]
        shares = [size[c] ** 0.6 for c in kids]
        start = direction - half
        for c, share in zip(kids, shares):
            width = 2 * half * share / sum(shares)
            if len(kids) > 1:
                absolute[c] = max(direction - TURN_LIMIT, min(direction + TURN_LIMIT, start + width / 2))
            else:
                absolute[c] = direction
            length[c] = branch_length(c, kids, size)
            walk(c, absolute[c], width / 2 if len(kids) > 1 else half)
            start += width
        keep_apart(kids, absolute, 25)
    walk(olf, 90.0, 80.0)
    return relative(tree, absolute), length, {}


def edge_widths(size, regions, special=lambda n, w: w):
    """Branch widths from the number of receptors below, thinner towards the tips as on the old tree.
    `regions`: parts of the tree with their (receptors, width) steps from the largest down;
    `special(n, width)` may change the width of a branch."""
    return {n: special(n, next((w for k, w in steps if size[n] >= k), 1.0)) for top, steps in regions for n in top.walk()}


def fidelity(tree, pos, old):
    """How far the receptors moved round the centre from the old drawing: median angle, and the share within 30 degrees."""
    dev = []
    for t in tree.tips():
        if t.name in old:
            ox, oy = old[t.name][0] - OLD_CENTRE[0], old[t.name][1] - OLD_CENTRE[1]
            nx, ny = pos[t] - pos[tree]
            dev.append(abs((math.degrees(math.atan2(ny, nx) - math.atan2(oy, ox)) + 180) % 360 - 180))
    return f'median {np.median(dev):.0f} deg, {100 * np.mean(np.array(dev) < 30):.0f}% within 30 deg'


def lay_out(tree, size, width, hints, arrow_side):
    """Positions of all nodes: layouts that each avoid what the one before did badly, then squeezed.
    The arrow leaves on side `arrow_side` (+1 or -1) of its larger sibling."""
    frames = None
    arrow = next(t for t in tree.tips() if t.arrow)
    for _ in range(PASSES):
        angle, length, side = hints()
        length[arrow] = ARROW_ROOM
        side[arrow] = arrow_side
        layout = Layout(tree, size, angle=angle, length=length, side=side, width=width, frames=frames)
        mod = layout.run()
        pos = {n: mod.pos[i] for i, n in enumerate(mod.nodes)}
        frames = layout.global_frames(pos)
    return Squeezer(tree, pos, width).run(SQUEEZE_SWEEPS)


def r(v):
    return round(float(v), 2)


def tree_data(tree, lines, width, classes, home, shift, canvas, labels):
    """The drawing as js/data/*.js wants it, and where every receptor ended up (x, y, direction, class).
    `home(n)`: the class of a branch that has receptors of several classes."""
    out = {
        'width': float(canvas[0]), 'height': float(canvas[1]), 'defaultOpacity': OPACITY,
        'classes': [{'id': cid, 'name': name, 'color': col} for cid, name, col in classes],
        'segments': {cid: [] for cid, _, _ in classes},
        'paths': {cid: [] for cid, _, _ in classes},
        'labels': [{'id': l['id'], 'cls': l['cls'], 'text': l['text'], 'x': r(l['x'] + shift[0]), 'y': r(l['y'] + shift[1]),
                    'size': l['size']} for l in labels],
    }
    placed = {}
    for n in tree.walk():
        if n is tree:
            continue
        pts = lines[n] + shift
        have = {t.cls for t in n.tips()}
        cls = n.cls if n.arrow else next(iter(have)) if len(have) == 1 and n.parent is not tree else home(n)
        out['paths'][cls].append({
            'd': 'M' + 'L'.join(f'{r(x)},{r(y)}' for x, y in pts), 'mode': 'stroke', 'width': width[n],
            'opacity': 1.0 if n.arrow else OPACITY})
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        if n.arrow:                                             # the arrow head
            ux, uy = np.array([x2 - x1, y2 - y1]) / math.hypot(x2 - x1, y2 - y1)
            head = [(x2 + ux * 7.5, y2 + uy * 7.5), (x2 - uy * 3.6, y2 + ux * 3.6), (x2 + uy * 3.6, y2 - ux * 3.6)]
            out['paths'][n.cls].append({'d': 'M' + 'L'.join(f'{r(x)},{r(y)}' for x, y in head) + 'Z',
                                              'mode': 'fill', 'width': 0, 'opacity': 1.0})
        elif not n.children:
            placed[n.name] = (r(x2), r(y2), round(math.degrees(math.atan2(y2 - y1, x2 - x1))), n.cls)
    return out, placed


def svg_of(out, classes):
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {out["width"]:g} {out["height"]:g}">',
           '<g stroke-linecap="round" stroke-linejoin="round" fill="none">']
    for cid, _, col in classes:
        svg.append(f'<g id="class-{cid}" stroke="{col}">')
        for p in out['paths'][cid]:
            if p['mode'] == 'stroke':
                svg.append(f'<path d="{p["d"]}" stroke-width="{p["width"]}" stroke-opacity="{p["opacity"]}"/>')
            else:
                svg.append(f'<path d="{p["d"]}" stroke="none" fill="{col}" fill-opacity="{p["opacity"]}"/>')
        svg.append('</g>')
    svg.append('</g>')
    color = {cid: col for cid, _, col in classes}
    for l in out['labels']:
        for i, line in enumerate(l['text']):
            y = l['y'] + (i - (len(l['text']) - 1) / 2) * 1.15 * l['size'] + 0.36 * l['size']
            svg.append(f'<text x="{l["x"]}" y="{r(y)}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" '
                       f'font-size="{l["size"]:g}" text-anchor="middle" fill="{color[l["cls"]]}">{line}</text>')
    return '\n'.join(svg + ['</svg>', ''])


def placement(view):
    """Positions chosen by hand with tools/place.py, relative to the centre of the tree: {'labels': {id: [dx, dy]},
    'arrow': [dx, dy]} (where the head of the arrow ends), or {}."""
    path = ROOT / 'data' / 'placement.json'
    return json.loads(path.read_text()).get(view, {}) if path.exists() else {}


def draw(tree, size, width, classes, home, hints, names, arrow_label, view):
    """Lay the tree out and annotate it. Returns the data for the page, where every receptor is, the
    positions of the nodes and the branches. `view`: 'gpcr' or 'olfactory', for the positions set by hand."""
    arrow = next(t for t in tree.tips() if t.arrow)
    best = None
    for arrow_side in (1, -1):                  # the arrow leaves on the side with more room
        pos = lay_out(tree, size, width, hints, arrow_side)
        lines = bend(tree, pos, width)
        hub = pos[tree]
        tips = [lines[t][-1] for t in tree.tips() if not t.arrow]
        start = pos[arrow.parent] - hub
        head, direction, room = aim_arrow(lines, arrow, math.degrees(math.atan2(start[1], start[0])) if arrow.parent is not tree else -90.0, tips)
        if best is None or room > best[0]:
            best = (room, pos, lines, hub, head, direction)
        if arrow.parent is tree:                # nothing to choose
            break
    _, pos, lines, hub, head, direction = best
    by_hand = placement(view)
    if 'arrow' in by_hand:
        head = hub + np.array(by_hand['arrow'])
        lines[arrow] = np.array([lines[arrow][0], head])
        direction = math.degrees(math.atan2(*(head - lines[arrow][0])[::-1]))

    specs = [{'id': 'arrow', 'cls': arrow.cls, 'text': arrow_label, 'near': [head], 'prefer': direction}]
    by_class = {cid: [lines[t][-1] for t in tree.tips() if t.cls == cid and not t.arrow] for cid, _, _ in classes}
    for cid in sorted(by_class, key=lambda cid: len(by_class[cid])):       # the smallest classes have the least choice
        ends = by_class[cid]
        if cid in names and ends:
            centre = np.mean(ends, axis=0) - hub
            specs.append({'id': cid, 'cls': cid, 'text': [names[cid]], 'near': ends,
                          'prefer': 90.0 if cid == 'rhodopsin' else math.degrees(math.atan2(centre[1], centre[0]))})
    labels = place_labels(specs, lines, hub)
    for l in labels:
        if l['id'] in by_hand.get('labels', {}):
            l['x'], l['y'] = hub + np.array(by_hand['labels'][l['id']])

    points = np.vstack(list(lines.values()) + [np.array([[l['x'] - l['w'] / 2, l['y'] - l['h'] / 2],
                                                         [l['x'] + l['w'] / 2, l['y'] + l['h'] / 2]]) for l in labels])
    (x0, y0), (x1, y1) = points.min(0), points.max(0)
    shift = np.array([MARGIN - x0, MARGIN - y0])
    out, placed = tree_data(tree, lines, width, classes, home, shift,
                            (math.ceil(x1 - x0 + 2 * MARGIN), math.ceil(y1 - y0 + 2 * MARGIN)), labels)
    out['hub'] = [r(v) for v in hub + shift]                    # what tools/place.py measures positions from
    out['arrow'] = {'cls': arrow.cls, 'start': [r(v) for v in lines[arrow][0] + shift], 'tip': [r(v) for v in lines[arrow][-1] + shift]}
    touching, gap, nearest = verify(tree, {n: pts + shift for n, pts in lines.items()}, width,
                                    [(x, y) for x, y, *_ in placed.values()])
    if touching:
        print(f'warning: {touching} branches touch or cross', file=sys.stderr)
    back = sum(np.linalg.norm(p[-1] - hub) < np.linalg.norm(p[0] - hub) - 1 for p in lines.values())
    print(f'{len(placed)} receptors, {len(lines)} branches, {out["width"]:g} x {out["height"]:g}; nearest receptors '
          f'{nearest:.1f}, smallest gap between branches {gap:.1f}, {back} branches point back towards the centre',
          file=sys.stderr)
    return out, placed, pos


def build_gpcr():
    with open(ROOT / 'data' / 'receptors.tsv', newline='') as f:
        reader = csv.DictReader(f, delimiter='\t')
        fields, rows = reader.fieldnames, list(reader)
    by_gene = {row['gene']: row for row in rows}
    by_acc = {a: row for row in rows for a in row['uniprot'].split(';') if a}
    orphans = {g['accession'] for g in json.load(open(ROOT / 'data' / 'gpcrdb.json'))['receptors']
               if g['ligand_type'] == 'Orphan receptors'}
    tree, nona, aside, fan = build_topology(lambda t: by_gene.get(t.name) or by_acc.get(t.nhx.get('accession')),
                                            lambda row: bool(orphans & set(row['uniprot'].split(';'))))
    size, old, in_a = tip_counts(tree), old_positions(), set(aside.walk())
    steps = [(80, 5.0), (22, 4.0), (10, 3.0), (4, 2.0)]
    in_nona, in_fan = set(nona.walk()), set(fan.walk())

    def special(n, w):
        if n.arrow:
            return 2.0
        if n in in_fan:
            return min(w, 2.0)
        if n in in_nona and size[n] >= 5 and len({t.cls for t in n.tips()}) == 1 and len({t.cls for t in n.parent.tips()}) > 1:
            return max(w, 4.0)                                  # the stem of a class
        return w
    width = edge_widths(size, [(aside, [(120, 5.0), (60, 4.0), (28, 3.0), (10, 2.0)]), (nona, steps), (fan, steps)], special)
    out, placed, pos = draw(
        tree, size, width, CLASSES,
        lambda n: 'rhodopsin' if n in in_a and n.parent is not tree else 'orphan',
        lambda: layout_hints(tree, nona, aside, fan, size, old), NAMES, ['Olfactory', 'receptors'], 'gpcr')
    print(f'  {fidelity(tree, pos, old)}', file=sys.stderr)

    missing = [row['gene'] for row in rows if row['gene'] not in placed]
    if missing:
        raise SystemExit('not on the tree: ' + ' '.join(missing))
    for row in rows:
        row['x'], row['y'], row['angle'], row['class'] = placed[row['gene']]
    with open(ROOT / 'data' / 'receptors.tsv', 'w', newline='') as f:
        f.write('\t'.join(fields) + '\n')
        f.writelines('\t'.join(str(row[k]) for k in fields) + '\n' for row in rows)
    (ROOT / 'js' / 'data' / 'tree.js').write_text(
        '/* Generated by tools/build_tree.py - do not edit by hand */\n'
        f'window.GPCROME_TREE = {json.dumps(out, separators=(",", ":"))};\n')
    (ROOT / 'images' / 'gpcrome_tree.svg').write_text(svg_of(out, CLASSES))


def build_olfactory():
    gpcrdb = json.load(open(ROOT / 'data' / 'gpcrdb.json'))
    by_acc = {g['accession']: g for g in gpcrdb['receptors']}
    tree, arrow, olf = build_olfactory_topology(lambda t: {'gene': t.nhx['gene']})
    size = tip_counts(tree)
    steps = [(200, 5.0), (80, 4.0), (30, 3.0), (10, 2.0)]
    out, placed, _ = draw(
        tree, size, edge_widths(size, [(arrow, steps), (olf, steps)], lambda n, w: 2.0 if n.arrow else w), OLFACTORY_CLASSES,
        lambda n: 'rhodopsin', lambda: fan_hints(tree, arrow, olf, size), NAMES, ['Class A'], 'olfactory')

    fields = ['gene', 'name', 'class', 'uniprot', 'uniprot_entry', 'hgnc', 'chembl', 'x', 'y', 'angle']
    with open(ROOT / 'data' / 'olfactory.tsv', 'w', newline='') as f:
        f.write('\t'.join(fields) + '\n')
        for t in sorted(tree.tips(), key=lambda t: t.name):
            if not t.arrow:
                g = by_acc.get(t.nhx['accession'])
                x, y, angle, cls = placed[t.name]
                row = [t.name, g['name'] if g else t.name, cls, t.nhx['accession'], t.nhx['entry'].upper(), '', '', x, y, angle]
                f.write('\t'.join(str(v) for v in row) + '\n')
    (ROOT / 'data' / 'olfactory_tree.json').write_text(json.dumps(out, separators=(',', ':')))
    (ROOT / 'images' / 'gpcrome_olfactory.svg').write_text(svg_of(out, OLFACTORY_CLASSES))


def main():
    which = sys.argv[1:] or ['gpcr', 'olfactory']
    for name in which:
        print(f'{name}:', file=sys.stderr)
        {'gpcr': build_gpcr, 'olfactory': build_olfactory}[name]()


if __name__ == '__main__':
    main()
