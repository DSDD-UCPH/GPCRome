"""The topology of the GPCRome tree, from the maximum-likelihood phylogenies in data/tree/.

  human_gpcr_7tm.nhx       7TM tree of all human GPCRs (IQ-TREE, GPCRdb structure-based alignment).
                           Gives the connections between classes and the topology of class A,
                           the unclassified, taste 2 and vomeronasal receptors.
  <B1|B2|C|F>_fulllength.nhx
                           full-length trees, which include the extracellular domains; each
                           replaces its class in the 7TM tree.

The tree is rooted between the non-class A receptors and class A, the olfactory receptors are collapsed
into one node (OLF) and the receptors that have no usable place are dropped or grafted on (see below).
Class A receptors that are rogue taxa (unstable across bootstrap trees) and orphans in GPCRdb are marked
as class "rogues"; rogues with a family stay where the tree puts them, among their relatives.
"""
import re
from pathlib import Path

TREES = Path(__file__).resolve().parent.parent / 'data' / 'tree'

CLASS_OF_CODE = {'A': 'rhodopsin', 'U': 'orphan', 'B1': 'secretin', 'B2': 'adhesion', 'C': 'glutamate',
                 'F': 'frizzled', 'T2': 'tas2', 'V1': 'vomeronasal', 'O1': 'olfactory1', 'O2': 'olfactory2'}
OLFACTORY = {'O1', 'O2'}
FULL_LENGTH = ['B1', 'B2', 'C', 'F']

# Receptors drawn next to their closest paralogue: those that are not in GPCRdb, and ACKR1, which the 7TM tree
# puts among orphans (it is a rogue taxon) although it belongs with the chemokine receptors, as on the old drawing.
GRAFTS = [('GNRHR2', 'GNRHR'), ('GPR32P1', 'GPR32'), ('RGR', 'RRH'), ('ACKR1', 'ACKR3')]
# Orphans without a usable position, drawn as the fan at the centre and grouped by paralogy:
# GPR107 (strongest rogue of the 7TM tree), GPR137 and TPRA1 (saturated branches of ~11
# substitutions per site) and the GOST-domain receptors that are not in GPCRdb.
UNPLACED = {'GPR107', 'GPR137', 'TPRA1'}
CENTRE_FAN = ('((((GPR107:0.35,GPR108:0.35):0.25,(TMEM87A:0.3,TMEM87B:0.3):0.3):0.15,'
              '(GPR180:0.4,TMEM145:0.4):0.3):0.2,(GPR137:0.5,TPRA1:0.5):0.4)')


class Node:
    def __init__(self, name=None, length=0.0, children=()):
        self.name, self.length = name, length
        self.children, self.parent = [], None
        self.nhx = {}
        self.cls = None
        self.arrow = False              # a node that stands for a part of the tree that is not drawn
        for c in children:
            self.add(c)

    def add(self, child):
        child.parent = self
        self.children.append(child)
        return child

    def walk(self):
        """Preorder: a node comes before its children, and a clade is a run of nodes."""
        stack = [self]
        while stack:
            n = stack.pop()
            yield n
            stack.extend(reversed(n.children))

    def tips(self):
        return [n for n in self.walk() if not n.children]


def tip_counts(root):
    size = {}
    for n in reversed(list(root.walk())):
        size[n] = sum(size[c] for c in n.children) or 1
    return size


def parse(text):
    """A tree in Newick with NHX comments on the receptors."""
    tokens = re.findall(r"'[^']*'|\[[^\]]*\]|[(),:;]|[^(),:;\[\]']+", text)
    root = node = Node()
    stack, want_length = [], False
    for t in tokens:
        if t == '(':
            stack.append(node)
            node = node.add(Node())
        elif t == ',':
            node = stack[-1].add(Node())
        elif t == ')':
            node = stack.pop()
        elif t == ':':
            want_length = True
        elif t.startswith('[&&NHX'):
            node.nhx = dict(kv.split('=', 1) for kv in t[7:-1].split(':') if '=' in kv)
        elif t.strip() and t != ';':
            if want_length:
                node.length, want_length = float(t), False
            elif not node.children:
                node.name = t.strip("'")
    for n in root.tips():
        if n.nhx:
            n.name = n.nhx['gene']
    return root


def reroot(child, frac=0.5):
    """New root on the branch above `child`, `frac` of the branch length on the child's side."""
    total, parent = child.length, child.parent
    parent.children.remove(child)
    root = Node(children=[child])
    child.length = total * frac
    node, new_parent, new_length = parent, root, total * (1 - frac)
    while node is not None:
        old_parent, old_length = node.parent, node.length
        if old_parent is not None:
            old_parent.children.remove(node)
        new_parent.add(node)
        node.length = new_length
        node, new_parent, new_length = old_parent, node, old_length
    for n in list(root.walk()):         # the old root has two children no more: join its branches
        if n.parent is not None and len(n.children) == 1:
            only = n.children[0]
            only.length += n.length
            replace(n, only, length=False)
    return root


def replace(old, new, length=True):
    parent = old.parent
    parent.children[parent.children.index(old)] = new
    new.parent = parent
    if length:
        new.length = old.length


