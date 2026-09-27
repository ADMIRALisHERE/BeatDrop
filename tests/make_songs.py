# BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE)
"""Synthetic songs with known hit times, for testing the drum modes.

Eight styles (rock 120, house 124, hip-hop 90, phonk 140, drum and bass
174, trap 140, ballad 80, EDM 128), 30 s each. Each gets its own kit,
tempo and pattern, plus a bass line, a pad and melodic plucks (sharp
mid-range attacks that are not drums). For every track <song>.json lists
the true tempo, the beat grid and the onset time of every kick,
snare/clap/rim, hat, bass note, pluck and cymbal. The songs are the same
on every run (fixed seeds).

usage: py -3 make_songs.py [OUT_DIR]     (default: tests/songs)
"""
import json
import os
import sys
import wave

import numpy as np

SR = 48000
DUR = 30.0
out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "songs")
os.makedirs(out_dir, exist_ok=True)


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1.0, t / max(attack, 1e-6)) * np.exp(-t / decay)


def band_noise(rng, n, lo, hi):
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(X, n)
    return y / (np.max(np.abs(y)) + 1e-12)


def sweep(n, f_end, f_extra, tau):
    t = np.arange(n) / SR
    f = f_end + f_extra * np.exp(-t / tau)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def kick(rng, kind):
    if kind == "clean":
        n = int(0.5 * SR)
        return sweep(n, 50, 70, 0.03) * env(n, 0.002, 0.30)
    if kind == "punch":
        n = int(0.45 * SR)
        x = sweep(n, 55, 130, 0.02) * env(n, 0.001, 0.22)
        c = int(0.012 * SR)
        x[:c] += 0.28 * band_noise(rng, c, 1500, 6000) * env(c, 0.0003, 0.004)
        return x
    if kind == "808":
        n = int(1.1 * SR)
        return np.tanh(1.6 * sweep(n, 44, 45, 0.05) * env(n, 0.002, 0.75)) / np.tanh(1.6)
    if kind == "dist":
        n = int(0.4 * SR)
        x = sweep(n, 58, 150, 0.018) * env(n, 0.001, 0.2)
        return np.tanh(3.0 * x) / np.tanh(3.0)
    raise ValueError(kind)


def snare(rng, kind):
    if kind == "bright":
        n = int(0.35 * SR)
        t = np.arange(n) / SR
        body = 0.45 * np.sin(2 * np.pi * 200 * t) * env(n, 0.001, 0.05)
        return body + 0.85 * band_noise(rng, n, 1000, 9000) * env(n, 0.001, 0.13)
    if kind == "fat":
        n = int(0.4 * SR)
        t = np.arange(n) / SR
        body = 0.7 * (np.sin(2 * np.pi * 172 * t) + 0.5 * np.sin(2 * np.pi * 330 * t)) * env(n, 0.001, 0.08)
        return body + 0.6 * band_noise(rng, n, 400, 7000) * env(n, 0.001, 0.17)
    if kind == "clap":
        n = int(0.3 * SR)
        x = np.zeros(n)
        for k, d in enumerate([0.0, 0.011, 0.022]):
            i = int(d * SR)
            m = int(0.02 * SR)
            x[i:i + m] += (0.9 - 0.15 * k) * band_noise(rng, m, 800, 5000) * env(m, 0.0005, 0.006)
        i = int(0.03 * SR)
        x[i:] += 0.6 * band_noise(rng, n - i, 800, 6000) * env(n - i, 0.001, 0.11)
        return x
    if kind == "rim":
        n = int(0.12 * SR)
        t = np.arange(n) / SR
        return (0.6 * np.sin(2 * np.pi * 460 * t) + 0.4 * band_noise(rng, n, 1500, 5000)) * env(n, 0.0005, 0.025)
    raise ValueError(kind)


def hat(rng, kind):
    if kind == "closed":
        n = int(0.12 * SR)
        return band_noise(rng, n, 7000, 16000) * env(n, 0.0005, 0.028)
    if kind == "open":
        n = int(0.6 * SR)
        return band_noise(rng, n, 6000, 16000) * env(n, 0.001, 0.28)
    if kind == "shaker":
        n = int(0.15 * SR)
        return band_noise(rng, n, 4000, 12000) * env(n, 0.006, 0.05)
    raise ValueError(kind)


def bass_note(freq, dur, kind="sine"):
    n = int((dur + 0.08) * SR)
    t = np.arange(n) / SR
    if kind == "saw":
        x = sum(np.sin(2 * np.pi * freq * h * t) / h for h in range(1, 7))
    else:
        x = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)
    a = np.minimum(1.0, t / 0.006)
    r = np.clip((dur + 0.08 - t) / 0.08, 0, 1)
    return x * a * r


def pluck(freq):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    x = sum((0.8 ** h) * np.sin(2 * np.pi * freq * h * t) for h in range(1, 6))
    return x * env(n, 0.002, 0.22)


