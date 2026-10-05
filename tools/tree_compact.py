"""Squeeze a finished tree layout towards its centre, bend the stems and check the drawing.

`tree_layout` builds every clade as a rigid module and slides modules apart just far enough to clear
their siblings, which leaves bare stems where a large clade had to get past a large neighbour. `Squeezer`
swings every clade in turn a little about the node it hangs from and pulls it in along its stem until it
touches its neighbours; the distances between receptors, branches and receptor-branch pairs stay the
ones `geometry` asks for, so nothing can overlap or cross. How far a clade may turn away from the
direction it had is limited, and branches are not encouraged to point back towards the centre.

`bend` then turns the straight branches into gentle curves where there is room, and `verify` checks that
nothing touches.
"""
import math

import numpy as np

from geometry import D_EDGE_EDGE, D_TIP_EDGE, D_TIP_TIP, NEAR, point_segments, rot, segment_segments
from tree_layout import INT_LEN

MIN_ANGLE = 14.0          # branches that meet at a node keep at least this angle between them
INWARD_COST = 15000.0     # what a branch that points back towards the centre costs, in squared distance


class Drawing:
    """A drawn tree as arrays in preorder: node i hangs from par[i] and its clade is the range [i, end[i])."""

    def __init__(self, root, pos, width):
        self.nodes = list(root.walk())
        index = {n: i for i, n in enumerate(self.nodes)}
        n = len(self.nodes)
        self.par = np.array([-1] + [index[x.parent] for x in self.nodes[1:]])
        size = np.ones(n, int)
        for i in range(n - 1, 0, -1):
            size[self.par[i]] += size[i]
        self.size, self.end, self.leaf = size, np.arange(n) + size, size == 1
        self.P = np.array([pos[x] for x in self.nodes], float)
        self.W = np.array([0.0] + [width.get(x, 1.0) for x in self.nodes[1:]])

    def positions(self):
        return {x: self.P[i] for i, x in enumerate(self.nodes)}


