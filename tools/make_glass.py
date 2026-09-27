# BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE)
"""The panel's navy glass background, as a PNG in src/assets.

Deep navy, lighter at the top; a soft blue sheen in the top-left and the
bottom-right corners. It is drawn stretched to the panel's size, so it holds
no detail that stretching would spoil. A light ordered dither keeps the
dark gradient from banding in 8 bits.

usage: py -3 tools/make_glass.py
"""
import json
import os
import struct
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "src", "assets")
W, H = 360, 640


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)


def sheen(x, y, cx, cy, rx, ry, strength):
    """A soft elliptical glow: strength at its centre, nothing at the rim."""
    d = np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
    return strength * np.clip(1 - d, 0, 1) ** 1.6


def render():
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    fy = y / (H - 1)
    top, mid, low = hexrgb("#1D2F52"), hexrgb("#12203A"), hexrgb("#0C162A")
    f1 = np.clip(fy / 0.38, 0, 1)[..., None]
    f2 = np.clip((fy - 0.38) / 0.62, 0, 1)[..., None]
    img = np.where(fy[..., None] < 0.38, top + (mid - top) * f1, mid + (low - mid) * f2)
    light = hexrgb("#7DA0D7")
    a = sheen(x, y, 0.10 * W, -0.05 * H, 0.90 * W, 0.40 * H, 0.22)
    a = a + sheen(x, y, 0.90 * W, 1.04 * H, 1.20 * W, 0.55 * H, 0.26)
    img = img + (light - img) * np.clip(a, 0, 1)[..., None]
    bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 - 0.5
    img = img + bayer[(y % 4).astype(int), (x % 4).astype(int)][..., None]
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


def png(path, rgb):
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[r].tobytes() for r in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) +
                 chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    path = os.path.join(ASSETS, "glass.png")
    png(path, render())
    size = os.path.getsize(path)
    man_path = os.path.join(ASSETS, "manifest.json")
    manifest = json.load(open(man_path, encoding="ascii"))
    manifest = [m for m in manifest if m["name"] != "glass"] + [{"name": "glass", "w": W, "h": H, "bytes": size}]
    with open(man_path, "w", encoding="ascii", newline="\n") as fh:
        json.dump(manifest, fh, indent=4)
    print(path, W, "x", H, size, "bytes")


if __name__ == "__main__":
    main()
