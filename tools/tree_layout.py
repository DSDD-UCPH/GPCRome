"""Constructive layout of the GPCRome tree.

Branch lengths are ignored. The tree is drawn like the hand-drawn version it replaces: stems run
straight, side branches leave at 35-50 degrees and every clade is a herringbone of such branches.

Every subtree is built bottom-up as a rigid module with its root at the origin and its growth
direction along +x:

* a node with two children puts the larger one (the stem) almost straight ahead and the smaller one
  to the side the old drawing had it on; two similar children fork symmetrically;
* the side modules are put next to the node first and the stem module is then slid forward until
  all receptors, branches and receptor-branch pairs are at least the wanted distance apart (see
  geometry.py), so the parts of a clade can never overlap and every receptor keeps room for its label;
* a module stays in front of the node it hangs from, so branches do not fold back on their stem;
* the caller can give the angle of a branch (relative to the branch it hangs from) and its shortest
  length; this is how the large clades are pointed the way they went on the old drawing;
* given where every node was on an earlier layout, the orientation of a module is chosen so that its
  branches also do not point back towards the centre of the whole drawing.

Angles are in degrees on the drawing (y points down): 0 = east, 90 = south, -90 = north.
"""
import math

import numpy as np

from geometry import D_EDGE_EDGE, D_TIP_EDGE, D_TIP_TIP, NEAR, point_segments, rot, segment_segments

TIP_LEN = 14.0              # terminal branches
INT_LEN = 8.0               # shortest internal branch
STEM = 6.0                  # how far the larger of two children leaves the straight line
SIDE_ANGLE = (32.0, 22.0)   # angle of a side branch: the first, plus up to the second for a larger one
FORK = (22.0, 14.0)         # half the angle between two similar children, likewise
MAX_SLIDE = 900.0
WALL = 3.0                  # no branch may fall back behind the node it hangs from by more than this
INWARD = 12.0               # cost of a branch pointing back towards the root, given frames of an earlier layout
# Turns away from the wanted direction tried for a module that does not fit (degrees towards the side
# away from the branches already placed, and what a degree costs).
TURNS = [(w, 1.0) for w in (0, 6, 12, 20, 30, 45, 60, 80)] + [(-w, 1.4) for w in (6, 12, 20, 30, 45, 60, 80)] \
    + [(w, 1.0) for w in (100, 120)]
MIRROR = np.diag([1.0, -1.0])


class Module:
    """A laid out subtree. Node 0 is the root at the origin; `parent` indexes into `nodes`; `widths[i]` is
    the width of the branch into node i + 1."""

    def __init__(self, nodes, pos, parent, tip, widths=()):
        self.nodes = nodes
        self.pos = np.asarray(pos, float).reshape(-1, 2)
        self.parent = np.asarray(parent, int)
        self.tip = np.asarray(tip, bool)
        self.widths = np.asarray(widths, float)
        self.segs = np.hstack([self.pos[self.parent[1:]], self.pos[1:]])

    @property
    def tips(self):
        return self.pos[self.tip]

    def moved(self, matrix=None, offset=0.0):
        pos = self.pos if matrix is None else self.pos @ matrix.T
        return Module(self.nodes, pos + offset, self.parent, self.tip, self.widths)


class Group:
    """What has been placed around a node: segments, with their widths and whether they leave the node,
    and receptors."""

    def __init__(self):
        self.segs = np.zeros((0, 4))
        self.width = np.zeros(0)
        self.at_node = np.zeros(0, bool)
        self.tips = np.zeros((0, 2))

    def add(self, mod, edge, width):
        self.segs = np.vstack([self.segs, edge[None], mod.segs])
        self.width = np.concatenate([self.width, [width], mod.widths])
        self.at_node = np.concatenate([self.at_node, [True], np.zeros(len(mod.segs), bool)])
        self.tips = np.vstack([self.tips, mod.tips])

    def clear_of(self, mod, edge, width):
        """Whether `mod`, reached by `edge` from the node, keeps the wanted distances to this group."""
        if len(mod.segs):           # the branch into the module must not run through the module itself
            own = segment_segments(edge[None], mod.segs, within=NEAR)[0]
            own[mod.parent[1:] == 0] = np.inf
            if (own < D_EDGE_EDGE + (width + mod.widths) / 2).any():
                return False
        if not len(self.segs):
            return True
        segs = np.vstack([edge[None], mod.segs])
        wid = np.concatenate([[width], mod.widths])
        points = segs.reshape(-1, 2)
        lo, hi = points.min(0) - NEAR, points.max(0) + NEAR
        near = ((np.maximum(self.segs[:, :2], self.segs[:, 2:]) > lo) & (np.minimum(self.segs[:, :2], self.segs[:, 2:]) < hi)).all(1)
        if not near.any():
            return True
        gs, gw = self.segs[near], self.width[near]
        d = segment_segments(segs, gs, within=NEAR)
        d[0, self.at_node[near]] = np.inf        # the branch into the module shares its node with these
        if (d < D_EDGE_EDGE + (wid[:, None] + gw[None]) / 2).any():
            return False
        tips = mod.tips
        if len(tips) and (point_segments(tips, gs) < D_TIP_EDGE + gw[None] / 2).any():
            return False
        gtips = self.tips[((self.tips > lo) & (self.tips < hi)).all(1)]
        if len(gtips):
            if (point_segments(gtips, segs) < D_TIP_EDGE + wid[None] / 2).any():
                return False
            if len(tips) and np.linalg.norm(tips[:, None] - gtips[None], axis=2).min() < D_TIP_TIP:
                return False
        return True