class Squeezer(Drawing):
    def __init__(self, root, pos, width, turn_limit=25.0, min_size=5):
        super().__init__(root, pos, width)
        self.turn_limit = turn_limit
        self.start_dir = self.directions(self.P)
        self.big = (self.size >= min_size) & ~self.leaf

    def directions(self, P):
        """Direction in degrees of the stem into every node (0 for the root)."""
        d = P[1:] - P[self.par[1:]]
        return np.concatenate([[0.0], np.degrees(np.arctan2(d[:, 1], d[:, 0]))])

    def starts(self, a, Pn):
        """Where the stems into the clade at a start, with the clade at the positions Pn."""
        pm = self.par[a:self.end[a]]
        return np.where((pm >= a)[:, None], Pn[np.clip(pm - a, 0, None)], self.P[self.par[a]])

    def drifted(self, a, Pn):
        """Whether a large clade in the clade at a would point more than `turn_limit` degrees away from the
        direction its stem had on the layout that was handed in."""
        d = Pn - self.starts(a, Pn)
        now = np.degrees(np.arctan2(d[:, 1], d[:, 0]))
        diff = np.abs((now - self.start_dir[a:self.end[a]] + 180) % 360 - 180)
        return bool((diff[self.big[a:self.end[a]]] > self.turn_limit + 1e-6).any())

    def moved(self, a, theta, shrink):
        """Positions of the clade at a after swinging it by theta degrees about its parent and pulling it
        `shrink` units along its stem."""
        p = self.par[a]
        e = self.P[a] - self.P[p]
        pts = self.P[a:self.end[a]] - self.P[p] - e / np.linalg.norm(e) * shrink
        return pts @ rot(theta).T + self.P[p]

    def valid(self, a, Pn):
        """Whether the clade at a, with the new positions Pn, keeps its distances to the rest."""
        b, p = self.end[a], self.par[a]
        moved, mw = np.hstack([self.starts(a, Pn), Pn]), self.W[a:b]
        lo, hi = np.minimum(moved[:, :2].min(0), Pn.min(0)) - NEAR, np.maximum(moved[:, :2].max(0), Pn.max(0)) + NEAR
        rest = np.r_[1:a, b:len(self.P)]
        ends, starts = self.P[rest], self.P[self.par[rest]]
        rest = rest[((np.maximum(ends, starts) > lo) & (np.minimum(ends, starts) < hi)).all(1)]
        if not len(rest):
            return True
        other, ow = np.hstack([self.P[self.par[rest]], self.P[rest]]), self.W[rest]
        d = segment_segments(moved, other, within=NEAR)
        d[0, (rest == p) | (self.par[rest] == p)] = np.inf          # the stem shares its node with these
        if (d < D_EDGE_EDGE + (mw[:, None] + ow[None]) / 2).any():
            return False
        tips = Pn[self.leaf[a:b]]
        if len(tips) and (point_segments(tips, other) < D_TIP_EDGE + ow[None] / 2).any():
            return False
        other_tips = self.P[rest[self.leaf[rest]]]
        if len(other_tips):
            if (point_segments(other_tips, moved) < D_TIP_EDGE + mw[None] / 2).any():
                return False
            if len(tips) and np.linalg.norm(tips[:, None] - other_tips[None], axis=2).min() < D_TIP_TIP:
                return False
        return True

    def inward(self, a, Pn):
        """Branches in the clade at a that end closer to the centre than they start."""
        hub = self.P[0]
        return int((np.linalg.norm(Pn - hub, axis=1) < np.linalg.norm(self.starts(a, Pn) - hub, axis=1) - 0.5).sum())

    def cost(self, a, Pn):
        """Sum of squared distances of the receptors of the clade from the centre."""
        return float(((Pn[self.leaf[a:self.end[a]]] - self.P[0]) ** 2).sum())

    def shrink(self, a, theta, limit):
        """How far the clade can be pulled in at this angle: doubled until it no longer fits, then bisected."""
        if limit <= 0.5 or not self.valid(a, self.moved(a, theta, min(1.0, limit))):
            return 0.0
        good, bad, probe = min(1.0, limit), None, 2.0
        while bad is None:
            probe = min(probe, limit)
            if not self.valid(a, self.moved(a, theta, probe)):
                bad = probe
            elif probe >= limit:
                return probe
            else:
                good, probe = probe, probe * 2
        while bad - good > 0.5:
            mid = (good + bad) / 2
            if self.valid(a, self.moved(a, theta, mid)):
                good = mid
            else:
                bad = mid
        return good

    def squeeze_one(self, a):
        """Swing the clade at a, and pull it in, to wherever it costs least. Returns whether it moved."""
        p, b = self.par[a], self.end[a]
        length = float(np.linalg.norm(self.P[a] - self.P[p]))
        reach = float(np.linalg.norm(self.P[a:b] - self.P[p], axis=1).max())
        step = max(1.0, min(3.0, math.degrees(3.5 / max(reach, 1.0))))
        here = self.P[a:b]
        base_inward = self.inward(a, here)
        allowed = base_inward + 3 + int(0.04 * len(here))
        best = (self.cost(a, here) + INWARD_COST * base_inward, 0.0, 0.0)
        for k in range(-8, 9):
            theta = k * step
            if k:
                turned = self.moved(a, theta, 0.0)
                if self.drifted(a, turned) or not self.valid(a, turned):
                    continue
            shrink = self.shrink(a, theta, length - INT_LEN)
            Pn = self.moved(a, theta, shrink)
            inward = self.inward(a, Pn)
            if inward > allowed or (k and self.drifted(a, Pn)):
                continue
            cost = self.cost(a, Pn) + INWARD_COST * inward
            if cost < best[0] - 1e-6:
                best = (cost, theta, shrink)
        if best[1] or best[2]:
            self.P[a:b] = self.moved(a, best[1], best[2])
        return best[2] > 0.5 or abs(best[1]) > 0.1

    def run(self, sweeps, log=None):
        """Squeeze every large clade, outermost last, until nothing moves (at most `sweeps` times)."""
        for s in range(sweeps):
            moved = sum(self.squeeze_one(a) for a in range(1, len(self.P)) if self.big[a])
            if log:
                log(f'squeeze sweep {s + 1}: {moved} clades moved')
            if not moved:
                break
        return self.positions()


