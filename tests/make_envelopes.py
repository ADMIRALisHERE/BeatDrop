# BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE)
"""The four envelopes After Effects would measure, for every test song.

Reads tests/songs/*.wav (from make_songs.py) and writes <song>_env.csv
beside each: t, full, low, mid, high at High precision.

usage: py -3 make_envelopes.py [SONG_DIR]
"""
import glob
import os
import sys

import numpy as np

import ae_model as M

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    songs = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "songs")
    for wav in sorted(glob.glob(os.path.join(songs, "*.wav"))):
        sr, x = M.read_wav(wav)
        cols = M.four_envelopes(x, sr)
        out = wav[:-4] + "_env.csv"
        np.savetxt(out, np.column_stack(cols), delimiter=",", fmt="%.5f",
                   header="t,full,low,mid,high", comments="")
        print(os.path.basename(out), len(cols[0]), "frames")


if __name__ == "__main__":
    main()