class Layout:
    """Lays out a tree of nodes with `.children` (see the module docstring); `size` is the number of
    receptors below every node.

    Hints, all optional and keyed by node:
      angle   direction of the branch into the node, relative to the branch into its parent (for the
              children of the root: on the drawing)
      length  shortest branch into the node
      side    +1 / -1: the side of its larger sibling the node leaves on (+1 = clockwise on the drawing)
      width   drawn width of the branch into the node; wider branches keep more distance
    `frames`: position, direction and handedness of every node on an earlier layout of the same tree
    (`global_frames`); with these the orientation of a module is chosen so that its branches do not
    point back towards the root.
    """

    def __init__(self, root, size, angle=None, length=None, side=None, width=None, frames=None):
        self.root, self.size = root, size
        self.angle, self.length, self.width = angle or {}, length or {}, width or {}
        self.side = dict(side or {})
        self.frames = frames or {}
        self.rot, self.mirror = {}, {}      # rotation and mirroring given to the module of each node
        self.mod = {}
        # a clade with a given direction somewhere below it cannot be mirrored: that would flip them
        self.pinned = {}
        for n in reversed(list(root.walk())):
            self.pinned[n] = any(c in self.angle or self.pinned[c] for c in n.children)
        self.balance_sides()

    def balance_sides(self, keep=10):
        """Put the small side branches of a stem alternately on either side, so that a long stem does
        not have all of its twigs on one side. Branches of `keep` receptors or more, and arrows, keep their side."""
        load = {self.root: {1: 0, -1: 0}}
        for v in self.root.walk():
            mine = load.pop(v, {1: 0, -1: 0})
            for k, c in enumerate(sorted(v.children, key=lambda c: -self.size[c])):
                if k == 0:
                    load[c] = mine           # the stem carries on with the same balance
                    continue
                load[c] = {1: 0, -1: 0}
                if not (c in self.side and (self.size[c] >= keep or c.arrow)):
                    self.side[c] = 1 if mine[1] <= mine[-1] else -1
                mine[self.side[c]] += self.size[c]

    def run(self):
        for n in reversed(list(self.root.walk())):
            self.mod[n] = self.combine(n) if n.children else Module([n], [[0, 0]], [-1], [True])
        return self.mod[self.root]

    def global_frames(self, pos):
        """Position, direction and handedness of the frame of every node on the finished layout (`pos`
        maps nodes to their positions): the input of `frames` for a later layout of the same tree."""
        out = {self.root: (np.zeros(2), 0.0, 1.0)}
        for v in self.root.walk():
            _, direction, hand = out[v]
            for c in v.children:
                out[c] = (pos[c], direction + hand * self.rot[c], hand * (-1.0 if self.mirror[c] else 1.0))
        return out

    def angles(self, n):
        """Directions of the branches to the children of `n`, relative to the branch into `n`."""
        kids = n.children
        order = sorted(range(len(kids)), key=lambda i: -self.size[kids[i]])
        out = [0.0] * len(kids)
        hinted = [i for i in order if kids[i] in self.angle]
        if hinted:
            for i in hinted:
                out[i] = self.angle[kids[i]]
            for j, i in enumerate([i for i in order if kids[i] not in self.angle]):
                r = self.size[kids[i]] / self.size[kids[hinted[0]]]
                side = self.side.get(kids[i], 1 if j % 2 == 0 else -1)
                out[i] = out[hinted[0]] + side * (SIDE_ANGLE[0] + SIDE_ANGLE[1] * min(1.0, r * 1.5) + 8 * (j // 2))
        elif len(kids) == 2:
            big, small = order
            a, b = self.size[kids[big]], self.size[kids[small]]
            r, side = b / a, self.side.get(kids[small], 1)
            if r > 0.6:         # two similar children fork symmetrically
                sep = 2 * (FORK[0] + FORK[1] * min(1.0, (a + b) / 40))
                out[small], out[big] = side * sep / (1 + r), -side * sep * r / (1 + r)
            else:               # a stem and a side branch
                out[small] = side * (SIDE_ANGLE[0] + SIDE_ANGLE[1] * min(1.0, r * 1.5) + STEM * 0.5)
                out[big] = -side * STEM * 0.3
        else:                   # a fan, in the order the old drawing had it
            sep = 30.0 if len(kids) < 6 else 24.0
            for j, i in enumerate(sorted(order, key=lambda i: (self.side.get(kids[i], 0), -self.size[kids[i]]))):
                out[i] = (j - (len(kids) - 1) / 2) * sep
        return out

    def combine(self, n):
        """The module of node `n` from the modules of its children."""
        kids, angles = n.children, self.angles(n)
        # smaller children first: they stay close to the node and the larger ones are slid past them
        order = sorted(range(len(kids)), key=lambda i: (self.size[kids[i]], i))
        placed, group, done = [], Group(), []
        # a thick branch from this node needs room beside the first segments of its siblings
        reach = 3.5 + 1.8 * max(self.width.get(c, 1.0) for c in kids)
        for i in order:
            c = kids[i]
            lo = max(self.length.get(c) or (INT_LEN if c.children else TIP_LEN), reach)
            found = self.place(group, c, angles[i], lo, n is self.root, done, self.frames.get(n))
            if found is None:
                raise RuntimeError(f'no room for a subtree of {self.size[c]} receptors')
            shifted, edge, aa, self.rot[c], self.mirror[c] = found
            group.add(shifted, edge, self.width.get(c, 1.0))
            placed.append((i, shifted))
            done.append(aa)
        nodes, pos, parent, tip, widths = [n], [[0.0, 0.0]], [-1], [False], []
        for i, m in sorted(placed, key=lambda t: t[0]):
            base = len(nodes)
            nodes += m.nodes
            pos += m.pos.tolist()
            parent += [0 if p < 0 else p + base for p in m.parent]
            tip += m.tip.tolist()
            widths += [self.width.get(kids[i], 1.0)] + m.widths.tolist()
        return Module(nodes, pos, parent, tip, widths)

    def place(self, group, child, angle, lo, root, done, frame):
        """Cheapest way to put the module of `child` next to the geometry in `group`, as (module, edge,
        angle of the edge, rotation of the module, mirrored), or None. The module leaves at `angle`; where
        it does not fit it is slid outwards, mirrored or turned away from the branches already placed, and
        branches that point back towards the root cost extra. `root`: the node has no branch to hang from."""
        module, width = self.mod[child], self.width.get(child, 1.0)
        away = 1.0 if not done or angle >= sum(done) / len(done) else -1.0
        best = None
        for mirror in ((False,) if self.pinned[child] or len(module.nodes) == 1 else (False, True)):
            mod = module.moved(MIRROR) if mirror else module
            for turn, price in TURNS:
                cost0 = (6.0 if mirror else 0.0) + (0.8 if root else 0.5) * abs(turn) * price
                if best is not None and cost0 + lo >= best[0]:
                    continue
                aa = angle + turn * away
                spin = angle if child in self.angle else aa     # a clade with a given direction keeps it
                cand = mod.moved(rot(spin))
                u = np.array([math.cos(math.radians(aa)), math.sin(math.radians(aa))])
                length = self.slide(group, cand, u, lo, width, root, None if best is None else best[0] - cost0)
                if length is not None:
                    placed = cand.moved(offset=u * length)
                    cost = cost0 + length + INWARD * self.inward(placed, frame)
                    if best is None or cost < best[0]:
                        best = (cost, placed, np.concatenate([[0, 0], u * length]), aa, spin, mirror)
        if best is None and not root:
            return self.place(group, child, angle, lo, True, done, frame)     # let it reach round the node
        return best and best[1:]

    @staticmethod
    def inward(module, frame):
        """Branches of the module (and the branch into it) that end closer to the root than they start,
        given the position, direction and handedness `frame` of the node it hangs from on an earlier
        layout."""
        if frame is None:
            return 0
        origin, direction, hand = frame
        local = np.vstack([[0.0, 0.0], module.pos]) * np.array([1.0, hand])
        radius = np.linalg.norm(local @ rot(direction).T + origin, axis=1)
        # point 0 is the node itself, point 1 the root of the module, point j + 1 module node j
        kids = np.arange(1, len(module.nodes)) + 1
        return int((radius[kids] < radius[module.parent[1:] + 1] - 0.5).sum() + (radius[1] < radius[0] - 0.5))

    @staticmethod
    def slide(group, cand, u, lo, width, root, limit):
        """Shortest branch length at which `cand` (rooted at the origin, leaving along `u`) clears
        `group`, or None. Doubles the length until it fits, then bisects back."""
        top = MAX_SLIDE if limit is None else min(MAX_SLIDE, limit)

        def fits(length):
            shifted = cand.moved(offset=u * length)
            if not root and shifted.pos[:, 0].min() < -WALL:
                return False
            return group.clear_of(shifted, np.concatenate([[0, 0], u * length]), width)
        if fits(lo):
            return lo
        bad, good, step = lo, None, 4.0
        while good is None:
            probe = bad + step
            if probe > top:
                return None
            if fits(probe):
                good = probe
            else:
                bad, step = probe, step * 1.6
        while good - bad > 1.0:
            mid = (good + bad) / 2
            if fits(mid):
                good = mid
            else:
                bad = mid
        return math.ceil(good)
