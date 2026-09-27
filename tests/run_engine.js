/* BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE) */
// Runs the shipped panel's own analysis on the test songs' envelopes,
// outside After Effects: the Constants, Long series ... One analysis
// sections and makeConfig are taken from the built .jsx and evaluated
// here, so what is tested is exactly what ships.
//
// usage (Windows):
//   cscript //nologo //E:JScript run_engine.js ..\dist\Admiral_BeatDrop.jsx songs results.txt [AMOUNT]
//
// Writes one line per song and mode: song|mode|t1,t2,... (seconds), and
// song|tempo|bpm|sections.
var $ = { os: "Windows" };
var fso = new ActiveXObject("Scripting.FileSystemObject");
var src = fso.OpenTextFile(WScript.Arguments(0), 1).ReadAll();
function section(from, to) {
    var a = src.indexOf(from), b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error("section not found: " + from);
    return src.substring(a, b);
}
eval(section("/*  Constants", "/*  Persisted settings"));
eval(section("/*  Long series", "/*  Marker writing"));
eval(section("    function makeConfig(", "    function resolveMusic("));

var songDir = WScript.Arguments(1);
var amount = WScript.Arguments.length > 3 ? parseFloat(WScript.Arguments(3)) : 50;
var adv = { minGap: 110, offset: 0, precision: 0, range: 0, target: 0, limit: 0, color: 10,
            source: 0, snap: true, number: true, replace: true, keepHelper: false };
var kinds = ["beat", "kick", "snare", "hat", "hit"];
var out = fso.CreateTextFile(WScript.Arguments(2), true);

function load(path) {
    var f = fso.OpenTextFile(path, 1), tt = [], cols = [[], [], [], []], c, p;
    f.ReadLine();
    while (!f.AtEndOfStream) {
        p = f.ReadLine().split(",");
        tt.push(+p[0]);
        for (c = 0; c < 4; c++) cols[c].push(+p[c + 1]);
    }
    f.Close();
    return { tl: { t0: tt[0], dt: (tt[tt.length - 1] - tt[0]) / (tt.length - 1), n: tt.length },
             full: seriesFrom(cols[0]), low: seriesFrom(cols[1]), mid: seriesFrom(cols[2]), high: seriesFrom(cols[3]) };
}

var files = new Enumerator(fso.GetFolder(songDir).Files), names = [];
for (; !files.atEnd(); files.moveNext()) {
    if (/_env\.csv$/.test(files.item().Name)) names.push(files.item().Name);
}
names.sort();
for (var s = 0; s < names.length; s++) {
    var song = names[s].replace(/_env\.csv$/, ""), b = load(songDir + "\\" + names[s]), line = song + ":";
    for (var m = 0; m < MARK_MODES.length; m++) {
        var cfg = makeConfig(MARK_MODES[m], amount, adv, { mode: 0, bpm: 120 });
        var r = analyzeEnvelopes(b, cfg), t = [], i, secs = [];
        for (i = 0; i < r.peaks.length; i++) t.push(Math.round(r.peaks[i].time * 10000) / 10000);
        out.WriteLine(song + "|" + kinds[m] + "|" + t.join(","));
        line += " " + kinds[m] + " " + r.peaks.length;
        if (m === 0) {
            for (i = 0; i < (r.tempo.sections || []).length; i++) {
                secs.push(r.tempo.sections[i].start.toFixed(1) + "-" + r.tempo.sections[i].end.toFixed(1) + "@" + r.tempo.sections[i].bpm);
            }
            out.WriteLine(song + "|tempo|" + r.tempo.bpm + "|" + secs.join(";"));
            line += " (" + r.tempo.bpm + " BPM)";
        }
    }
    WScript.Echo(line);
}
out.Close();