def prune(tip):
    """Remove a receptor; its sibling takes the place of the node they hung from."""
    parent = tip.parent
    parent.children.remove(tip)
    if len(parent.children) == 1 and parent.parent is not None:
        only = parent.children[0]
        only.length += parent.length
        replace(parent, only, length=False)


def mrca(root, names):
    names = set(names)
    best = root
    for n in root.walk():
        if names <= {t.name for t in n.tips()} and len(n.tips()) < len(best.tips()):
            best = n
    return best


def full_length_class(c, tree7):
    """Full-length tree of class `c`, rooted where the 7TM tree roots the class and scaled to 7TM units,
    and the node of the class in the 7TM tree."""
    full = parse((TREES / f'{c}_fulllength.nhx').read_text())
    members = {t.name for t in full.tips()}
    anchor = mrca(tree7, members)
    parts = sorted(({t.name for t in k.tips()} & members for k in anchor.children), key=len, reverse=True)
    side = parts[0]                     # the larger part of the class on one side of its 7TM root

    def split_error(n):
        below = {t.name for t in n.tips()}
        return min(len(below ^ side), len(below ^ (members - side)))
    rooted = reroot(min((n for n in full.walk() if n is not full), key=lambda n: (split_error(n), -n.length)))
    in_7tm = sum(n.length for n in anchor.walk() if n is not anchor and any(t.name in members for t in n.tips()))
    scale = in_7tm / sum(n.length for n in rooted.walk())
    for n in rooted.walk():
        n.length *= scale
    return rooted, anchor


def build_topology(row_for, orphan):
    """The tree, with its non-class A part, class A and the fan of orphans at the centre, and the receptors
    named after their rows in data/receptors.tsv (`row_for(tip)`); each carries its class in `cls`.
    `orphan(row)`: whether GPCRdb calls the receptor an orphan."""
    tree = parse((TREES / 'human_gpcr_7tm.nhx').read_text())
    other = {'B1', 'B2', 'C', 'F', 'T2', 'V1'}
    nona = mrca(tree, {t.name for t in tree.tips() if t.nhx['class'] in other})
    assert all(t.nhx['class'] in other | {'U'} for t in nona.tips()), 'non-A classes are not one clade'
    tree = reroot(nona)
    nona, aside = tree.children

    olf = mrca(aside, [t.name for t in aside.tips() if t.nhx['class'] in OLFACTORY])
    marker = Node('OLF')
    marker.arrow, marker.cls = True, 'olfactory'     # drawn in the colour of the olfactory receptors
    replace(olf, marker)
    for t in tree.tips():
        if t.name in UNPLACED:
            prune(t)

    # Classes B1, B2 and C: the 7TM tree nests B1 and C (without support) in a paraphyletic B2.
    full = {c: full_length_class(c, tree) for c in FULL_LENGTH}
    replace(mrca(tree, {t.name for c in ('B1', 'B2', 'C') for t in full[c][0].tips()}),
            Node(children=[Node(children=[full['B2'][0], full['B1'][0]]), full['C'][0]]))
    replace(full['F'][1], full['F'][0])

    for gene, target in GRAFTS:
        for t in [t for t in tree.tips() if t.name == gene]:       # already on the tree: move it
            prune(t)
        tip = next(t for t in tree.tips() if t.name == target)
        joint = Node()
        replace(tip, joint)
        joint.add(tip)
        joint.add(Node(gene)).nhx = dict(tip.nhx, gene=gene, rogue='no')
    fan = parse(CENTRE_FAN)
    for t in fan.tips():
        t.nhx = {'class': 'U', 'rogue': 'no'}
    tree.add(fan)

    for t in tree.tips():
        if t.arrow:
            continue
        row = row_for(t)
        if row is None:
            raise SystemExit(f'{t.name} is on the tree but not in data/receptors.tsv')
        t.cls = CLASS_OF_CODE[t.nhx['class']]
        if t.cls == 'rhodopsin' and t.nhx['rogue'] == 'yes' and orphan(row):
            t.cls = 'rogues'
        t.name = row['gene']
    return tree, nona, aside, fan


def build_olfactory_topology(row_for):
    """The tree of the olfactory receptors alone, as the subtree of the 7TM tree, with an arrow (CLASS_A)
    where it connects to class A. `row_for(tip)`: as for build_topology."""
    tree = parse((TREES / 'human_gpcr_7tm.nhx').read_text())
    other = {'B1', 'B2', 'C', 'F', 'T2', 'V1'}
    tree = reroot(mrca(tree, {t.name for t in tree.tips() if t.nhx['class'] in other}))
    aside = tree.children[1]
    olf = mrca(aside, [t.name for t in aside.tips() if t.nhx['class'] in OLFACTORY])
    for t in olf.tips():                # a rogue orphan (GPR107) is nested among them
        if t.nhx['class'] not in OLFACTORY:
            prune(t)
    olf.parent.children.remove(olf)
    arrow = Node('CLASS_A')
    arrow.arrow, arrow.cls = True, 'rhodopsin'
    root = Node(children=[arrow, olf])
    for t in root.tips():
        if not t.arrow:
            row = row_for(t)
            t.cls = CLASS_OF_CODE[t.nhx['class']]
            t.name = row['gene']
    return root, arrow, olf