def bend(root, pos, width, length=9.0, factors=(1.0, 0.65, 0.35), sample=7.0):
    """Curve the stems: a stem runs through its nodes as a smooth curve (the tangent at a node is the mean
    of the directions of the stem before and after it), side branches and receptors leave straight, as
    far as that leaves the wanted distances intact. Returns, for every node, the polyline of the branch
    into it (parent first)."""
    d = Drawing(root, pos, width)
    P, W, par, leaf = d.P, d.W, d.par, d.leaf
    heavy = np.full(len(P), -1)
    for i in range(1, len(P)):
        if heavy[par[i]] < 0 or d.size[i] > d.size[heavy[par[i]]]:
            heavy[par[i]] = i
    pieces = {i: np.hstack([P[[par[i]]], P[[i]]]) for i in range(1, len(P))}
    tips = P[leaf]

    def unit(v):
        return v / max(np.linalg.norm(v), 1e-9)

    def angle(a, b):
        return math.degrees(math.acos(np.clip(a @ b, -1, 1)))

    def clear(i, pts):
        """Whether the curve `pts` for the branch into node i keeps its distances to everything else."""
        mine = np.hstack([pts[:-1], pts[1:]])
        others = [j for j in pieces if j != i]
        seg = np.vstack([pieces[j] for j in others])
        owner = np.concatenate([[j] * len(pieces[j]) for j in others])
        near = ((np.maximum(seg[:, :2], seg[:, 2:]) > pts.min(0) - NEAR) & (np.minimum(seg[:, :2], seg[:, 2:]) < pts.max(0) + NEAR)).all(1)
        seg, owner = seg[near], owner[near]
        p = par[i]
        # near a node where branches meet they are close by construction: only their directions are compared
        dist = segment_segments(mine, seg, within=NEAR)
        dist[:2, (owner == p) | (par[owner] == p)] = np.inf
        dist[-2:, par[owner] == i] = np.inf
        if (dist < D_EDGE_EDGE + (W[i] + W[owner][None]) / 2).any():
            return False
        first = unit(pts[1] - pts[0])
        for j in [j for j in pieces if par[j] == p and j != i] + ([p] if p >= 1 else []):
            out = unit(pieces[j][0][2:] - pieces[j][0][:2]) if par[j] == p else unit(pieces[j][-1][:2] - pieces[j][-1][2:])
            if angle(first, out) < MIN_ANGLE:
                return False
        last = unit(pts[-2] - pts[-1])
        if any(angle(last, unit(pieces[j][0][2:] - pieces[j][0][:2])) < MIN_ANGLE for j in pieces if par[j] == i):
            return False
        others_tips = tips[np.linalg.norm(tips - P[i], axis=1) > 1e-6]
        return not (len(others_tips) and (point_segments(others_tips, mine) < D_TIP_EDGE + W[i] / 2).any())

    lines = {i: P[[par[i], i]] for i in range(1, len(P))}
    for i in sorted(range(1, len(P)), key=lambda i: (-W[i], -d.size[i])):
        p = par[i]
        straight = P[i] - P[p]
        stem = float(np.linalg.norm(straight))
        if stem < length:
            continue
        u = unit(straight)
        into = unit(P[p] - P[par[p]]) if par[p] >= 0 else u
        t0 = unit(into + u) if heavy[p] == i else u
        t1 = unit(u + unit(P[heavy[i]] - P[i])) if heavy[i] >= 0 else u
        for f in factors:
            a, b = unit(u + f * (t0 - u)), unit(u + f * (t1 - u))
            if np.linalg.norm(a - u) + np.linalg.norm(b - u) < 0.02:
                break
            c = np.array([P[p], P[p] + a * 0.35 * stem, P[i] - b * 0.35 * stem, P[i]])
            t = np.linspace(0, 1, max(2, int(math.ceil(stem / sample))) + 1)[:, None]
            pts = (1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t ** 2 * c[2] + t ** 3 * c[3]
            if clear(i, pts):
                lines[i], pieces[i] = pts, np.hstack([pts[:-1], pts[1:]])
                break
    return {d.nodes[i]: lines[i] for i in lines}


def verify(root, lines, width, tips):
    """Check the final drawing: returns (touching or crossing pairs of branches, smallest gap between the
    strokes of branches that do not meet at a node, smallest distance between two receptors). Near a
    node where branches meet the nearest two pieces of each are not compared."""
    nodes = list(root.walk())
    index = {n: i for i, n in enumerate(nodes)}
    par = np.array([-1] + [index[n.parent] for n in nodes[1:]])
    segs, edge, step, count = [], [], [], []
    for n in nodes[1:]:
        pts = lines[n]
        segs += [np.concatenate([a, b]) for a, b in zip(pts[:-1], pts[1:])]
        edge += [index[n]] * (len(pts) - 1)
        step += range(len(pts) - 1)
        count += [len(pts) - 1] * (len(pts) - 1)
    S, E, K, C = np.array(segs), np.array(edge), np.array(step), np.array(count)
    W = np.array([width.get(nodes[e], 1.0) for e in E])
    lo, hi = np.minimum(S[:, :2], S[:, 2:]), np.maximum(S[:, :2], S[:, 2:])
    touching, gap = 0, np.inf
    for i in range(len(S)):
        near = np.nonzero((hi > lo[i] - 6).all(1) & (lo < hi[i] + 6).all(1))[0]
        near = near[near > i]
        sibling = par[E[near]] == par[E[i]]
        leaves = par[E[near]] == E[i]                 # the other branch leaves where this one ends
        arrives = par[E[i]] == E[near]                # the other branch ends where this one starts
        meet = (E[near] == E[i]) | (sibling & (K[near] < 2) & (K[i] < 2)) \
            | (leaves & (K[near] < 2) & (K[i] >= C[i] - 2)) | (arrives & (K[i] < 2) & (K[near] >= C[near] - 2))
        near = near[~meet]
        if len(near):
            dist = segment_segments(S[i][None], S[near])[0]
            touching += int((dist < 0.05).sum())
            gap = min(gap, float((dist - (W[i] + W[near]) / 2).min()))
    t = np.array(tips)
    apart = np.linalg.norm(t[:, None] - t[None], axis=2) + 1e9 * np.eye(len(t))
    return touching, gap, float(apart.min())