def pad(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * 2 * f * t) for f in freqs)
    a = np.minimum(1.0, t / 0.4) * np.minimum(1.0, (dur - t) / 0.4)
    return x * a / len(freqs)


class Track:
    def __init__(self, name, bpm, seed):
        self.name, self.bpm = name, bpm
        self.rng = np.random.default_rng(seed)
        self.mix = np.zeros(int(DUR * SR) + SR)
        self.truth = {"kick": [], "snare": [], "hat": [], "bass": [], "pluck": [], "cymbal": []}
        self.beat = 60.0 / bpm

    def put(self, sound, t, gain, label=None):
        if t < 0 or t >= DUR - 0.05:
            return
        i = int(round(t * SR))
        j = min(len(self.mix), i + len(sound))
        self.mix[i:j] += gain * sound[: j - i]
        if label:
            self.truth[label].append(round(t, 5))

    def human(self, t, ms=4):
        return t + self.rng.uniform(-ms, ms) / 1000.0

    def write(self):
        m = self.mix[: int(DUR * SR)]
        m = m / (np.max(np.abs(m)) * 1.08)
        pcm = (m * 32767).astype("<i2")
        path = os.path.join(out_dir, self.name + ".wav")
        with wave.open(path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(np.column_stack([pcm, pcm]).ravel().tobytes())
        for k in self.truth:
            self.truth[k] = sorted(self.truth[k])
        first = 1.0
        beats = [round(first + i * self.beat, 5) for i in range(int((DUR - first) / self.beat))]
        json.dump({"bpm": self.bpm, "beats": beats, "truth": self.truth, "duration": DUR},
                  open(os.path.join(out_dir, self.name + ".json"), "w"), indent=1)
        return path


def bars(track, first=1.0):
    n = int((DUR - first) / (4 * track.beat))
    return [first + b * 4 * track.beat for b in range(n)]


def add_music(tr, root, plucks=True, pluck_gain=0.3, pad_gain=0.22):
    chords = [[root, root * 1.26, root * 1.5], [root * 0.89, root * 1.12, root * 1.33]]
    for i, b in enumerate(bars(tr)):
        tr.put(pad([f * 2 for f in chords[i % 2]], 4 * tr.beat), b, pad_gain)
        if plucks:
            for k, step in enumerate([0.0, 1.5, 2.5, 3.0]):
                f = [root * 4, root * 5, root * 6, root * 4.5][(k + i) % 4]
                tr.put(pluck(f), tr.human(b + step * tr.beat, 3), pluck_gain, "pluck")


def style_rock(seed):
    tr = Track("rock_120", 120, seed)
    k, s, h = kick(tr.rng, "punch"), snare(tr.rng, "bright"), hat(tr.rng, "closed")
    for b in bars(tr):
        for step in [0, 2, 2.5]:
            tr.put(k, tr.human(b + step * tr.beat), 0.9, "kick")
        for step in [1, 3]:
            tr.put(s, tr.human(b + step * tr.beat), 0.7, "snare")
        for step in np.arange(0, 4, 0.5):
            tr.put(h, tr.human(b + step * tr.beat, 3), 0.25 + 0.1 * tr.rng.random(), "hat")
        for step, f in [(0, 55), (2, 55), (2.5, 65.4), (3.5, 49)]:
            tr.put(bass_note(f, 0.4, "saw"), b + step * tr.beat, 0.28, "bass")
    add_music(tr, 110)
    return tr


def style_house(seed):
    tr = Track("house_124", 124, seed)
    k, c = kick(tr.rng, "clean"), snare(tr.rng, "clap")
    ho, hc = hat(tr.rng, "open"), hat(tr.rng, "closed")
    for b in bars(tr):
        for step in range(4):
            tr.put(k, b + step * tr.beat, 0.95, "kick")
        for step in [1, 3]:
            tr.put(c, tr.human(b + step * tr.beat, 2), 0.65, "snare")
        for step in [0.5, 1.5, 2.5, 3.5]:
            tr.put(ho, b + step * tr.beat, 0.22, "hat")
        for step in np.arange(0, 4, 0.25):
            if step % 0.5:
                tr.put(hc, tr.human(b + step * tr.beat, 2), 0.12, "hat")
        for step in [0.5, 1.5, 2.5, 3.5]:
            tr.put(bass_note(49, 0.18), b + step * tr.beat, 0.35, "bass")
    add_music(tr, 98, pluck_gain=0.25)
    return tr


def style_hiphop(seed):
    tr = Track("hiphop_90", 90, seed)
    k, s, h = kick(tr.rng, "dist"), snare(tr.rng, "fat"), hat(tr.rng, "closed")
    for b in bars(tr):
        for step in [0, 0.75, 2.5]:
            tr.put(k, tr.human(b + step * tr.beat, 6), 0.9, "kick")
        for step in [1, 3]:
            tr.put(s, tr.human(b + step * tr.beat, 6), 0.75, "snare")
        for step in np.arange(0, 4, 0.25):
            tr.put(h, tr.human(b + step * tr.beat, 5), 0.12 + 0.18 * tr.rng.random(), "hat")
    add_music(tr, 130, pluck_gain=0.35)
    return tr


def style_phonk(seed):
    tr = Track("phonk_140", 140, seed)
    k, s = kick(tr.rng, "808"), snare(tr.rng, "clap")
    h = hat(tr.rng, "closed")
    for b in bars(tr):
        for step in [0, 1.75]:
            tr.put(k, b + step * tr.beat, 0.95, "kick")
        tr.put(s, b + 2 * tr.beat, 0.75, "snare")
        for step in np.arange(0, 4, 1.0 / 3):
            tr.put(h, tr.human(b + step * tr.beat, 2), 0.2, "hat")
        # the cowbell-ish melody: sharp mid-range plucks, not drums
        for k2, step in enumerate([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]):
            tr.put(pluck([587, 659, 784, 698][k2 % 4]), b + step * tr.beat, 0.22, "pluck")
    return tr


def style_dnb(seed):
    tr = Track("dnb_174", 174, seed)
    k, s, h = kick(tr.rng, "punch"), snare(tr.rng, "bright"), hat(tr.rng, "shaker")
    for b in bars(tr):
        for step in [0, 2.5]:
            tr.put(k, tr.human(b + step * tr.beat, 2), 0.9, "kick")
        for step in [1, 3]:
            tr.put(s, tr.human(b + step * tr.beat, 2), 0.8, "snare")
        for step in np.arange(0, 4, 0.5):
            tr.put(h, tr.human(b + step * tr.beat, 2), 0.25, "hat")
        tr.put(bass_note(41, 4 * tr.beat - 0.1, "saw"), b, 0.25, "bass")
    add_music(tr, 87, pluck_gain=0.2)
    return tr


def style_trap(seed):
    tr = Track("trap_140", 140, seed)
    k, c, h = kick(tr.rng, "808"), snare(tr.rng, "clap"), hat(tr.rng, "closed")
    for b in bars(tr):
        tr.put(k, b, 0.9, "kick")
        tr.put(k, b + 2.75 * tr.beat, 0.8, "kick")
        tr.put(c, b + 2 * tr.beat, 0.7, "snare")
        step = 0.0
        while step < 4:
            roll = 0.125 if 3.0 <= step < 3.5 else 0.5
            tr.put(h, b + step * tr.beat, 0.22, "hat")
            step += roll
    add_music(tr, 110, pluck_gain=0.25)
    return tr


def style_ballad(seed):
    tr = Track("ballad_80", 80, seed)
    k, r = kick(tr.rng, "clean"), snare(tr.rng, "rim")
    for b in bars(tr):
        tr.put(k, tr.human(b, 8), 0.5, "kick")
        tr.put(k, tr.human(b + 2.5 * tr.beat, 8), 0.4, "kick")
        for step in [1, 3]:
            tr.put(r, tr.human(b + step * tr.beat, 8), 0.4, "snare")
    add_music(tr, 131, pluck_gain=0.4, pad_gain=0.3)
    return tr


def style_edm(seed):
    tr = Track("edm_128", 128, seed)
    k, c = kick(tr.rng, "punch"), snare(tr.rng, "clap")
    ho, crash = hat(tr.rng, "open"), band_noise(tr.rng, int(1.5 * SR), 3000, 16000) * env(int(1.5 * SR), 0.002, 0.6)
    all_bars = bars(tr)
    drop = all_bars[len(all_bars) // 2]
    for b in all_bars:
        if b < drop:
            continue
        if b == drop:
            tr.put(crash, b, 0.45, "cymbal")
        for step in range(4):
            tr.put(k, b + step * tr.beat, 0.95, "kick")
        for step in [1, 3]:
            tr.put(c, b + step * tr.beat, 0.7, "snare")
        for step in [0.5, 1.5, 2.5, 3.5]:
            tr.put(ho, b + step * tr.beat, 0.25, "hat")
        for step in np.arange(0, 4, 0.5):
            tr.put(bass_note(55, 0.2, "saw"), b + step * tr.beat + 0.25 * tr.beat, 0.25, "bass")
    add_music(tr, 110, pluck_gain=0.3)
    return tr


styles = [style_rock, style_house, style_hiphop, style_phonk, style_dnb, style_trap, style_ballad, style_edm]
for i, style in enumerate(styles):
    t = style(100 + i)
    p = t.write()
    counts = ", ".join("%s %d" % (k, len(v)) for k, v in t.truth.items() if v)
    print(os.path.basename(p), "-", counts)
