# Changelog

## 1.2 - 2026-09-27

- **A new look: navy glass.** The panel and the Advanced settings window sit on navy glass;
  cards and secondary buttons are lighter glass with fine light edges. The header is a
  serif ADMIRAL wordmark.
- **Better tempo parts in long edits.** A long edit with several songs is split more
  reliably into parts at each song's own tempo, including tempos that are close
  relatives of each other.
- **Fewer tempo mix-ups** on slowed tracks with triplet hi-hats.
- **"(or 174.0)" on the result line** when the other speed (double or half) fits the music
  almost as well; the tooltip says which Tempo setting gives it.
- The result line is shortened to the panel's real width.
- Help: two new tips.
- Released under the GNU General Public License v3.0 or later.

Tested inside After Effects 24.6 and on a large set of real music. Accuracy on the test
songs is unchanged.

## 1.1 - 2026-09-27

- New tempo and beat detection: F1 on the test songs - beat 0.61 -> 0.95, kick 0.79 ->
  0.92, snare 0.56 -> 0.96, hat 0.54 -> 0.82, every hit 0.87 -> 0.96.
- Tempo setting: Auto-detect, Half speed, Double speed, Exact BPM.
- Long edits: 20-30 minute timelines work; a 4-minute song went from 95 s to under 20 s.
- Large marker runs: the panel says how long they will take and asks first.
- Your composition, work area and playhead are left as they were; no leftover layers or
  solids in the project.
- Fixed: with the work area set late in a long composition, the wrong part was measured.

## 1.0

- First Admiral version: the Admiral look, five modes with explanations, Amount,
  Advanced settings in their own window.
