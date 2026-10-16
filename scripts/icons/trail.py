"""Outline of a tapered swept trail: a quadratic centreline whose width grows from tip to head.

Usage: python3 scripts/icons/trail.py x0 y0 cx cy x1 y1 w_tip w_head [samples] [gamma]

Prints closed SVG path data with a round head. It is an authoring aid only: the printed data is
pasted into the hand-written SVGs under docs/design/icons/ so each SVG stays self-contained.
"""
import math
import sys


def trail(p0, c, p1, w0, w1, n=24, g=1.0):
    def pt(t):
        a, b, d = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        return (a * p0[0] + b * c[0] + d * p1[0], a * p0[1] + b * c[1] + d * p1[1])

    def tangent(t):
        x = 2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0])
        y = 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1])
        length = math.hypot(x, y)
        return (x / length, y / length)

    left, right = [], []
    for i in range(n + 1):
        t = i / n
        (x, y), (tx, ty) = pt(t), tangent(t)
        w = (w0 + (w1 - w0) * t ** g) / 2
        left.append((x - ty * w, y + tx * w))
        right.append((x + ty * w, y - tx * w))
    f = lambda p: f"{p[0]:.2f} {p[1]:.2f}"
    r = w1 / 2
    d = "M" + f(left[0]) + "L" + "L".join(f(p) for p in left[1:])
    d += f"A{r:.2f} {r:.2f} 0 0 0 {f(right[-1])}"
    d += "L" + "L".join(f(p) for p in reversed(right[:-1])) + "Z"
    return d


if __name__ == "__main__":
    a = [float(v) for v in sys.argv[1:9]]
    n = int(sys.argv[9]) if len(sys.argv) > 9 else 24
    g = float(sys.argv[10]) if len(sys.argv) > 10 else 1.0
    print(trail((a[0], a[1]), (a[2], a[3]), (a[4], a[5]), a[6], a[7], n, g))
