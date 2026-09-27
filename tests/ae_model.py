# BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE)
"""What the panel reads from After Effects, modelled for the offline tests."""
import wave

import numpy as np

FPS = 23.976 * 2

LOW = [(2, 160), (2, 160)]
MID = [(1, 800), (1, 800), (2, 5000)]
HIGH = [(1, 8000), (1, 8000), (1, 8000)]


def read_wav(path):
    with wave.open(path) as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float64) / 32768.0
    return sr, x.reshape(-1, ch).mean(axis=1)


def response(freqs, sr, kind, fc):
    k = np.tan(np.pi * fc / sr)
    z1 = np.exp(-2j * np.pi * freqs / sr)
    den = (1 + k) + (k - 1) * z1
    if kind == 2:
        return k * (1 + z1) / den
    return (1 - z1) / den


def band(x, sr, spec):
    n = len(x)
    m = 1 << int(np.ceil(np.log2(n + sr)))
    X = np.fft.rfft(x, m)
    f = np.fft.rfftfreq(m, 1.0 / sr)
    H = np.ones_like(f, dtype=complex)
    for kind, fc in spec:
        H *= response(f, sr, kind, fc)
    return np.fft.irfft(X * H, m)[:n]


def envelope(x, sr, fps=FPS, gain=100.0):
    n = int(len(x) / sr * fps)
    edges = (np.arange(n + 1) * sr / fps).astype(int)
    c = np.concatenate([[0.0], np.cumsum(x * x)])
    e = (c[edges[1:]] - c[edges[:-1]]) / np.maximum(1, edges[1:] - edges[:-1])
    return np.arange(n) / fps, gain * np.sqrt(np.maximum(e, 0))


def four_envelopes(x, sr, fps=FPS):
    """t, full, low, mid, high."""
    t, full = envelope(x, sr, fps)
    return [t, full] + [2.0 * envelope(band(x, sr, spec), sr, fps)[1] for spec in (LOW, MID, HIGH)]
