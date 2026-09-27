# BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE)
"""Score run_engine.js results against the test songs' truth.

A marker counts when it is within 40 ms of a true hit. Each mode must find
its own instruments and may also mark some others without penalty (a kick
marker on a bass note is not wrong in "Kick & bass hits"). F1 combines
precision (how many markers are right) and recall (how many hits were
found). The tempo is checked against the song's true tempo, allowing
exactly double or half, which the panel's Tempo setting switches.

usage: py -3 score.py RESULTS [SONG_DIR]
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 0.040

# mode: (what it must find, what it may also mark)
MODES = {
    "beat":  None,
    "kick":  ({"kick"}, {"kick", "bass"}),
    "snare": ({"snare"}, {"snare", "pluck", "bass"}),
    "hat":   ({"hat"}, {"hat", "cymbal"}),
    "hit":   ({"kick", "snare"}, {"kick", "snare", "hat", "bass", "pluck", "cymbal"}),
}


def f1(p, r):
    return 2 * p * r / (p + r) if p + r else 0.0


def score_hits(marks, truth, need, allow):
    req = np.array(sorted(t for k in need for t in truth["truth"][k]))
    ok = sorted(t for k in allow for t in truth["truth"][k])
    ok = np.array(ok) if ok else np.array([-99.0])      # nothing of the kind in this song
    if len(marks) == 0:
        return 0.0, 0.0, 0.0
    hit = sum(1 for t in req if np.min(np.abs(marks - t)) <= TOL)
    fp = sum(1 for m in marks if np.min(np.abs(ok - m)) > TOL)
    p, r = (len(marks) - fp) / len(marks), (hit / len(req) if len(req) else 1.0)
    return p, r, f1(p, r)


def score_beats(marks, truth):
    beats = np.array(truth["beats"])
    if len(marks) == 0:
        return 0.0, 0.0, 0.0
    hit = sum(1 for b in beats if np.min(np.abs(marks - b)) <= TOL)
    good = sum(1 for m in marks if np.min(np.abs(beats - m)) <= TOL)
    p, r = good / len(marks), hit / len(beats)
    return p, r, f1(p, r)


def main():
    results = sys.argv[1]
    songs = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "songs")
    rows = {}
    for line in open(results):
        song, kind, rest = line.rstrip("\n").split("|", 2)
        rows.setdefault(song, {})[kind] = rest
    means = {m: [] for m in MODES}
    for song in sorted(rows):
        truth = json.load(open(os.path.join(songs, song + ".json")))
        bpm = float(rows[song]["tempo"].split("|")[0])
        verdict = next((tag for mult, tag in ((1, "ok"), (2, "double"), (0.5, "half"))
                        if abs(bpm - truth["bpm"] * mult) <= 0.03 * truth["bpm"] * mult), "WRONG")
        cells = []
        for m, spec in MODES.items():
            marks = np.array(sorted(float(x) for x in rows[song].get(m, "").split(",") if x))
            p, r, f = score_beats(marks, truth) if spec is None else score_hits(marks, truth, *spec)
            means[m].append(f)
            cells.append("%s %.2f" % (m, f))
        print("%-10s tempo %6.1f (true %d, %s)  %s" % (song, bpm, truth["bpm"], verdict, "  ".join(cells)))
    print("mean F1: " + "  ".join("%s %.3f" % (m, np.mean(v)) for m, v in means.items()))


if __name__ == "__main__":
    main()
