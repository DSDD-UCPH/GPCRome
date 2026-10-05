"""Distances between points and line segments in bulk, and the distances a drawing keeps."""
import math

import numpy as np

# Wanted distances in tree units. The previous drawing (569 x 540) had receptors a median 11 and at
# least 6 apart; here receptors keep 9 and strokes keep a gap of 2.4.
D_TIP_TIP = 9.0         # between receptors
D_TIP_EDGE = 4.6        # between a receptor and a branch (plus half the width of the branch)
D_EDGE_EDGE = 2.4       # between branches (plus half their widths)
NEAR = D_TIP_TIP + 8    # beyond this two things cannot be in each other's way


def rot(degrees):
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return np.array([[c, -s], [s, c]])


def _point_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / np.maximum(dx * dx + dy * dy, 1e-12), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy)


def point_segments(P, S):
    """Distance of every point of P (n, 2) to every segment of S (m, 4) -> (n, m)."""
    return _point_to_segment(P[:, 0, None], P[:, 1, None], S[None, :, 0], S[None, :, 1], S[None, :, 2], S[None, :, 3])


def segment_distance(A, B):
    """Distance between segments [x1, y1, x2, y2] of A and B (broadcast against each other)."""
    a0x, a0y, a1x, a1y = (A[..., i] for i in range(4))
    b0x, b0y, b1x, b1y = (B[..., i] for i in range(4))
    d = np.minimum.reduce([
        _point_to_segment(a0x, a0y, b0x, b0y, b1x, b1y), _point_to_segment(a1x, a1y, b0x, b0y, b1x, b1y),
        _point_to_segment(b0x, b0y, a0x, a0y, a1x, a1y), _point_to_segment(b1x, b1y, a0x, a0y, a1x, a1y)])

    def side(sx, sy, ex, ey, x, y):
        return (ex - sx) * (y - sy) - (ey - sy) * (x - sx)
    crossing = (side(a0x, a0y, a1x, a1y, b0x, b0y) * side(a0x, a0y, a1x, a1y, b1x, b1y) < 0) & \
               (side(b0x, b0y, b1x, b1y, a0x, a0y) * side(b0x, b0y, b1x, b1y, a1x, a1y) < 0)
    return np.where(crossing, 0.0, d)


def segment_segments(A, B, within=None):
    """Distance of every segment of A (n, 4) to every segment of B (m, 4) -> (n, m). With `within`, pairs
    whose bounding boxes are further apart than that are not measured and come out as infinity."""
    if within is None:
        return segment_distance(A[:, None], B[None])
    lo_a, hi_a = np.minimum(A[:, :2], A[:, 2:]), np.maximum(A[:, :2], A[:, 2:])
    lo_b, hi_b = np.minimum(B[:, :2], B[:, 2:]), np.maximum(B[:, :2], B[:, 2:])
    gx = np.maximum(np.maximum(lo_a[:, None, 0] - hi_b[None, :, 0], lo_b[None, :, 0] - hi_a[:, None, 0]), 0)
    gy = np.maximum(np.maximum(lo_a[:, None, 1] - hi_b[None, :, 1], lo_b[None, :, 1] - hi_a[:, None, 1]), 0)
    i, j = np.nonzero(gx * gx + gy * gy < within * within)
    out = np.full((len(A), len(B)), np.inf)
    out[i, j] = segment_distance(A[i], B[j])
    return out
