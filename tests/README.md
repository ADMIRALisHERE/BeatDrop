# Tests

These run the shipped panel's own analysis outside After Effects, on songs whose every
hit time is known.

1. **`make_songs.py`** writes eight synthetic songs (30 s each: rock 120, house 124,
   hip-hop 90, phonk 140, drum and bass 174, trap 140, ballad 80, EDM 128) to
   `tests/songs/`, each with a `.json` listing the true tempo, the beat grid and the time of
   every kick, snare, hat, bass note, pluck and cymbal. The plucks are there on purpose:
   sharp sounds that are not drums.
2. **`make_envelopes.py`** turns each song into what the panel reads from After Effects
   (`ae_model.py`).
3. **`run_engine.js`** loads `dist/Admiral_BeatDrop.jsx`, takes the panel's analysis code
   out of it and runs every mode on every song (Windows Script Host, no After Effects).
4. **`score.py`** compares the markers with the truth: a marker counts within 40 ms of a
   true hit; each mode must find its own instruments and may mark some others without
   penalty (a bass note in *Kick & bass hits*).

```
cd tests
py -3 make_songs.py
py -3 make_envelopes.py
cscript //nologo //E:JScript run_engine.js ..\dist\Admiral_BeatDrop.jsx songs results.txt
py -3 score.py results.txt
```

Needs Python 3 with NumPy, and Windows for `cscript`. Expected for 1.2:

```
mean F1: beat 0.945  kick 0.924  snare 0.955  hat 0.819  hit 0.957
```

The ballad has no hi-hats, so its hat score is 0: the mode then marks other bright
sounds, a known limit.

The panel is also tested inside After Effects and on real music; those tests need After
Effects and the music itself, so they are not part of this folder.
