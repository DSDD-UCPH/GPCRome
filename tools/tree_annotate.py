"""Annotations of the drawn tree: the arrow that stands for the part of the tree that is not drawn, and
the names of the classes. Both are placed where they have room, clear of the branches and receptors."""
import math

import numpy as np

from geometry import D_EDGE_EDGE, D_TIP_EDGE, point_segments, segment_segments

LABEL_SIZE = 10.0       # font size of the class names, in tree units
CAPITAL = 0.7           # width of a bold capital, in font sizes
ROOM = np.array([18.0, 7.0])    # clear space beside and above a name, for the labels of the receptors (they run sideways)
FREE = 14.0             # clear space wanted beyond the arrow head, for the name
ARROW_HEAD = 8.0        # the arrow head extends this far beyond the end of its branch
ARROW_MIN, ARROW_MAX = 22.0, 40.0     # the shortest and the longest arrow
ARROW_ROOM = ARROW_MAX + ARROW_HEAD + FREE     # what the layout keeps clear for it


def unit(angle):
    return np.array([math.cos(math.radians(angle)), math.sin(math.radians(angle))])


def aim_arrow(lines, arrow, away, tips):
    """Turn the arrow (`lines[arrow]`, a straight branch) to point outwards: towards `away` (degrees), or as
    near it as there is room, and make it as long as there is room for, between ARROW_MIN and ARROW_MAX. It keeps
    clear of branches and receptors, and at an angle from the branches that meet at its node. Returns where
    its head ends up, its direction and how much room it had (its length and the open way beyond it, less a price for turning)."""
    start = lines[arrow][0]
    pieces = np.array([np.concatenate([a, b]) for n, pts in lines.items() if n is not arrow for a, b in zip(pts[:-1], pts[1:])])
    meets = (np.linalg.norm(pieces[:, :2] - start, axis=1) < 1e-6) | (np.linalg.norm(pieces[:, 2:] - start, axis=1) < 1e-6)
    near = pieces[~meets]
    outgoing = [(p[2:] - p[:2]) if np.linalg.norm(p[:2] - start) < 1e-6 else (p[:2] - p[2:]) for p in pieces[meets]]
    outgoing = [v / np.linalg.norm(v) for v in outgoing]

    def clear(u, length, extra=0.0):
        probe = np.concatenate([start + u * 4, start + u * (length + ARROW_HEAD + extra)])[None]
        return not ((len(near) and segment_segments(probe, near, within=ARROW_MAX + 20).min() < D_EDGE_EDGE + 3)
                    or (len(tips) and point_segments(np.asarray(tips), probe).min() < D_TIP_EDGE + 3))

    best = None
    for turn in range(-90, 91, 5):
        u = unit(away + turn)
        if any(math.degrees(math.acos(np.clip(u @ v, -1, 1))) < 28 for v in outgoing):
            continue
        length = next((l for l in np.arange(ARROW_MAX, ARROW_MIN - 1, -2.0) if clear(u, l, FREE)), None)
        if length is None:
            continue
        open_ = max(e for e in np.arange(FREE, 60.0, 4.0) if clear(u, length, e))      # how far the way stays open
        score = length + 0.5 * open_ - 0.25 * abs(turn)
        if best is None or score > best[0]:
            best = (score, length, u, away + turn)
    if best is None:
        end = lines[arrow][-1]
        return end, math.degrees(math.atan2(*(end - start)[::-1])), 0.0
    room, length, u, direction = best
    lines[arrow] = np.array([start, start + u * length])
    return start + u * length, direction, room


def place_labels(specs, lines, hub):
    """Where the names go. Each spec: id, text (list of lines), near (points of the thing the name is for)
    and the direction (degrees) the name should lie in from the outermost of them; the result gives the
    centre of every name."""
    pieces = np.array([np.concatenate([a, b]) for pts in lines.values() for a, b in zip(pts[:-1], pts[1:])])
    lo, hi = np.minimum(pieces[:, :2], pieces[:, 2:]), np.maximum(pieces[:, :2], pieces[:, 2:])
    placed, taken = [], []
    for sp in specs:
        w = CAPITAL * LABEL_SIZE * max(len(t) for t in sp['text'])
        h = 1.15 * LABEL_SIZE * len(sp['text'])
        near = np.asarray(sp['near'], float)
        prefer = sp['prefer']
        anchor = near[np.argmax(near @ unit(prefer))]                 # the outermost point in that direction
        best = None
        for r in np.arange(4, 230, 3.0):
            if best and r > best[0]:
                break
            for deg in range(0, 360, 6):
                dev = abs((deg - prefer + 180) % 360 - 180)
                u = unit(deg)
                half = np.array([w / 2, h / 2])
                c = anchor + u * (r + abs(u) @ half)                    # the box at distance r from the anchor
                cost = r + 0.2 * dev
                if best and cost >= best[0]:
                    continue
                box = np.array([c - half - ROOM, c + half + ROOM])
                hit = np.nonzero(((hi >= box[0]) & (lo <= box[1])).all(1))[0]
                crossed = 0
                if len(hit):
                    corners = np.array([[box[0][0], box[0][1]], [box[1][0], box[0][1]], [box[1][0], box[1][1]], [box[0][0], box[1][1]]])
                    edges = np.hstack([corners, np.roll(corners, -1, axis=0)])
                    seg = pieces[hit]
                    inside = ((seg[:, :2] > box[0]) & (seg[:, :2] < box[1])).all(1) | ((seg[:, 2:] > box[0]) & (seg[:, 2:] < box[1])).all(1)
                    crossed = int((inside | (segment_segments(edges, seg) == 0).any(0)).sum())
                if any(abs(c[0] - o[0]) < (w + o[2]) / 2 + 2 and abs(c[1] - o[1]) < (h + o[3]) / 2 + 2 for o in taken):
                    continue
                cost += 40 * crossed
                if best is None or cost < best[0]:
                    best = (cost, c)
        c = best[1]
        taken.append((c[0], c[1], w, h))
        placed.append({'id': sp['id'], 'cls': sp['cls'], 'text': sp['text'], 'x': c[0], 'y': c[1], 'size': LABEL_SIZE, 'w': w, 'h': h})
    return placed
