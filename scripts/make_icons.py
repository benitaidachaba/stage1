#!/usr/bin/env python3
"""
Renders the Pocket mark in the app theme colours.

The mark: a rounded tile (berry #6E1734), a pocket glyph (cream #F2E4D0)
whose top edge dips in the middle, and a dot (rose-sand #C8A49F) sitting in
the dip — something peeking out of the pocket. Geometry follows the supplied
sample (pocket-icon.svg) so the shapes match; only the colours change.

Outputs:
  public/icon-192.png          tile, transparent corners (any purpose)
  public/icon-512.png          tile, transparent corners (any purpose)
  public/icon-maskable-512.png full-bleed square (maskable purpose)
  public/apple-touch-icon.png  full-bleed square, 180 (iOS home screen)
  src/app/favicon.ico          32px, PNG-embedded ICO
"""

import struct
import zlib
from pathlib import Path

TILE = (0x6E, 0x17, 0x34)        # berry
POCKET = (0xF2, 0xE4, 0xD0)      # cream
DOT = (0xC8, 0xA4, 0x9F)         # rose-sand

# Geometry in a 512x512 space, taken from the sample SVG.
TILE_SIZE = 512.0
TILE_RADIUS = 112.0

# Pocket: x 146..366, bottom 380 with 24px bottom corners, top edge dips.
PX0, PX1, PBOTTOM, PRADIUS = 146.0, 366.0, 380.0, 24.0
DOT_CX, DOT_CY, DOT_R = 256.0, 222.0, 19.0


def top_edge_lookup():
    """Sample the two cubic Beziers of the dip; return y of the curve per x."""
    seg1 = ((146, 196), (146, 196), (190, 236), (256, 236))
    seg2 = ((256, 236), (322, 236), (366, 196), (366, 196))
    curve = {}
    steps = 2000
    for seg in (seg1, seg2):
        p0, p1, p2, p3 = seg
        for i in range(steps + 1):
            t = i / steps
            mt = 1 - t
            x = (
                mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
            )
            y = (
                mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
            )
            xi = int(round(x))
            # Interior is below the curve, so keep the deepest sample per column.
            if xi not in curve or y > curve[xi]:
                curve[xi] = y
    return curve


CURVE = top_edge_lookup()


def in_tile(x, y, radius):
    """Rounded-rect test via the clamped-distance SDF."""
    nx = min(max(x, radius), TILE_SIZE - radius)
    ny = min(max(y, radius), TILE_SIZE - radius)
    return (x - nx) ** 2 + (y - ny) ** 2 <= radius**2


def in_pocket(x, y):
    if x < PX0 or x > PX1 or y > PBOTTOM:
        return False
    # Top edge: interpolate the dip curve between sampled columns.
    lo, hi = int(x), int(x) + 1
    if hi > 366:
        hi = lo
    top = CURVE.get(lo, 196.0)
    if hi != lo and hi in CURVE:
        frac = x - lo
        top = CURVE[lo] * (1 - frac) + CURVE[hi] * frac
    if y < top:
        return False
    if y > PBOTTOM - PRADIUS:  # bottom rounded corners
        if x < PX0 + PRADIUS:
            if (x - (PX0 + PRADIUS)) ** 2 + (y - (PBOTTOM - PRADIUS)) ** 2 > PRADIUS**2:
                return False
        elif x > PX1 - PRADIUS:
            if (x - (PX1 - PRADIUS)) ** 2 + (y - (PBOTTOM - PRADIUS)) ** 2 > PRADIUS**2:
                return False
    return True


def in_dot(x, y):
    return (x - DOT_CX) ** 2 + (y - DOT_CY) ** 2 <= DOT_R**2


def render(size, full_bleed=False, supersample=2):
    """Return RGBA rows for the mark at `size`, 2x supersampled for smooth edges."""
    scale = size / TILE_SIZE
    radius = 0.0 if full_bleed else TILE_RADIUS
    n = size * supersample
    rows = []
    for py in range(n):
        # Map back to the 512-space, sampling pixel centres.
        y = (py + 0.5) / supersample / scale
        row = bytearray()
        for px in range(n):
            x = (px + 0.5) / supersample / scale
            if in_dot(x, y):
                r, g, b, a = *DOT, 255
            elif in_pocket(x, y):
                r, g, b, a = *POCKET, 255
            elif in_tile(x, y, radius):
                r, g, b, a = *TILE, 255
            else:
                r, g, b, a = 0, 0, 0, 0
            row.extend((r, g, b, a))
        rows.append(bytes(row))

    # Box-average down to the target size.
    out = []
    for oy in range(size):
        row = bytearray()
        for ox in range(size):
            sr = sg = sb = sa = 0
            for dy in range(supersample):
                src_row = rows[oy * supersample + dy]
                for dx in range(supersample):
                    i = (ox * supersample + dx) * 4
                    sr += src_row[i]
                    sg += src_row[i + 1]
                    sb += src_row[i + 2]
                    sa += src_row[i + 3]
            k = supersample * supersample
            row.extend((sr // k, sg // k, sb // k, sa // k))
        out.append(bytes(row))
    return size, out


def write_png(path, size, rows):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + row for row in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    Path(path).write_bytes(png)
    return png


def main():
    public = Path("public")

    size512, rows512 = render(512)
    write_png(public / "icon-512.png", size512, rows512)
    print("public/icon-512.png")

    size192, rows192 = render(192)
    write_png(public / "icon-192.png", size192, rows192)
    print("public/icon-192.png")

    size_m, rows_m = render(512, full_bleed=True)
    write_png(public / "icon-maskable-512.png", size_m, rows_m)
    print("public/icon-maskable-512.png")

    size_a, rows_a = render(180, full_bleed=True)
    write_png(public / "apple-touch-icon.png", size_a, rows_a)
    print("public/apple-touch-icon.png")

    size_i, rows_i = render(32)
    png32 = write_png(public / "_favicon-32.png", size_i, rows_i)

    # ICO wrapper around the 32px PNG (supported by every modern browser).
    ico = (
        struct.pack("<HHH", 0, 1, 1)
        + struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png32), 22)
        + png32
    )
    Path("src/app/favicon.ico").write_bytes(ico)
    print("src/app/favicon.ico")
    (public / "_favicon-32.png").unlink()


if __name__ == "__main__":
    main()
