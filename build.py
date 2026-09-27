# BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE)
"""Build dist/Admiral_BeatDrop.jsx from src/.

The panel ships as one self-contained ScriptUI file: the engine
(src/engine.js), the measuring and running core (src/engine_core.js), the
user interface (src/ui_section.js) and the PNG artwork (src/assets), which
is embedded as escaped byte strings. The build also writes
dist/SHA256SUMS.txt.

usage: py -3 build.py
"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
DIST = os.path.join(HERE, "dist")
OUT_NAME = "Admiral_BeatDrop.jsx"

HEADER = '''#target aftereffects
#targetengine "AdmiralBeatDrop"

/*
  ADMIRAL BEATDROP  %(version)s
  Beat and hit markers for After Effects 2022+.  made by Admiral

  Copyright (C) 2026 Amirhossein Asadi

  This program is free software: you can redistribute it and/or modify it
  under the terms of the GNU General Public License as published by the
  Free Software Foundation, either version 3 of the License, or (at your
  option) any later version. It is distributed in the hope that it will be
  useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
  Public License (LICENSE in the source, or <https://www.gnu.org/licenses/>).

  Using it
    1. Select the music layer in the timeline.
    2. Choose what to mark, and move Amount for fewer or more markers.
       For Every beat, Tempo can halve or double the detected tempo, or
       take an exact BPM.
    3. Click Add Beat Markers.
  Everything else sits under "Advanced settings", in its own window, and
  every control explains itself in a tooltip. A whole run is one undo step.

  The script writes no files except, on a build that cannot read an image
  from a string, its images into the system temp folder. It launches no
  processes and uses no network.
*/

'''


def js_string_tokens(data):
    for byte in data:
        if byte == 0x5C:
            yield "\\\\"
        elif byte == 0x22:
            yield '\\"'
        elif 0x20 <= byte <= 0x7E:
            yield chr(byte)
        else:
            yield "\\x%02X" % byte


def js_literal_lines(data, width=100):
    lines, cur = [], ""
    for tok in js_string_tokens(data):
        if len(cur) + len(tok) > width:
            lines.append(cur)
            cur = ""
        cur += tok
    if cur:
        lines.append(cur)
    return lines


def js_unescape(lit):
    out = bytearray()
    i = 0
    while i < len(lit):
        ch = lit[i]
        if ch == "\\":
            nxt = lit[i + 1]
            if nxt == "x":
                out.append(int(lit[i + 2:i + 4], 16))
                i += 4
                continue
            out.append(ord(nxt))
            i += 2
            continue
        out.append(ord(ch))
        i += 1
    return bytes(out)


def assets_function(manifest, asset_dir):
    parts = [
        "    /* ------------------------------------------------------------------ */",
        "    /*  Embedded artwork                                                   */",
        "    /* ------------------------------------------------------------------ */",
        "",
        "    /*",
        "      The Admiral PNGs, written as escaped byte strings so the panel stays",
        "      one self-contained .jsx. Sizes are in pixels.",
        "    */",
        "    function admiralAssets() {",
        "        return {",
    ]
    entries = []
    for item in manifest:
        with open(os.path.join(asset_dir, item["name"] + ".png"), "rb") as fh:
            data = fh.read()
        lines = js_literal_lines(data)
        assert js_unescape("".join(lines)) == data, item["name"]
        body = (' +\n' + ' ' * 16).join('"' + ln + '"' for ln in lines)
        entries.append(
            "            %s: { w: %d, h: %d, png:\n                %s }"
            % (item["name"], item["w"], item["h"], body))
    parts.append(",\n".join(entries))
    parts += ["        };", "    }", ""]
    return "\n".join(parts) + "\n"


def read_ascii(name):
    """A source file, without its one-line license notice: the built file
    carries the full notice once, in its header."""
    with open(os.path.join(SRC, name), encoding="ascii") as fh:
        text = fh.read()
    first, _, rest = text.partition("\n")
    return rest if "SPDX-License-Identifier" in first else text


def main():
    engine, core, ui = read_ascii("engine.js"), read_ascii("engine_core.js"), read_ascii("ui_section.js")
    m = re.search(r'var VERSION\s*=\s*"([^"]+)"', engine)
    if not m:
        sys.exit("no VERSION in src/engine.js")
    with open(os.path.join(SRC, "assets", "manifest.json"), encoding="ascii") as fh:
        manifest = json.load(fh)

    out = (HEADER % {"version": m.group(1)} + engine + core + ui +
           assets_function(manifest, os.path.join(SRC, "assets")) + "})(this);\n")
    out.encode("ascii")                     # fails loudly on a stray non-ASCII character
    os.makedirs(DIST, exist_ok=True)
    path = os.path.join(DIST, OUT_NAME)
    with open(path, "w", encoding="ascii", newline="\n") as fh:
        fh.write(out)
    digest = hashlib.sha256(out.encode("ascii")).hexdigest()
    with open(os.path.join(DIST, "SHA256SUMS.txt"), "w", encoding="ascii", newline="\n") as fh:
        fh.write("%s  %s\n" % (digest, OUT_NAME))
    print("%s  version %s, %d lines, sha256 %s" % (path, m.group(1), out.count("\n"), digest))


if __name__ == "__main__":
    main()
