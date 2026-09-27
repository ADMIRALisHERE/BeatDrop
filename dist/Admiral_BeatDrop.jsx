#target aftereffects
#targetengine "AdmiralBeatDrop"

/*
  ADMIRAL BEATDROP  1.2
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

(function AdmiralBeatDrop(thisObj) {

    /* ------------------------------------------------------------------ */
    /*  Constants                                                          */
    /* ------------------------------------------------------------------ */

    var APP_NAME = "Admiral BeatDrop";
    var VERSION  = "1.2";
    var PREFIX   = "[ABM]";

    var SETTINGS_SECTION = "AdmiralBeatDrop.1";

    var C_OK   = [0.45, 0.85, 0.52];
    var C_WARN = [1.00, 0.76, 0.30];
    var C_ERR  = [1.00, 0.47, 0.47];
    var C_DIM  = [0.62, 0.62, 0.66];
    var C_TEXT = [0.86, 0.86, 0.88];

    var LABEL_NAMES = [
        "None","Red","Yellow","Aqua","Pink","Lavender","Peach","Sea Foam",
        "Blue","Green","Purple","Orange","Brown","Fuchsia","Cyan","Sandstone",
        "Dark Green"
    ];

    var MARK_MODES = [
        { name: "Every beat",          focus: 0, grid: true,
          what: "One marker on every beat, like a metronome.",
          bestFor: "cutting clips to the music." },
        { name: "Kick & bass hits",    focus: 1, grid: false,
          what: "Only the deep hits: kick drum, 808, bass.",
          bestFor: "impacts, zooms and shakes." },

        { name: "Snare & clap hits",   focus: 2, grid: false,
          what: "Snares and claps, plus other sharp mid sounds.",
          bestFor: "flashes, text pops, glitches." },
        { name: "Hi-hats & fast hits", focus: 3, grid: false,
          what: "Only the fast, bright hits: hi-hats, shakers.",
          bestFor: "quick flickers and small details." },
        { name: "Every hit",           focus: 0, grid: false,
          what: "Every strong sound in the song, any instrument.",
          bestFor: "speech, sound effects, no drums." }
    ];

    var UNDO_KEYS = (String($.os).toLowerCase().indexOf("mac") >= 0) ? "Cmd+Z" : "Ctrl+Z";

    var TARGET_ITEMS    = ["Composition", "Music layer", "Both"];
    var RANGE_ITEMS     = ["Work area", "Whole composition", "Music layer only"];

    var PRECISION_ITEMS = ["High (recommended)", "Ultra (most precise)"];
    var LIMIT_ITEMS     = ["No limit", "Strongest 50", "Strongest 100",
                           "Strongest 250", "Strongest 500"];
    var LIMIT_VALUES    = [0, 50, 100, 250, 500];
    var SOURCE_ITEMS    = ["Analyze automatically", "Use my Audio Amplitude layer"];

    var TEMPO_ITEMS     = ["Auto-detect", "Half speed", "Double speed", "Exact BPM"];

    var TEMPO_WHAT      = ["The panel finds the tempo itself.",
                           "A marker on every second beat.",
                           "A marker on every half beat as well.",
                           "Markers follow exactly the tempo you type."];

    var DEFAULTS = {
        markMode: 0, amount: 50, tempoMode: 0, tempoBpm: 120,
        target: 0, range: 0, color: 10, minGap: 110, offset: 0,
        precision: 0, limit: 0, source: 0,
        snap: true, number: true, replace: true, keepHelper: false
    };

    var EDGE_PAD = 0.5;

    var CACHE = {}, CACHE_ORDER = [];
    var CACHE_LIMIT = 8;

    /* ------------------------------------------------------------------ */
    /*  Small utilities                                                    */
    /* ------------------------------------------------------------------ */

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function numericSort(a, b) { return a - b; }

    function toInt(str, fallback) {
        var n = parseInt(str, 10);
        return isNaN(n) ? fallback : n;
    }

    function percentile(sorted, p) {
        var n = sorted.length;
        if (n === 0) return 0;
        if (n === 1) return sorted[0];
        var pos  = (n - 1) * p;
        var base = Math.floor(pos);
        var rest = pos - base;
        if (base + 1 < n) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        return sorted[base];
    }

    function median(values) {
        return percentile(values.slice(0).sort(numericSort), 0.5);
    }

    function mean(values) {
        var i, s = 0, n = values.length;
        if (n === 0) return 0;
        for (i = 0; i < n; i++) s += values[i];
        return s / n;
    }

    function formatTime(seconds) {
        var t = Math.abs(seconds);
        var m = Math.floor(t / 60);
        var s = Math.round((t - m * 60) * 100) / 100;
        return (seconds < 0 ? "-" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    }

    function errorText(err) {
        var text = "" + err;
        try { if (err.message) text = err.message; } catch (_) {}
        return text;
    }

    function ellipsize(text, max) {
        var s = String(text).replace(/[\r\n]+/g, "  ");
        return s.length > max ? (s.substring(0, max - 3) + "...") : s;
    }

    function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

    /* ------------------------------------------------------------------ */
    /*  Persisted settings                                                 */
    /* ------------------------------------------------------------------ */

    function saveSetting(key, value) {
        try { app.settings.saveSetting(SETTINGS_SECTION, key, String(value)); } catch (_) {}
    }

    function readSetting(key, fallback) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                return app.settings.getSetting(SETTINGS_SECTION, key);
            }
        } catch (_) {}
        return fallback;
    }

    function readInt(key, fallback) { return toInt(readSetting(key, String(fallback)), fallback); }

    function readBool(key, fallback) { return readSetting(key, fallback ? "1" : "0") === "1"; }

    /* ------------------------------------------------------------------ */
    /*  After Effects helpers                                              */
    /* ------------------------------------------------------------------ */

    function activeComp() {
        var item = app.project ? app.project.activeItem : null;
        return (item && (item instanceof CompItem)) ? item : null;
    }

    function requireComp() {
        var comp = activeComp();
        if (!comp) {
            throw new Error("Open your composition first.\n\n" +
                "Double-click it in the Project panel, then click in its timeline.");
        }
        return comp;
    }

    function requireAudioLayer(comp) {
        var layer, hasAudio = false;
        if (comp.selectedLayers.length === 0) {
            throw new Error("Select your music layer first.\n\n" +
                "Click the music layer in the timeline, then try again.");
        }
        if (comp.selectedLayers.length > 1) {
            throw new Error(comp.selectedLayers.length + " layers are selected.\n\n" +
                "Select only the music layer, then try again.");
        }
        layer = comp.selectedLayers[0];
        try { hasAudio = (layer.hasAudio === true); } catch (_) {}
        if (!hasAudio) {
            throw new Error("'" + ellipsize(layer.name, 40) + "' has no sound.\n\n" +
                "Select the layer that holds the music.");
        }
        return layer;
    }

    function snapshotSelection(comp) {
        var refs = [], i;
        for (i = 1; i <= comp.numLayers; i++) {
            try { if (comp.layer(i).selected) refs.push(comp.layer(i)); } catch (_) {}
        }
        return refs;
    }

    function restoreSelection(comp, refs) {
        var i;
        if (!comp) return;
        try {
            for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        } catch (_) {}
        if (!refs) return;
        for (i = 0; i < refs.length; i++) {
            try { refs[i].selected = true; } catch (_) {}
        }
    }

    function setWorkArea(comp, start, duration) {
        var fd = comp.frameDuration;
        start = clamp(start, 0, Math.max(0, comp.duration - fd));
        comp.workAreaStart = 0;
        comp.workAreaDuration = comp.duration;
        comp.workAreaStart = start;
        comp.workAreaDuration = clamp(duration, fd, comp.duration - comp.workAreaStart);
        if (Math.abs(comp.workAreaStart - start) > fd) {
            throw new Error("After Effects did not move the work area to " + formatTime(start) + ".");
        }
    }

    function isAmplitudeHelper(layer) {
        var effects, i, sliders = 0;
        if (!layer) return false;
        try {
            effects = layer.property("ADBE Effect Parade");
            if (!effects) return false;
            for (i = 1; i <= effects.numProperties; i++) {
                if (effects.property(i).matchName === "ADBE Slider Control") sliders++;
            }
        } catch (_) { return false; }
        return sliders === 3;
    }

    function looksLikeAmplitudeName(layer) {
        var n = "";
        try { n = String(layer.name).toLowerCase(); } catch (_) { return false; }
        return n.indexOf("amplitude") !== -1;
    }

    function findAmplitudeHelper(comp, newestCount) {
        var i, limit, fallback = null;
        if (!comp) return null;

        if (newestCount && newestCount > 0) {
            limit = Math.min(comp.numLayers, newestCount + 2);
            for (i = 1; i <= limit; i++) {
                if (isAmplitudeHelper(comp.layer(i))) return comp.layer(i);
            }
        }
        for (i = 1; i <= comp.numLayers; i++) {
            if (isAmplitudeHelper(comp.layer(i))) {
                if (looksLikeAmplitudeName(comp.layer(i))) return comp.layer(i);
                if (!fallback) fallback = comp.layer(i);
            }
        }
        return fallback;
    }

    function convertAudioCommandId() {
        var names = [
            "Convert Audio to Keyframes",
            "Audio in Keyframes konvertieren",
            "Convertir les donn\u00E9es audio en images cl\u00E9s",
            "Converti audio in fotogrammi chiave",
            "Convertir audio en fotogramas clave",
            "Converter \u00E1udio em quadros-chave",
            "\u30AA\u30FC\u30C7\u30A3\u30AA\u3092\u30AD\u30FC\u30D5\u30EC\u30FC\u30E0\u306B\u5909\u63DB",
            "\uC624\uB514\uC624\uB97C \uD0A4\uD504\uB808\uC784\uC73C\uB85C \uBCC0\uD658",
            "\u041A\u043E\u043D\u0432\u0435\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0430\u0443\u0434\u0438\u043E \u0432 \u043A\u043B\u044E\u0447\u0435\u0432\u044B\u0435 \u043A\u0430\u0434\u0440\u043E\u0432",
            "\u5C06\u97F3\u9891\u8F6C\u6362\u4E3A\u5173\u952E\u5E27"
        ];
        var i, id;
        for (i = 0; i < names.length; i++) {
            try {
                id = app.findMenuCommandId(names[i]);
                if (id && id > 0) return id;
            } catch (_) {}
        }
        return 0;
    }

    function convertAudioToKeyframes(comp, audioLayer) {
        var before = comp.numLayers;
        var cmdId  = convertAudioCommandId();
        var i, helper;

        if (!cmdId) {
            throw new Error(
                "After Effects did not expose the 'Convert Audio to Keyframes' " +
                "command in this UI language.\n\n" +
                "Run Animation > Keyframe Assistant > Convert Audio to Keyframes " +
                "yourself, set Advanced settings > Audio source to 'Use my Audio Amplitude " +
                "layer', and try again."
            );
        }

        for (i = 1; i <= comp.numLayers; i++) {
            try { comp.layer(i).selected = false; } catch (_) {}
        }
        audioLayer.selected = true;
        app.executeCommand(cmdId);

        if (comp.numLayers <= before) {
            throw new Error("Convert Audio to Keyframes produced no Audio Amplitude layer.");
        }
        helper = findAmplitudeHelper(comp, comp.numLayers - before);
        if (!helper) {
            throw new Error("An Audio Amplitude layer was created but could not be identified.");
        }
        return helper;
    }

    /* ------------------------------------------------------------------ */
    /*  Band capture                                                       */
    /* ------------------------------------------------------------------ */

    var HIGHLOW_MATCH = "ADBE Aud HiLo";
    var MIXER_MATCH = "ADBE Aud Stereo Mixer";
    var TEMP_COMP_NAME = "BeatDrop temporary measurement";
    var TEMP_COPY_NAME = "BeatDrop temporary band";

    var TEMP_FILTER_NAME = "BeatDrop temporary filter";

    var HLP_HIGH_PASS = 1;
    var HLP_LOW_PASS  = 2;

    var BAND_FILTERS = {
        full: [],
        low:  [[HLP_LOW_PASS, 160], [HLP_LOW_PASS, 160]],
        mid:  [[HLP_HIGH_PASS, 800], [HLP_HIGH_PASS, 800], [HLP_LOW_PASS, 5000]],
        high: [[HLP_HIGH_PASS, 8000], [HLP_HIGH_PASS, 8000], [HLP_HIGH_PASS, 8000]]
    };

    var BAND_PAIRS = [["full", "low"], ["mid", "high"]];

    function lastEffect(layer) {
        var effects = layer.property("ADBE Effect Parade");
        return effects.property(effects.numProperties);
    }

    function makeBandCopy(layer, band, pan) {
        var copy = layer.duplicate(), effects, filters = BAND_FILTERS[band], i, fx;
        try { copy.locked = false; } catch (_) {}
        copy.name = TEMP_COPY_NAME + " " + band;
        effects = copy.property("ADBE Effect Parade");

        if (copy.effectsActive === false) {
            for (i = effects.numProperties; i >= 1; i--) effects.property(i).remove();
            copy.effectsActive = true;
        }
        for (i = 0; i < filters.length; i++) {
            copy.property("ADBE Effect Parade").addProperty(HIGHLOW_MATCH);
            fx = lastEffect(copy);
            fx.property(1).setValue(filters[i][0]);
            fx.property(2).setValue(filters[i][1]);
        }
        copy.property("ADBE Effect Parade").addProperty(MIXER_MATCH);
        fx = lastEffect(copy);
        fx.property(3).setValue(pan);
        fx.property(4).setValue(pan);
        copy.audioEnabled = true;
        return copy;
    }

    function projectItemIds() {
        var ids = {}, i;
        for (i = 1; i <= app.project.numItems; i++) {
            try { ids[app.project.item(i).id] = true; } catch (_) {}
        }
        return ids;
    }

    function removeNewUnusedItems(before) {
        var i, item;
        for (i = app.project.numItems; i >= 1; i--) {
            item = app.project.item(i);
            try {
                if (!before[item.id] && (item instanceof FootageItem) &&
                    (item.mainSource instanceof SolidSource) && item.usedIn.length === 0) {
                    item.remove();
                }
            } catch (_) {}
        }
        for (i = app.project.numItems; i >= 1; i--) {
            item = app.project.item(i);
            try {
                if (!before[item.id] && (item instanceof FolderItem) && item.numItems === 0) item.remove();
            } catch (_) {}
        }
    }

    function removeTempComps() {
        var i, item, removed = 0;
        for (i = app.project.numItems; i >= 1; i--) {
            item = app.project.item(i);
            try {
                if ((item instanceof CompItem) && String(item.name).indexOf(TEMP_COMP_NAME) === 0) {
                    item.remove();
                    removed++;
                }
            } catch (_) {}
        }
        return removed;
    }

    function removeTempFilters(layer) {
        var effects = null, i, removed = 0;
        try { effects = layer.property("ADBE Effect Parade"); } catch (_) {}
        if (!effects) return 0;
        for (i = effects.numProperties; i >= 1; i--) {
            try {
                if (String(effects.property(i).name).indexOf(TEMP_FILTER_NAME) === 0) {
                    effects.property(i).remove();
                    removed++;
                }
            } catch (_) {}
        }
        return removed;
    }

    function channelSlider(helper, n) {
        var effects = helper.property("ADBE Effect Parade");
        var i, count = 0;
        for (i = 1; i <= effects.numProperties; i++) {
            if (effects.property(i).matchName === "ADBE Slider Control") {
                count++;
                if (count === n) return effects.property(i).property(1);
            }
        }
        throw new Error("The Audio Amplitude layer is missing a channel slider.");
    }

    function readKeysInto(slider, s, f0, fps) {
        var nk = slider.numKeys, j, idx, first, last, v, counted, sb = s.b;
        if (nk < 1) return 0;
        first = Math.round(slider.keyTime(1) * fps) - f0;
        last = Math.round(slider.keyTime(nk) * fps) - f0;
        counted = (last - first === nk - 1);
        for (j = 1; j <= nk; j++) {
            idx = counted ? first + j - 1 : Math.round(slider.keyTime(j) * fps) - f0;
            if (idx < 0 || idx >= s.n) continue;
            v = slider.keyValue(j);
            if (v instanceof Array) v = v[0];
            v = Math.abs(Number(v));
            sb[idx >> 8][idx & 255] = isNaN(v) ? 0 : v;
        }
        return nk;
    }

    /* ------------------------------------------------------------------ */
    /*  Markers                                                            */
    /* ------------------------------------------------------------------ */

    function layerMarkerProperty(layer) { return layer.property("ADBE Marker"); }

    var MARKERS_WITHOUT_ASKING = 1500;
    var MARKERS_MAX = 5000;

    function addSeconds(n) { return 9e-6 * n * n + 0.002 * n; }
    function addMegabytes(n) { return 215 * (n / 1000) * (n / 1000); }

    function markerCost(added, removed) {
        return {
            seconds: addSeconds(added) + 0.55 * addSeconds(removed),
            megabytes: addMegabytes(added) + 0.4 * addMegabytes(removed)
        };
    }

    function durationText(s) {
        return s < 90 ? Math.max(1, Math.round(s)) + " seconds" : Math.round(s / 60) + " minutes";
    }

    function markerCostText(cost) {
        var gb = cost.megabytes / 1024;
        return "about " + durationText(cost.seconds) +
               ", and After Effects keeps about " + (gb < 0.95 ? Math.round(gb * 1024) + " MB" : (Math.round(gb * 10) / 10) + " GB") +
               " of memory for it until the project is saved and reopened";
    }

    var MARKER_CHANGES = { root: null, n: 0 };

    function sameProjectAsCount() {
        try { return MARKER_CHANGES.root !== null && MARKER_CHANGES.root.numItems >= 0; } catch (_) { return false; }
    }

    function catchUpSeconds(changes) { return 46e-6 * changes * changes; }

    function noteMarkerChanges(n, removal) {
        if (!sameProjectAsCount()) MARKER_CHANGES = { root: app.project.rootFolder, n: 0 };
        MARKER_CHANGES.n += removal ? 0.7 * n : n;
    }

    function pendingMarkerChanges() { return sameProjectAsCount() ? MARKER_CHANGES.n : 0; }

    function clearMarkerChanges() { MARKER_CHANGES.n = 0; }

    function countOurMarkers(markerProp) {
        var n = 0, i, mv;
        if (!markerProp) return 0;
        for (i = 1; i <= markerProp.numKeys; i++) {
            try {
                mv = markerProp.keyValue(i);
                if (mv.comment && String(mv.comment).substring(0, PREFIX.length) === PREFIX) n++;
            } catch (_) {}
        }
        return n;
    }

    function removeOurMarkers(markerProp) {
        var removed = 0, i, mv, comment;
        if (!markerProp) return 0;
        for (i = markerProp.numKeys; i >= 1; i--) {
            try {
                mv = markerProp.keyValue(i);
                comment = mv.comment ? String(mv.comment) : "";
                if (comment.substring(0, PREFIX.length) === PREFIX) {
                    markerProp.removeKey(i);
                    removed++;
                }
            } catch (_) {}
        }
        return removed;
    }

    /* ------------------------------------------------------------------ */
    /*  Long series                                                        */
    /* ------------------------------------------------------------------ */

    function series(n, fill) {
        var b = [], i, k, blk;
        for (i = 0; i < n; i += 256) {
            blk = [];
            for (k = 0; k < 256 && i + k < n; k++) blk[k] = fill;
            b.push(blk);
        }
        return { b: b, n: n };
    }

    function seriesFrom(values) {
        var s = series(values.length, 0), i;
        for (i = 0; i < values.length; i++) s.b[i >> 8][i & 255] = values[i];
        return s;
    }

    function at(x, i) { return x.b[i >> 8][i & 255]; }

    function seriesMax(x) {
        var m = 0, b = x.b, k, j, blk;
        for (k = 0; k < b.length; k++) {
            blk = b[k];
            for (j = 0; j < blk.length; j++) if (blk[j] > m) m = blk[j];
        }
        return m;
    }

    function seriesMean(x) {
        var s = 0, b = x.b, k, j, blk;
        if (!x.n) return 0;
        for (k = 0; k < b.length; k++) {
            blk = b[k];
            for (j = 0; j < blk.length; j++) s += blk[j];
        }
        return s / x.n;
    }

    function spread(x) {
        var mu = seriesMean(x), s = 0, b = x.b, k, j, blk, d;
        for (k = 0; k < b.length; k++) {
            blk = b[k];
            for (j = 0; j < blk.length; j++) { d = blk[j] - mu; s += d * d; }
        }
        return Math.sqrt(s / Math.max(1, x.n)) || 1;
    }

    /* ------------------------------------------------------------------ */
    /*  Signal processing                                                  */
    /* ------------------------------------------------------------------ */

    function prepareEnvelope(x, dt) {
        var n = x.n, peak = seriesMax(x), env = series(n, 0), xb = x.b, eb = env.b;
        var GAMMA = 24, scale, k, j, blk, oblk, sm, sb, i, prev, cur, next;

        if (peak <= 0) {
            throw new Error("The music is silent in this time range.\n\n" +
                "Check that the layer is not muted and that Advanced settings > Time range " +
                "covers the music.");
        }
        scale = 1 / Math.log(1 + GAMMA);
        for (k = 0; k < xb.length; k++) {
            blk = xb[k];
            oblk = eb[k];
            for (j = 0; j < blk.length; j++) oblk[j] = Math.log(1 + GAMMA * (blk[j] / peak)) * scale;
        }

        if (dt < 0.02 && n >= 3) {
            sm = series(n, 0);
            sb = sm.b;
            prev = eb[0][0];
            cur = eb[0][1 & 255];
            sb[0][0] = prev;
            for (i = 1; i < n - 1; i++) {
                next = eb[(i + 1) >> 8][(i + 1) & 255];
                sb[i >> 8][i & 255] = (prev + 2 * cur + next) / 4;
                prev = cur;
                cur = next;
            }
            sb[(n - 1) >> 8][(n - 1) & 255] = cur;
            env = sm;
        }
        return env;
    }

    function onsetStrength(env) {
        var n = env.n, o = series(n, 0), eb = env.b, ob = o.b, i, prev, cur, d;
        if (n === 0) return o;
        prev = eb[0][0];
        for (i = 1; i < n; i++) {
            cur = eb[i >> 8][i & 255];
            d = cur - prev;
            ob[i >> 8][i & 255] = d > 0 ? d : 0;
            prev = cur;
        }
        return o;
    }

    function movingMean(x, halfWidth) {
        var n = x.n, xb = x.b, out = series(n, 0), ob = out.b, sum = 0, lo = 0, hi = -1, i, a, b;
        for (i = 0; i < n; i++) {
            b = i + halfWidth; if (b > n - 1) b = n - 1;
            while (hi < b) { hi++; sum += xb[hi >> 8][hi & 255]; }
            a = i - halfWidth; if (a < 0) a = 0;
            while (lo < a) { sum -= xb[lo >> 8][lo & 255]; lo++; }
            ob[i >> 8][i & 255] = sum / (hi - lo + 1);
        }
        return out;
    }

    function refineOnsetIndex(env, peakIndex, maxBack, maxFwd) {
        var n = env.n, foot = peakIndex, crest = peakIndex, j, k;
        var target, y0, y1, frac;

        j = peakIndex;
        while (j > 0 && (peakIndex - j) < maxBack && at(env, j - 1) < at(env, j)) j--;
        foot = j;

        j = peakIndex;
        while (j < n - 1 && (j - peakIndex) < maxFwd && at(env, j + 1) > at(env, j)) j++;
        crest = j;

        if (crest <= foot || at(env, crest) <= at(env, foot)) return peakIndex;

        target = at(env, foot) + 0.5 * (at(env, crest) - at(env, foot));
        for (k = foot + 1; k <= crest; k++) {
            if (at(env, k) >= target) {
                y0 = at(env, k - 1);
                y1 = at(env, k);
                frac = (y1 === y0) ? 0 : (target - y0) / (y1 - y0);
                return (k - 1) + clamp(frac, 0, 1);
            }
        }
        return crest;
    }

    var ONSET_LEAD = 0.37;

    function detectOnsets(env, tl, sensitivity, minDistSec) {
        var n = env.n, dt = tl.dt;
        var o = onsetStrength(env), ob = o.b;
        var contextW = Math.max(2, Math.round(0.35 / dt));
        var localW   = Math.max(1, Math.round(0.030 / dt));
        var maxBack  = Math.max(2, Math.round(0.040 / dt));
        var maxFwd   = Math.max(2, Math.round(0.060 / dt));
        var mb = movingMean(o, contextW).b;
        var globalMean = seriesMean(o);
        var lambda = 2.60 - 1.75 * sensitivity;
        var delta  = globalMean * (0.40 - 0.36 * sensitivity);
        var peaks = [], i, j, lo, hi, isMax, thr, oi, fracIndex, t, cand, last;

        for (i = 1; i < n - 1; i++) {
            oi = ob[i >> 8][i & 255];
            if (oi <= 0) continue;
            thr = mb[i >> 8][i & 255] * lambda + delta;
            if (oi < thr) continue;

            isMax = true;
            lo = i - localW; if (lo < 0) lo = 0;
            hi = i + localW; if (hi > n - 1) hi = n - 1;
            for (j = lo; j <= hi; j++) {
                if (ob[j >> 8][j & 255] > oi) { isMax = false; break; }
            }
            if (!isMax) continue;

            fracIndex = refineOnsetIndex(env, i, maxBack, maxFwd);
            t = tl.t0 + (fracIndex + ONSET_LEAD) * dt;
            cand = { time: t, strength: oi };

            if (peaks.length === 0) {
                peaks.push(cand);
            } else {
                last = peaks[peaks.length - 1];
                if ((cand.time - last.time) >= minDistSec) {
                    peaks.push(cand);
                } else if (cand.strength > last.strength) {
                    peaks[peaks.length - 1] = cand;
                }
            }
        }
        return { peaks: peaks, onset: o, globalMean: globalMean };
    }

    function nearestPeakIndex(peaks, t, tol) {
        var lo = 0, hi = peaks.length - 1, mid, i, e;
        var best = -1, bestErr = tol;
        if (peaks.length === 0) return -1;
        while (lo <= hi) {
            mid = Math.floor((lo + hi) / 2);
            if (peaks[mid].time < t) lo = mid + 1; else hi = mid - 1;
        }
        for (i = lo - 2; i <= lo + 2; i++) {
            if (i < 0 || i >= peaks.length) continue;
            e = Math.abs(peaks[i].time - t);
            if (e <= bestErr) { bestErr = e; best = i; }
        }
        return best;
    }

    function gateByStrength(peaks, fraction) {
        var strengths = [], i, floor, out = [];
        if (fraction <= 0 || peaks.length === 0) return peaks;
        for (i = 0; i < peaks.length; i++) strengths.push(peaks[i].strength);
        floor = percentile(strengths.sort(numericSort), 0.9) * fraction;
        for (i = 0; i < peaks.length; i++) {
            if (peaks[i].strength >= floor) out.push(peaks[i]);
        }
        return out;
    }

    function limitToStrongest(peaks, maxCount) {
        var ranked, threshold, kept = [], i;
        if (!maxCount || peaks.length <= maxCount) return peaks;
        ranked = peaks.slice(0).sort(function (a, b) { return b.strength - a.strength; });
        threshold = ranked[maxCount - 1].strength;
        for (i = 0; i < peaks.length && kept.length < maxCount; i++) {
            if (peaks[i].strength >= threshold) kept.push(peaks[i]);
        }
        return kept;
    }

    function keepInside(peaks, a, b) {
        var out = [], i;
        for (i = 0; i < peaks.length; i++) {
            if (peaks[i].time >= a && peaks[i].time <= b) out.push(peaks[i]);
        }
        return out;
    }

    function applyOffset(peaks, seconds) {
        var out = [], i;
        if (!seconds) return peaks;
        for (i = 0; i < peaks.length; i++) {
            out.push({ time: peaks[i].time + seconds, strength: peaks[i].strength });
        }
        return out;
    }

    function snapAndDedupe(peaks, frameDuration, doSnap) {
        var out = [], i, t, prevKey = null, key;
        for (i = 0; i < peaks.length; i++) {
            t = peaks[i].time;
            if (doSnap && frameDuration > 0) {
                t = Math.round(t / frameDuration) * frameDuration;
                key = Math.round(t / frameDuration);
                if (prevKey !== null && key === prevKey) continue;
                prevKey = key;
            }
            if (t < 0) continue;
            out.push({ time: t, strength: peaks[i].strength });
        }
        return out;
    }

    /* ------------------------------------------------------------------ */
    /*  Tempo and bands                                                    */
    /* ------------------------------------------------------------------ */

    function smooth3(x) {
        var n = x.n, out = series(n, 0), xb = x.b, ob = out.b, i, prev, cur, next;
        if (n < 3) {
            for (i = 0; i < n; i++) ob[0][i] = xb[0][i];
            return out;
        }
        prev = xb[0][0];
        cur = xb[0][1];
        ob[0][0] = prev;
        for (i = 1; i < n - 1; i++) {
            next = xb[(i + 1) >> 8][(i + 1) & 255];
            ob[i >> 8][i & 255] = 0.25 * prev + 0.5 * cur + 0.25 * next;
            prev = cur;
            cur = next;
        }
        ob[(n - 1) >> 8][(n - 1) & 255] = cur;
        return out;
    }

    function combineBands(a, b) {
        var out = series(a.n, 0), ab = a.b, bb = b.b, ob = out.b, k, j, x, y;
        for (k = 0; k < ob.length; k++) {
            for (j = 0; j < ob[k].length; j++) {
                x = ab[k][j];
                y = bb[k][j];
                ob[k][j] = Math.sqrt(x * x + y * y);
            }
        }
        return out;
    }

    function tempoWindows(n, dt, from) {
        var len = Math.round(30 / dt), out = [], k, s, o = from || 0;
        if (n * dt <= 150 || len >= n) return [[o, o + n]];
        for (k = 0; k < 4; k++) {
            s = clamp(Math.round(n * (0.125 + 0.25 * k) - len / 2), 0, n - len);
            out.push([o + s, o + s + len]);
        }
        return out;
    }

    function onsetAutocorrelation(onset, dt, minBPM, windows) {
        var dec = Math.max(1, Math.round(0.018 / dt)), ddt = dt * dec;
        var maxLag = Math.ceil(4 * 60 / minBPM / ddt) + 2, sums = [], counts = [], ac = [];
        var w, s, e, m, x, xb, i, j, v, mu, lag, top, acc, ob = onset.b;
        for (lag = 0; lag <= maxLag; lag++) { sums[lag] = 0; counts[lag] = 0; }
        for (w = 0; w < windows.length; w++) {
            s = windows[w][0];
            e = windows[w][1];
            m = Math.floor((e - s) / dec);
            if (m < 16) continue;
            x = series(m, 0);
            xb = x.b;
            mu = 0;
            for (i = 0; i < m; i++) {
                v = 0;
                for (j = s + i * dec; j < s + (i + 1) * dec; j++) {
                    if (ob[j >> 8][j & 255] > v) v = ob[j >> 8][j & 255];
                }
                xb[i >> 8][i & 255] = v;
                mu += v;
            }
            mu /= m;
            for (i = 0; i < m; i++) xb[i >> 8][i & 255] -= mu;
            top = Math.min(maxLag, m - 2);
            for (lag = 0; lag <= top; lag++) {
                acc = 0;
                for (i = 0; i + lag < m; i++) acc += xb[i >> 8][i & 255] * xb[(i + lag) >> 8][(i + lag) & 255];
                sums[lag] += acc;
                counts[lag] += m - lag;
            }
        }
        for (lag = 0; lag <= maxLag; lag++) {
            if (!counts[lag]) break;
            ac.push(sums[lag] / counts[lag]);
        }
        if (ac.length && ac[0] > 0) {
            for (lag = ac.length - 1; lag >= 0; lag--) ac[lag] = ac[lag] / ac[0];
        }
        return { ac: ac, ddt: ddt };
    }

    function acAt(ac, lag) {
        var i = Math.floor(lag);
        if (i < 0 || i + 1 >= ac.length) return -1;
        return ac[i] + (lag - i) * (ac[i + 1] - ac[i]);
    }

    function onBeatStrength(onset, dt, bpm, windows) {
        var period = 60 / bpm / dt, n = onset.n, ob = onset.b, avg = seriesMean(onset);
        var stretch = Math.max(Math.round(8 / dt), Math.ceil(4 * period));
        var w, start, end, stop, best, ph, p, k, v, u, s, c, total = 0, weight = 0;
        if (avg <= 0 || period < 2) return 0;
        for (w = 0; w < windows.length; w++) {
            stop = Math.min(n - 1, windows[w][1]);
            for (start = windows[w][0]; start < stop; start += stretch) {
                end = Math.min(stop, start + stretch);
                if (end - start < 2 * period) break;
                best = 0;
                for (ph = 0; ph < period; ph += 0.25) {
                    s = 0; c = 0;
                    for (p = start + ph; p < end; p += period) {
                        k = Math.floor(p);
                        v = ob[k >> 8][k & 255];
                        if (k > 0) { u = ob[(k - 1) >> 8][(k - 1) & 255]; if (u > v) v = u; }
                        u = ob[(k + 1) >> 8][(k + 1) & 255]; if (u > v) v = u;
                        s += v; c++;
                    }
                    if (c && s / c > best) best = s / c;
                }
                total += best * (end - start);
                weight += end - start;
            }
        }
        return weight ? total / weight / avg : 0;
    }

    var NEIGHBOUR_DRUMS_TIE = 0.95;

    function estimateTempoComb(onset, check, hats, peaks, dt, minBPM, maxBPM, windows) {
        var a = onsetAutocorrelation(onset, dt, minBPM, windows), bpm, L, v, prior, best = -1e30, bestBpm = 0;
        var ratios = [1, 2 / 3, 3 / 2, 3 / 4, 4 / 3], k, c, r, base = null, pick = null, sc, sh;
        var strong = limitToStrongest(peaks, REFINE_PEAKS);
        if (!check) check = onset;
        for (bpm = minBPM; bpm <= maxBPM + 1e-9; bpm += 0.25) {
            L = 60 / bpm / a.ddt;
            v = acAt(a.ac, L) + 0.5 * acAt(a.ac, 2 * L) + 0.25 * acAt(a.ac, 4 * L) + 0.35 * acAt(a.ac, L / 2);
            prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / 120) / Math.LN2, 2));
            v = v * (0.5 + 0.5 * prior);
            if (v > best) { best = v; bestBpm = bpm; }
        }
        if (!bestBpm || best <= 0) return { bpm: 0, period: 0, confidence: 0 };

        for (k = 0; k < ratios.length; k++) {
            c = bestBpm * ratios[k];
            if (c < minBPM || c > maxBPM) continue;
            r = refineTempo(strong, c);
            sc = onBeatStrength(check, dt, r.bpm, windows);
            sh = hats ? onBeatStrength(hats, dt, r.bpm, windows) : 0;
            if (k === 0) {
                base = { bpm: r.bpm, c: r.coherence, sc: sc, sh: sh };
                pick = base;
                continue;
            }
            if (r.coherence >= 2 * base.c && sc >= NEIGHBOUR_DRUMS_TIE * base.sc && sh >= 0.8 * base.sh &&
                (pick === base || sc + sh > pick.sc + pick.sh)) {
                pick = { bpm: r.bpm, c: r.coherence, sc: sc, sh: sh };
            }
        }
        bpm = chooseOctave(onset, dt, pick.bpm, minBPM, maxBPM, windows);
        return {
            bpm: Math.round(bpm * 10) / 10,
            period: 60 / bpm,
            confidence: clamp(best, 0, 1)
        };
    }

    var REFINE_PEAKS = 200;

    function refineTempo(strong, bpm) {
        var P0 = 60 / bpm, best = -1, bestP = P0, lo, hi, step, P, pass, v, sw = 0, i, norm;
        for (i = 0; i < strong.length; i++) sw += strong[i].strength;
        if (strong.length < 8 || sw <= 0) return { bpm: bpm, coherence: 0 };
        norm = 1 / (sw * sw);
        lo = P0 * 0.975; hi = P0 * 1.025; step = P0 * 0.00025;
        for (pass = 0; pass < 2; pass++) {
            for (P = lo; P <= hi + 1e-12; P += step) {
                v = phaseCoherence(strong, P);
                if (v > best) { best = v; bestP = P; }
            }
            lo = bestP - step; hi = bestP + step; step = step / 20;
        }
        if (best * norm < 0.1) return { bpm: bpm, coherence: phaseCoherence(strong, P0) * norm };
        return { bpm: 60 / bestP, coherence: best * norm };
    }

    function phaseCoherence(peaks, period) {
        var x1 = 0, y1 = 0, x2 = 0, y2 = 0, x4 = 0, y4 = 0, i, a, w, c1, s1, c2, s2;
        var k = 2 * Math.PI / period;
        for (i = 0; i < peaks.length; i++) {
            a = k * peaks[i].time;
            w = peaks[i].strength;
            c1 = Math.cos(a); s1 = Math.sin(a);
            c2 = c1 * c1 - s1 * s1; s2 = 2 * s1 * c1;
            x1 += w * c1; y1 += w * s1;
            x2 += w * c2; y2 += w * s2;
            x4 += w * (c2 * c2 - s2 * s2); y4 += w * 2 * s2 * c2;
        }
        return x1 * x1 + y1 * y1 + x2 * x2 + y2 * y2 + x4 * x4 + y4 * y4;
    }

    var OCTAVE_SIGMA = 0.6;

    function octaveScore(onset, dt, bpm, windows) {
        return onBeatStrength(onset, dt, bpm, windows) *
               Math.exp(-0.5 * Math.pow(Math.log(bpm / 120) / Math.LN2 / OCTAVE_SIGMA, 2));
    }

    function chooseOctave(onset, dt, bpm, minBPM, maxBPM, windows) {
        var cands = [bpm / 4, bpm / 2, bpm, bpm * 2, bpm * 4], k, c, v, best = -1, choice = bpm;
        for (k = 0; k < cands.length; k++) {
            c = cands[k];
            if (c < minBPM - 1e-9 || c > maxBPM + 1e-9) continue;
            v = octaveScore(onset, dt, c, windows);
            if (v > best) { best = v; choice = c; }
        }
        return choice;
    }

    var OCTAVE_HINT_SHARE = 0.75;

    function octaveAlternative(onset, dt, bpm, windows) {
        var best = octaveScore(onset, dt, bpm, windows), cands = [bpm / 2, bpm * 2], k, v, out = { bpm: 0, share: 0 };
        if (!(best > 0)) return out;
        for (k = 0; k < cands.length; k++) {
            if (cands[k] < 40 || cands[k] > 260) continue;
            v = octaveScore(onset, dt, cands[k], windows) / best;
            if (v > out.share) out = { bpm: Math.round(cands[k] * 10) / 10, share: v };
        }
        return out;
    }

    var BEAT_TIGHTNESS = 200;

    function trackBeats(onset, dt, period) {
        var n = onset.n, tau = period / dt, lo, hi, pen = [], d, t, k, ib = onset.b;
        var o = series(n, 0), score = series(n, 0), back = series(n, -1);
        var obb = o.b, sb = score.b, bb = back.b, sd = spread(onset), best, bi, v, u, beats = [];
        if (n < 4 || tau < 2) return [];

        for (t = 0; t < n; t++) {
            v = ib[t >> 8][t & 255];
            if (t > 0) { u = 0.6 * ib[(t - 1) >> 8][(t - 1) & 255]; if (u > v) v = u; }
            if (t + 1 < n) { u = 0.6 * ib[(t + 1) >> 8][(t + 1) & 255]; if (u > v) v = u; }
            obb[t >> 8][t & 255] = v / sd;
        }
        lo = Math.max(1, Math.round(0.7 * tau));
        hi = Math.max(lo, Math.round(1.4 * tau));
        for (d = lo; d <= hi; d++) pen[d] = -BEAT_TIGHTNESS * Math.pow(Math.log(d / tau), 2);
        for (t = 0; t < n; t++) {
            best = 0; bi = -1;
            for (d = lo; d <= hi && d <= t; d++) {
                k = t - d;
                v = sb[k >> 8][k & 255] + pen[d];
                if (bi < 0 || v > best) { best = v; bi = k; }
            }
            if (bi < 0 || best < 0) { best = 0; bi = -1; }
            sb[t >> 8][t & 255] = obb[t >> 8][t & 255] + best;
            bb[t >> 8][t & 255] = bi;
        }
        best = -1e30; bi = n - 1;
        for (t = Math.max(0, n - Math.round(tau)); t < n; t++) {
            if (sb[t >> 8][t & 255] > best) { best = sb[t >> 8][t & 255]; bi = t; }
        }
        for (k = bi; k >= 0; k = bb[k >> 8][k & 255]) beats.push(k);
        beats.reverse();
        return beats;
    }

    var SECTION_SECONDS = 20;
    var SECTION_COH_DROP = 0.25;
    var SECTION_MIN_COH = 0.3;

    function sliceSeries(x, from, to) {
        var out = series(to - from, 0), ob = out.b, xb = x.b, i, k;
        for (i = from; i < to; i++) {
            k = i - from;
            ob[k >> 8][k & 255] = xb[i >> 8][i & 255];
        }
        return out;
    }

    function sameTempoFamily(a, b) {
        var r = Math.log(a / b) / Math.LN2;
        return Math.abs(r - Math.round(r)) < 0.04;
    }

    function coherenceAt(peaks, bpm) {
        var strong = limitToStrongest(peaks, REFINE_PEAKS), sw = 0, i;
        for (i = 0; i < strong.length; i++) sw += strong[i].strength;
        return (strong.length < 8 || sw <= 0) ? 0 : phaseCoherence(strong, 60 / bpm) / (sw * sw);
    }

    function tempoSections(frames, det, check, hats, beatOn, tl, globalBpm, factor) {
        var dt = tl.dt, n = tl.n, win = Math.round(SECTION_SECONDS / dt), nw = Math.ceil(n / win);
        var stats = [], bads = 0, local = [], groups = [], sections = [], w, i, s, e, g, last, bpm;
        var tempo, peaks, rf, kept, tol, ref = check || det.onset, cohs = [], fit, parts = [];
        if (n * dt <= 150) return { frames: frames, sections: sections };
        tol = clamp(60 / globalBpm / 12, 0.035, BEAT_SNAP_MAX);
        for (w = 0; w < nw; w++) stats[w] = { beats: 0, snapped: 0, hits: 0, coh: 0 };
        for (i = 0; i < frames.length; i++) {
            w = Math.min(nw - 1, Math.floor(frames[i] / win));
            stats[w].beats++;
            if (nearestPeakIndex(det.peaks, tl.t0 + frames[i] * dt, tol) >= 0) stats[w].snapped++;
        }
        for (i = 0; i < det.peaks.length; i++) stats[Math.min(nw - 1, Math.floor(frameOf(tl, det.peaks[i].time) / win))].hits++;
        for (w = 0; w < nw; w++) {
            if (stats[w].hits < 10) continue;
            stats[w].coh = coherenceAt(keepInside(det.peaks, tl.t0 + w * win * dt, tl.t0 + Math.min(n, (w + 1) * win) * dt), globalBpm);
            cohs.push(stats[w].coh);
        }
        cohs.sort(numericSort);
        fit = cohs.length ? percentile(cohs, 0.9) : 0;
        for (w = 0; w < nw; w++) {
            if (stats[w].beats >= 4 && stats[w].hits >= 10 &&
                (stats[w].snapped < 0.6 * stats[w].beats || stats[w].coh < SECTION_COH_DROP * fit)) bads++;
        }
        if (bads < 2) return { frames: frames, sections: sections };

        for (w = 0; w < nw; w++) {
            s = w * win;
            e = Math.min(n, s + win);
            local[w] = 0;
            if (stats[w].hits < 10 || e - s < win / 2) continue;
            peaks = keepInside(det.peaks, tl.t0 + s * dt, tl.t0 + e * dt);
            local[w] = estimateTempoComb(det.onset, check, hats, peaks, dt, 60, 200, [[s, e]]).bpm || 0;
        }
        for (w = 0; w < nw; w++) {
            last = groups.length ? groups[groups.length - 1] : null;
            if (last && (!local[w] || !last.bpm || sameTempoFamily(local[w], last.bpm))) {
                last.w1 = w + 1;
                if (!last.bpm) last.bpm = local[w];
            } else {
                groups.push({ w0: w, w1: w + 1, bpm: local[w] });
            }
        }

        function fitsBetter(w0, w1, bpm) {
            var a = w0 * win, z = Math.min(n, w1 * win), pk = keepInside(det.peaks, tl.t0 + a * dt, tl.t0 + z * dt);
            var own = coherenceAt(pk, bpm), c = coherenceAt(pk, globalBpm), d = onBeatStrength(ref, dt, globalBpm, [[a, z]]);
            c = c > 0 ? own / c : 1e9;
            d = d > 0 ? onBeatStrength(ref, dt, bpm, [[a, z]]) / d : 0;
            return (c >= 1.5 && d >= 1.1) || (w1 - w0 >= 2 && c >= 3 && own >= SECTION_MIN_COH);
        }
        function taken(w) {
            for (var k = 0; k < parts.length; k++) if (w >= parts[k].w0 && w < parts[k].w1) return true;
            return false;
        }

        for (g = 0; g < groups.length; g++) {
            bpm = groups[g].bpm;
            if (!bpm || sameTempoFamily(bpm, globalBpm)) continue;
            s = groups[g].w0 * win;
            e = Math.min(n, groups[g].w1 * win);
            peaks = keepInside(det.peaks, tl.t0 + s * dt, tl.t0 + e * dt);
            tempo = estimateTempoComb(det.onset, check, hats, peaks, dt, 60, 200, tempoWindows(e - s, dt, s));
            if (!(tempo.period > 0) || sameTempoFamily(tempo.bpm, globalBpm)) continue;
            if (!fitsBetter(groups[g].w0, groups[g].w1, tempo.bpm)) continue;
            parts.push({ w0: groups[g].w0, w1: groups[g].w1, bpm: tempo.bpm });
        }

        for (g = 0; g < parts.length; g++) {
            while (parts[g].w0 > 0 && !taken(parts[g].w0 - 1) && stats[parts[g].w0 - 1].hits >= 10 &&
                   fitsBetter(parts[g].w0 - 1, parts[g].w0, parts[g].bpm)) parts[g].w0--;
            while (parts[g].w1 < nw && !taken(parts[g].w1) && stats[parts[g].w1].hits >= 10 &&
                   fitsBetter(parts[g].w1, parts[g].w1 + 1, parts[g].bpm)) parts[g].w1++;
        }

        for (g = 0; g < parts.length; g++) {
            s = parts[g].w0 * win;
            e = Math.min(n, parts[g].w1 * win);
            rf = trackBeats(sliceSeries(beatOn, s, e), dt, 60 / (parts[g].bpm * factor));
            kept = [];
            for (i = 0; i < frames.length; i++) if (frames[i] < s || frames[i] >= e) kept.push(frames[i]);
            for (i = 0; i < rf.length; i++) kept.push(rf[i] + s);
            kept.sort(numericSort);
            frames = kept;
            sections.push({ start: tl.t0 + s * dt, end: tl.t0 + e * dt, bpm: Math.round(parts[g].bpm * factor * 10) / 10 });
        }
        sections.sort(function (x, y) { return x.start - y.start; });
        return { frames: frames, sections: sections };
    }

    function beatOnset(full, mid) {
        var out = series(full.n, 0), fb = full.b, mb = mid ? mid.b : null, ob = out.b;
        var a = 1 / spread(full), b = mid ? 1 / spread(mid) : 0, k, j;
        for (k = 0; k < ob.length; k++) {
            for (j = 0; j < ob[k].length; j++) ob[k][j] = fb[k][j] * a + (mb ? mb[k][j] * b : 0);
        }
        return out;
    }

    var BEAT_SNAP_MAX = 0.05;

    function beatGrid(frames, peaks, tl, period, level, strengthFloor, quietLevel) {
        var n = frames.length, t = [], s = [], snapped = [], i, j, a, b, idx, lead = [], off, ft;
        var tol = clamp(period / 12, 0.035, BEAT_SNAP_MAX), sample = [], loud, out = [], strengths = [];
        var typical, step, half = Math.max(1, Math.round(period / tl.dt / 4));
        for (i = 0; i < n; i++) {
            ft = tl.t0 + frames[i] * tl.dt;
            idx = nearestPeakIndex(peaks, ft, tol);
            snapped[i] = idx >= 0;
            if (idx >= 0) {
                t[i] = peaks[idx].time;
                s[i] = peaks[idx].strength;
                lead.push(t[i] - ft);
                strengths.push(s[i]);
            } else {
                s[i] = 0;
            }
        }
        off = lead.length ? median(lead) : 0;
        for (i = 0; i < n; i++) if (!snapped[i]) t[i] = tl.t0 + frames[i] * tl.dt + off;
        for (i = 0; i < n; i = j) {
            j = i + 1;
            if (snapped[i]) continue;
            while (j < n && !snapped[j]) j++;
            a = i - 1; b = j;
            if (a >= 0 && b < n) {
                for (idx = i; idx < j; idx++) t[idx] = t[a] + (idx - a) / (b - a) * (t[b] - t[a]);
            }
        }

        step = Math.max(1, Math.floor(level.n / 2000));
        for (i = 0; i < level.n; i += step) sample.push(at(level, i));
        sample.sort(numericSort);
        loud = percentile(sample, 0.95) * (quietLevel || 0.0316);
        typical = strengths.length ? median(strengths) : 0;
        for (i = 0; i < n; i++) {
            if (localMax(level, frames[i], half) < loud) continue;
            if (strengthFloor > 0 && s[i] < strengthFloor * typical) continue;
            out.push({ time: t[i], strength: s[i] > 0 ? s[i] : 1e-6 });
        }
        return out;
    }

    function localMax(x, i, half) {
        var m = 0, k, v, lo = Math.max(0, i - half), hi = Math.min(x.n - 1, i + half), xb = x.b;
        for (k = lo; k <= hi; k++) { v = xb[k >> 8][k & 255]; if (v > m) m = v; }
        return m;
    }

    function attackAt(x, i) {
        var n = x.n, pre = 0, post, c = 0, k, v;
        if (i <= 0 || i >= n) return 0;
        for (k = Math.max(0, i - 3); k < i; k++) { v = at(x, k); pre += v * v; c++; }
        pre = c ? pre / c : 0;
        v = at(x, i);
        post = v * v;
        if (i + 1 < n) { v = at(x, i + 1); post = 0.5 * (post + v * v); }
        return Math.max(0, post - pre);
    }

    function frameOf(tl, t) {
        return clamp(Math.ceil((t - tl.t0) / tl.dt - 1e-9), 0, tl.n - 1);
    }

    var BAND_SHARE = 0.3;

    function keepDominant(peaks, tl, bands, own, candidateTimes) {
        var scales = [], b, i, j, vals, rise, best, kept = [], idx, row;
        for (b = 0; b < bands.length; b++) {
            vals = [];
            for (j = 0; j < candidateTimes.length; j++) {
                rise = attackAt(bands[b], frameOf(tl, candidateTimes[j]));
                if (rise > 0) vals.push(rise);
            }
            scales[b] = vals.length ? percentile(vals.sort(numericSort), 0.95) : 1;
            if (!(scales[b] > 0)) scales[b] = 1;
        }
        for (i = 0; i < peaks.length; i++) {
            idx = frameOf(tl, peaks[i].time);
            best = 0;
            row = [];
            for (b = 0; b < bands.length; b++) {
                row[b] = Math.max(attackAt(bands[b], idx), attackAt(bands[b], idx + 1)) / scales[b];
                if (row[b] > best) best = row[b];
            }
            if (row[own] >= BAND_SHARE * best && row[own] >= 0.04) kept.push(peaks[i]);
        }
        return kept;
    }

    /* ------------------------------------------------------------------ */
    /*  One analysis, from envelopes to markers                            */
    /* ------------------------------------------------------------------ */

    function drumBandHits(b, lowSmooth, minGap) {
        var out = [], bands = [lowSmooth, b.mid, b.high], k, i, det;
        for (k = 0; k < bands.length; k++) {
            det = detectOnsets(prepareEnvelope(bands[k], b.tl.dt), b.tl, 0.5, minGap);
            for (i = 0; i < det.peaks.length; i++) out.push(det.peaks[i].time);
        }
        return out;
    }

    function analyzeEnvelopes(b, cfg) {
        var tl = b.tl, dt = tl.dt, mode = cfg.mode, split = !!(b.low && b.mid && b.high);
        var det, peaks, tempo = { bpm: 0, period: 0 }, check = null, hats = null, mid = null;
        var band, f, detected, beatOn, frames, sec;

        if (mode.grid) {
            det = detectOnsets(prepareEnvelope(b.full, dt), tl, 0.5, cfg.minGap);
            if (split) {
                check = onsetStrength(prepareEnvelope(combineBands(b.low, b.mid), dt));
                hats = onsetStrength(prepareEnvelope(b.high, dt));
                mid = onsetStrength(prepareEnvelope(b.mid, dt));
            }
            if (cfg.tempoMode === 3) {
                tempo = { bpm: cfg.tempoBpm, period: 60 / cfg.tempoBpm, detected: 0 };
            } else {
                tempo = estimateTempoComb(det.onset, check, hats, det.peaks, dt, 60, 200,
                                          tempoWindows(tl.n, dt));
                if (!(tempo.period > 0)) {
                    throw new Error("No steady beat was found in this music.\n\n" +
                        "Try 'Every hit' or 'Kick & bass hits' instead, or type the tempo " +
                        "under Tempo > Exact BPM.");
                }
                detected = tempo.bpm;
                if (cfg.tempoMode === 1 || cfg.tempoMode === 2) {
                    f = cfg.tempoMode === 1 ? 0.5 : 2;
                    tempo = { bpm: Math.round(detected * f * 10) / 10, period: tempo.period / f };
                }
                tempo.detected = detected;
                tempo.alternative = octaveAlternative(det.onset, dt, detected, tempoWindows(tl.n, dt));
            }
            beatOn = beatOnset(det.onset, mid);
            frames = trackBeats(beatOn, dt, tempo.period);
            if (cfg.tempoMode !== 3) {
                f = cfg.tempoMode === 1 ? 0.5 : (cfg.tempoMode === 2 ? 2 : 1);
                sec = tempoSections(frames, det, check, hats, beatOn, tl, tempo.detected, f);
                frames = sec.frames;
                tempo.sections = sec.sections;
            }
            peaks = beatGrid(frames, det.peaks, tl, tempo.period, b.full, cfg.beatFloor, cfg.quietLevel);
            return { peaks: peaks, tempo: tempo, band: 0 };
        }

        band = split ? mode.focus : 0;
        if (band > 0) return { peaks: bandPeaks(b, band, cfg), tempo: tempo, band: band };
        peaks = normalised(levelFloor(fullPeaks(b, cfg), tl, b.full, cfg.hitQuietLevel));
        if (split) {

            peaks = mergeHits([peaks, normalised(bandPeaks(b, 1, cfg)), normalised(bandPeaks(b, 2, cfg))],
                              cfg.minGap);
        }
        return { peaks: peaks, tempo: tempo, band: 0 };
    }

    function fullPeaks(b, cfg) {
        var det = detectOnsets(prepareEnvelope(b.full, b.tl.dt), b.tl, cfg.sensitivity, cfg.minGap);
        return gateByStrength(det.peaks, cfg.gate);
    }

    var HAT_SENSITIVITY_LIFT = 0.3;
    var HAT_GATE_SCALE = 0.57;

    function bandPeaks(b, band, cfg) {
        var tl = b.tl, values, sens = cfg.sensitivity, gate = cfg.gate, det, peaks, lowSmooth;
        if (band === 1) {

            lowSmooth = smooth3(b.low);
            values = lowSmooth;
        } else if (band === 2) {
            values = b.mid;
        } else {
            values = b.high;
            sens = Math.min(1, sens + HAT_SENSITIVITY_LIFT);
            gate = gate * HAT_GATE_SCALE;
        }
        det = detectOnsets(prepareEnvelope(values, tl.dt), tl, sens, cfg.minGap);
        peaks = levelFloor(gateByStrength(det.peaks, gate), tl, values, cfg.hitQuietLevel);
        if (band === 1) {
            peaks = keepDominant(peaks, tl, [lowSmooth, b.mid, b.high], 0,
                                 drumBandHits(b, lowSmooth, cfg.minGap));
        }
        return peaks;
    }

    function levelFloor(peaks, tl, values, ratio) {
        var sample = [], i, step, loud, out = [], half;
        if (!ratio || peaks.length === 0) return peaks;
        step = Math.max(1, Math.floor(values.n / 2000));
        for (i = 0; i < values.n; i += step) sample.push(at(values, i));
        sample.sort(numericSort);
        loud = percentile(sample, 0.95) * ratio;
        half = Math.max(1, Math.round(0.03 / tl.dt));
        for (i = 0; i < peaks.length; i++) {
            if (localMax(values, frameOf(tl, peaks[i].time), half) >= loud) out.push(peaks[i]);
        }
        return out;
    }

    function normalised(peaks) {
        var s = [], i, ref, out = [];
        for (i = 0; i < peaks.length; i++) s.push(peaks[i].strength);
        s.sort(numericSort);
        ref = percentile(s, 0.9) || 1;
        for (i = 0; i < peaks.length; i++) out.push({ time: peaks[i].time, strength: peaks[i].strength / ref });
        return out;
    }

    function mergeHits(lists, gap) {
        var all = [], out = [], i, k;
        for (k = 0; k < lists.length; k++) for (i = 0; i < lists[k].length; i++) all.push(lists[k][i]);
        all.sort(function (x, y) { return x.time - y.time; });
        for (i = 0; i < all.length; i++) {
            if (out.length && all[i].time - out[out.length - 1].time < gap) {
                if (all[i].strength > out[out.length - 1].strength) out[out.length - 1] = all[i];
            } else {
                out.push(all[i]);
            }
        }
        return out;
    }

    /* ------------------------------------------------------------------ */
    /*  Marker writing                                                     */
    /* ------------------------------------------------------------------ */

    function addMarkers(markerProp, peaks, colorIndex, numbered, onProgress) {
        var i, mv, label, n = peaks.length;
        for (i = 0; i < n; i++) {
            label = numbered ? (PREFIX + " " + (i + 1)) : PREFIX;
            mv = new MarkerValue(label);
            try { mv.label = colorIndex; } catch (_) {}
            markerProp.setValueAtTime(peaks[i].time, mv);
            if (onProgress && (i % 25) === 0) onProgress(i / n);
        }
        return n;
    }

    function clipToLayer(peaks, layer) {
        var a, b;
        try { a = layer.inPoint; b = layer.outPoint; } catch (_) { return peaks; }
        return keepInside(peaks, a, b);
    }

    function countAllOurMarkers(comp) {
        var total = countOurMarkers(comp.markerProperty), i;
        for (i = 1; i <= comp.numLayers; i++) {
            try { total += countOurMarkers(layerMarkerProperty(comp.layer(i))); } catch (_) {}
        }
        return total;
    }

    function deleteAllOurMarkers(comp) {
        var total = 0, i;
        total += removeOurMarkers(comp.markerProperty);
        for (i = 1; i <= comp.numLayers; i++) {
            try { total += removeOurMarkers(layerMarkerProperty(comp.layer(i))); } catch (_) {}
        }
        return total;
    }
    /* ------------------------------------------------------------------ */
    /*  Advanced settings storage                                          */
    /* ------------------------------------------------------------------ */

    var ADVANCED_KEYS = {
        target: 1, range: 1, color: 1, minGap: 1, offset: 1, precision: 1,
        limit: 1, source: 1, snap: 1, number: 1, replace: 1, keepHelper: 1
    };

    function defaultAdvanced() {
        var a = {}, key;
        for (key in ADVANCED_KEYS) {
            if (ADVANCED_KEYS.hasOwnProperty(key)) a[key] = DEFAULTS[key];
        }
        return a;
    }

    function loadAdvanced() {
        return {
            target:     clamp(readInt("target", DEFAULTS.target), 0, TARGET_ITEMS.length - 1),
            range:      clamp(readInt("range", DEFAULTS.range), 0, RANGE_ITEMS.length - 1),
            color:      clamp(readInt("color", DEFAULTS.color), 0, LABEL_NAMES.length - 1),
            minGap:     clamp(readInt("minGap", DEFAULTS.minGap), 40, 1000),
            offset:     clamp(readInt("offset", DEFAULTS.offset), -120, 120),
            precision:  clamp(readInt("precision", DEFAULTS.precision), 0, PRECISION_ITEMS.length - 1),
            limit:      clamp(readInt("limit", DEFAULTS.limit), 0, LIMIT_ITEMS.length - 1),
            source:     clamp(readInt("source", DEFAULTS.source), 0, SOURCE_ITEMS.length - 1),
            snap:       readBool("snap", DEFAULTS.snap),
            number:     readBool("number", DEFAULTS.number),
            replace:    readBool("replace", DEFAULTS.replace),
            keepHelper: readBool("keepHelper", DEFAULTS.keepHelper)
        };
    }

    function persistAdvanced(a) {
        var key, v;
        for (key in ADVANCED_KEYS) {
            if (!ADVANCED_KEYS.hasOwnProperty(key)) continue;
            v = a[key];
            saveSetting(key, (v === true) ? "1" : ((v === false) ? "0" : v));
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Analysis                                                           */
    /* ------------------------------------------------------------------ */

    function makeConfig(mode, amountPercent, a, tempoChoice) {
        var amount = clamp(Math.round(amountPercent), 0, 100) / 100;
        var tempo = tempoChoice || { mode: 0, bpm: DEFAULTS.tempoBpm };
        var quietDb = 30 + 20 * Math.max(0, amount - 0.5);
        return {
            mode: mode,
            sensitivity:   amount,
            gate:          0.7 * (1 - amount) * (1 - amount),
            beatFloor:     amount < 0.5 ? 2 * (0.5 - amount) : 0,
            quietLevel:    Math.pow(10, -quietDb / 20),

            hitQuietLevel: Math.pow(10, -(amount < 0.5 ? 20 - 20 * (0.5 - amount) : 20 + 40 * (amount - 0.5)) / 20),
            tempoMode:     clamp(tempo.mode, 0, TEMPO_ITEMS.length - 1),
            tempoBpm:      clamp(Number(tempo.bpm) || DEFAULTS.tempoBpm, 30, 300),
            minGap:     a.minGap / 1000,
            offset:     a.offset / 1000,
            precision:  a.precision,
            range:      a.range,
            target:     a.target,
            limit:      LIMIT_VALUES[a.limit],
            color:      a.color,
            source:     a.source,
            snap:       a.snap,
            number:     a.number,
            replace:    a.replace,
            keepHelper: a.keepHelper
        };
    }

    function resolveMusic(comp) {
        var selected = comp.selectedLayers, audio = [], i, l, has = false;
        for (i = 1; i <= comp.numLayers; i++) {
            l = comp.layer(i);
            try {
                if (l.hasAudio === true && String(l.name).indexOf(TEMP_COPY_NAME) !== 0) audio.push(l);
            } catch (_) {}
        }
        if (selected.length === 1) {
            try { has = (selected[0].hasAudio === true); } catch (_) {}
            return has
                ? { layer: selected[0], auto: false, audioCount: audio.length }
                : { layer: null, problem: "noaudio", picked: selected[0], audioCount: audio.length };
        }
        if (selected.length > 1) {
            return { layer: null, problem: "many", selected: selected.length, audioCount: audio.length };
        }
        if (audio.length === 1) return { layer: audio[0], auto: true, audioCount: 1 };
        return { layer: null, problem: audio.length ? "choose" : "none", audioCount: audio.length };
    }

    function requireMusic(comp) {
        var music = resolveMusic(comp);
        if (music.layer) return music.layer;
        if (music.problem === "many") {
            throw new Error(music.selected + " layers are selected.\n\n" +
                "Select only the music layer, then try again.");
        }
        if (music.problem === "noaudio") {
            throw new Error("'" + ellipsize(music.picked.name, 40) + "' has no sound.\n\n" +
                "Select the layer that holds the music.");
        }
        if (music.problem === "choose") {
            throw new Error("This composition has " + music.audioCount + " layers with sound.\n\n" +
                "Click your music layer in the timeline, then try again.");
        }
        throw new Error("This composition has no layer with sound.\n\n" +
            "Add your music to the composition first.");
    }

    function resolveRange(comp, layer, index) {
        if (index === 1) return { start: 0, end: comp.duration };
        if (index === 2 && layer) {
            return {
                start: Math.max(0, layer.inPoint),
                end: Math.min(comp.duration, layer.outPoint)
            };
        }
        return {
            start: comp.workAreaStart,
            end: comp.workAreaStart + comp.workAreaDuration
        };
    }

    function cacheKey(comp, layer, win, cfg) {
        var parts = [];
        if (cfg.source !== 0) return null;
        try {
            parts.push(comp.id, comp.frameRate, win.start, win.end, cfg.precision);
            try { parts.push(layer.id); } catch (_) { parts.push("-"); }
            parts.push(layer.index, layer.name, layer.inPoint, layer.outPoint,
                       layer.startTime, layer.stretch);
            try { parts.push(layer.source ? layer.source.id : "-"); } catch (_) { parts.push("-"); }
            try { parts.push(layer.property("ADBE Effect Parade").numProperties); } catch (_) {}
            try { parts.push(layer.effectsActive); } catch (_) {}
            try {
                parts.push(String(layer.property("ADBE Audio Group")
                    .property("ADBE Audio Levels").value));
            } catch (_) {}
        } catch (_) {
            return null;
        }
        return parts.join("|");
    }

    var CHUNK_SECONDS = 60;

    function captureBands(comp, layer, win, cfg, progress) {
        var mult = [2, 4][cfg.precision] || 2;
        var originalFps = comp.frameRate;
        var targetFps = originalFps * mult;
        var span = win.end - win.start;
        var temp = null, base, helper = null, out, p, pair, left, right, itemsBefore = null;
        var f0, f1, n, chunk, cs, ce, chunks, done = 0, fpsK, shift;

        while (mult > 1 && (targetFps > 240 || span * targetFps > 250000)) {
            mult = mult / 2;
            targetFps = originalFps * mult;
        }

        if (cfg.source === 1) {
            progress(15, "Looking for your Audio Amplitude layer...");
            helper = findAmplitudeHelper(comp, 0);
            if (!helper) {
                throw new Error(
                    "No Audio Amplitude layer was found in this composition.\n\n" +
                    "Make one with Animation > Keyframe Assistant > Convert Audio " +
                    "to Keyframes, or set Advanced settings > Audio source back to " +
                    "'Analyze automatically'."
                );
            }
            p = channelSlider(helper, 3);
            if (p.numKeys < 8) throw new Error("The Audio Amplitude layer holds too few keyframes to analyze.");
            fpsK = 1 / (p.keyTime(2) - p.keyTime(1));
            f0 = Math.ceil(win.start * fpsK - 1e-6);
            f1 = Math.floor(win.end * fpsK + 1e-6);
            n = f1 - f0 + 1;
            if (n < 8) throw new Error("There is no audio data in this time range.");
            progress(44, "Reading the audio curve...");
            out = { tl: { t0: f0 / fpsK, dt: 1 / fpsK, n: n }, full: series(n, 0), low: null, mid: null, high: null };
            readKeysInto(p, out.full, f0, fpsK);
            out.sampleRate = fpsK;
            return out;
        }

        shift = Math.round(layer.startTime * targetFps) / targetFps - layer.startTime;
        f0 = Math.max(0, Math.floor((win.start + shift) * targetFps + 1e-6));
        f1 = Math.ceil((win.end + shift) * targetFps - 1e-6);
        n = f1 - f0 + 1;
        chunk = Math.max(1, Math.round(CHUNK_SECONDS * targetFps));
        chunks = Math.max(1, Math.round((f1 - f0) / chunk));
        out = {
            tl: { t0: f0 / targetFps - shift, dt: 1 / targetFps, n: n },
            full: series(n, 0), low: series(n, 0), mid: series(n, 0), high: series(n, 0)
        };

        try {
            itemsBefore = projectItemIds();
            removeTempComps();
            removeTempFilters(layer);

            temp = app.project.items.addComp(TEMP_COMP_NAME, comp.width, comp.height,
                                             comp.pixelAspect, comp.duration + 1, targetFps);
            layer.copyToComp(temp);
            base = temp.layer(1);
            try { base.locked = false; } catch (_) {}
            base.startTime = layer.startTime + shift;
            base.audioEnabled = false;

            temp.openInViewer();

            for (p = 0; p < BAND_PAIRS.length; p++) {
                pair = BAND_PAIRS[p];
                left = makeBandCopy(base, pair[0], -100);
                right = makeBandCopy(base, pair[1], 100);
                for (cs = f0; cs < f1 || cs === f0; cs += chunk) {
                    ce = Math.min(f1, cs + chunk);

                    if (f1 - ce < chunk / 4) ce = f1;
                    progress(5 + Math.round(45 * done / (chunks * BAND_PAIRS.length)),
                             "Measuring the audio (" + (done + 1) + " of " + (chunks * BAND_PAIRS.length) +
                             ") - this is the slow part...");
                    setWorkArea(temp, cs / targetFps, (ce - cs + 1) / targetFps);
                    helper = convertAudioToKeyframes(temp, left);
                    readKeysInto(channelSlider(helper, 1), out[pair[0]], f0, targetFps);
                    readKeysInto(channelSlider(helper, 2), out[pair[1]], f0, targetFps);
                    clearMarkerChanges();
                    helper.remove();
                    helper = null;
                    done++;
                    if (ce >= f1) break;
                }
                left.remove();
                right.remove();
            }

            if (cfg.keepHelper) {
                progress(50, "Making your Audio Amplitude layer...");
                base.audioEnabled = true;
                setWorkArea(temp, win.start + shift, span);
                helper = convertAudioToKeyframes(temp, base);
                helper.startTime = -shift;
                helper.copyToComp(comp);
                helper = null;
            }
        } finally {
            if (temp) { try { temp.remove(); } catch (_) {} }
            if (itemsBefore) { try { removeNewUnusedItems(itemsBefore); } catch (_) {} }
            try { comp.openInViewer(); } catch (_) {}
        }

        out.sampleRate = targetFps;
        return out;
    }

    var CACHE_SAMPLES = 2000000;

    function bandSamples(b) {
        return b.tl.n * (b.low ? 4 : 1);
    }

    function remember(key, entry) {
        var total = 0, k;
        if (!CACHE.hasOwnProperty(key)) CACHE_ORDER.push(key);
        CACHE[key] = entry;
        for (k = 0; k < CACHE_ORDER.length; k++) total += bandSamples(CACHE[CACHE_ORDER[k]]);
        while (CACHE_ORDER.length > 1 &&
               (CACHE_ORDER.length > CACHE_LIMIT || total > CACHE_SAMPLES)) {
            total -= bandSamples(CACHE[CACHE_ORDER[0]]);
            delete CACHE[CACHE_ORDER.shift()];
        }
    }

    function measuredBands(comp, layer, win, cfg, progress) {
        var key = cacheKey(comp, layer, win, cfg), b;
        if (key !== null && CACHE.hasOwnProperty(key)) {
            progress(50, "Using the last measurement of this music...");
            b = CACHE[key];
            b.reused = true;
            return b;
        }
        progress(3, "Preparing...");
        b = captureBands(comp, layer, win, cfg, progress);
        b.reused = false;
        if (key !== null) remember(key, b);
        return b;
    }

    function runAnalysis(comp, layer, cfg, hooks) {
        var progress = (hooks && hooks.progress) || function () {};
        var ask = (hooks && hooks.confirm) || function () { return true; };
        var started = new Date().getTime();
        var range, win, bands, result, peaks, layerPeaks, selection = null, undoOpen = false, times = [], i;
        var key, minutes, added, removed, cost, cached, pending;

        range = resolveRange(comp, layer, cfg.range);

        range = {
            start: Math.max(range.start, layer.inPoint, 0),
            end:   Math.min(range.end, layer.outPoint, comp.duration)
        };
        if (range.end - range.start < 0.5) {
            throw new Error("The music layer and the time range overlap by less than half a second.\n\n" +
                "Move the work area over the music, or set Advanced settings > Time range " +
                "to 'Music layer only'.");
        }
        win = {
            start: Math.max(0, range.start - EDGE_PAD),
            end:   Math.min(comp.duration, range.end + EDGE_PAD)
        };

        key = cacheKey(comp, layer, win, cfg);
        cached = key !== null && CACHE.hasOwnProperty(key);
        pending = pendingMarkerChanges();
        if (!cached && cfg.source === 0 && catchUpSeconds(pending) > 30 &&
            !ask("This panel changed about " + Math.round(pending) + " markers in this project since its last measurement.\n" +
                 "After Effects catches up on them before it measures audio again - about " +
                 durationText(catchUpSeconds(pending)) + ".\n\n" +
                 "Saving, closing and reopening the project skips that wait.\n\nMeasure now anyway?")) {
            return { cancelled: true };
        }
        minutes = (range.end - range.start) / 60;
        if (minutes > 15 && !cached &&
            !ask("The time range is " + Math.round(minutes) + " minutes long.\n" +
                 "Measuring it takes about " + Math.max(1, Math.round(minutes * (cfg.precision ? 6 : 3) / 60)) +
                 " minutes, and After Effects does not respond until it is done.\n\nContinue?")) {
            return { cancelled: true };
        }

        try {
            selection = snapshotSelection(comp);
            app.beginUndoGroup(APP_NAME);
            undoOpen = true;

            bands = measuredBands(comp, layer, win, cfg, progress);

            progress(60, cfg.mode.grid ? "Finding the tempo and the beats..." : "Finding the hits...");
            result = analyzeEnvelopes(bands, cfg);
            peaks = result.peaks;
            if (peaks.length === 0) {
                throw new Error("No hits were found.\n\n" +
                    "Move Amount to the right, or try 'Every hit'.");
            }

            peaks = keepInside(peaks, range.start, range.end);
            if (cfg.limit) peaks = limitToStrongest(peaks, cfg.limit);

            peaks = applyOffset(peaks, cfg.offset);
            peaks = snapAndDedupe(peaks, comp.frameDuration, cfg.snap);

            if (peaks.length === 0) {
                throw new Error("No markers are left in this time range.\n\n" +
                    "Move Amount to the right, or check Advanced settings > Time range.");
            }

            added = peaks.length * (cfg.target === 2 ? 2 : 1);
            removed = 0;
            if (cfg.replace) {
                if (cfg.target !== 1) removed += countOurMarkers(comp.markerProperty);
                if (cfg.target !== 0) removed += countOurMarkers(layerMarkerProperty(layer));
            }
            cost = markerCost(added, removed);
            if (cost.megabytes > addMegabytes(MARKERS_MAX)) {
                throw new Error(peaks.length + " markers" +
                    (removed ? ", with " + removed + " earlier ones replaced," : "") +
                    " is more than After Effects handles safely in one run: it would take " +
                    markerCostText(cost) + ".\n\n" +
                    "Ask for fewer: move Amount to the left, set Advanced settings > Max markers, " +
                    "choose Tempo > Half speed, or mark a shorter part of the song with the work area.");
            }
            if (added + removed > MARKERS_WITHOUT_ASKING &&
                !ask(peaks.length + " markers are about to be added" +
                     (removed ? ", replacing " + removed + " earlier ones" : "") + ".\n\n" +
                     "That takes " + markerCostText(cost) + ". Until then, the next\n" +
                     "Convert Audio to Keyframes in this project - this panel's included - first\n" +
                     "spends about " + durationText(catchUpSeconds(pendingMarkerChanges() + added + 0.7 * removed)) +
                     " catching up on them.\n\nContinue?")) {
                return { cancelled: true };
            }

            if (cfg.target === 0 || cfg.target === 2) {
                progress(85, "Adding composition markers...");
                if (cfg.replace) noteMarkerChanges(removeOurMarkers(comp.markerProperty), true);
                noteMarkerChanges(peaks.length);
                addMarkers(comp.markerProperty, peaks, cfg.color, cfg.number,
                    function (f) { progress(85 + 9 * f); });
            }
            if (cfg.target === 1 || cfg.target === 2) {
                progress(94, "Adding layer markers...");
                layerPeaks = clipToLayer(peaks, layer);
                if (cfg.replace) noteMarkerChanges(removeOurMarkers(layerMarkerProperty(layer)), true);
                noteMarkerChanges(layerPeaks.length);
                addMarkers(layerMarkerProperty(layer), layerPeaks, cfg.color, cfg.number,
                    function (f) { progress(94 + 5 * f); });
            }

            restoreSelection(comp, selection);
            selection = null;

            for (i = 0; i < peaks.length; i++) times.push(peaks[i].time);
            return {
                cancelled: false,
                count: peaks.length,
                times: times,
                tempo: result.tempo,
                range: range,
                reused: bands.reused,
                band: result.band,
                bandsMeasured: !!bands.low,
                samplesPerSecond: 1 / bands.tl.dt,
                seconds: (new Date().getTime() - started) / 1000
            };
        } finally {
            if (selection) restoreSelection(comp, selection);
            if (undoOpen) { try { app.endUndoGroup(); } catch (_) {} }
        }
    }
    /* ------------------------------------------------------------------ */
    /*  Admiral theme                                                      */
    /* ------------------------------------------------------------------ */

    function rgb(hex) {
        return [parseInt(hex.substring(1, 3), 16) / 255,
                parseInt(hex.substring(3, 5), 16) / 255,
                parseInt(hex.substring(5, 7), 16) / 255];
    }

    var T = {
        bg:      rgb("#0B1220"),
        card:    rgb("#111B2C"),
        line:    rgb("#22304A"),
        gold:    rgb("#D4A849"),
        goldHi:  rgb("#F6DE9A"),
        goldLo:  rgb("#B0822D"),
        text:    rgb("#E6E9EF"),
        dim:     rgb("#8E98AB"),
        btn:     rgb("#18233A"),
        btnHi:   rgb("#213050"),
        btnEdge: rgb("#33425E"),
        ink:     rgb("#1B1407"),
        edge:    rgb("#AAC3EB")
    };
    var WHITE = [1, 1, 1];

    function rgba(c, a) { return [c[0], c[1], c[2], a === undefined ? 1 : a]; }

    function mix(a, b, f) {
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }

    function fillRect(g, x, y, w, h, c, a) {
        if (w <= 0 || h <= 0) return;
        g.newPath();
        g.rectPath(x, y, w, h);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, rgba(c, a)));
    }

    function strokeRect(g, x, y, w, h, c, a) {
        g.newPath();
        g.rectPath(x, y, w, h);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, rgba(c, a), 1));
    }

    function fillDot(g, x, y, d, c) {
        g.newPath();
        g.ellipsePath(x, y, d, d);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, rgba(c, 1)));
    }

    function goldRamp(g, x, y, w, h, lift) {
        var i, f, c;
        for (i = 0; i < h; i++) {
            f = h > 1 ? i / (h - 1) : 0;
            c = f < 0.5 ? mix(T.goldHi, T.gold, f * 2) : mix(T.gold, T.goldLo, (f - 0.5) * 2);
            if (lift) c = mix(c, lift > 0 ? [1, 1, 1] : [0, 0, 0], Math.abs(lift));
            fillRect(g, x, y + i, w, 1, c, 1);
        }
    }

    function fadeLine(g, x, y, w, fadeRight) {
        var steps = 24, i, sw, f;
        if (w <= 0) return;
        sw = w / steps;
        for (i = 0; i < steps; i++) {
            f = (i + 1) / steps;
            fillRect(g, x + i * sw, y, sw + 0.5, 1, T.gold, 0.6 * (fadeRight ? (1 - f + 1 / steps) : f));
        }
    }

    function paintBg(ctrl, c) {
        try {
            ctrl.graphics.backgroundColor =
                ctrl.graphics.newBrush(ctrl.graphics.BrushType.SOLID_COLOR, rgba(c, 1));
        } catch (_) {}
    }

    function topOf(ctrl) {
        var c = ctrl;
        while (c.parent) c = c.parent;
        return c;
    }

    function drawGlass(g, ctrl) {
        var top = topOf(ctrl), a = IMG.glass, x = 0, y = 0, c = ctrl;
        if (a) {
            while (c && c !== top) { x += c.location[0]; y += c.location[1]; c = c.parent; }
            try {
                g.drawImage(a.img, -x, -y, top.size.width, top.size.height);
                return;
            } catch (_) {}
        }
        fillRect(g, 0, 0, ctrl.size.width, ctrl.size.height, T.bg, 1);
    }

    function drawPane(g, ctrl, w, h, lift) {
        drawGlass(g, ctrl);
        fillRect(g, 0, 0, w, h, WHITE, 0.045 + (lift || 0));
        fillRect(g, 0, 0, w, Math.round(h / 2), WHITE, 0.02);
        fillRect(g, 1, 1, w - 2, 1, WHITE, 0.07);
        strokeRect(g, 0.5, 0.5, w - 1, h - 1, T.edge, 0.17);
    }

    function glassBody(win, margins, spacing) {
        win.orientation = "stack";
        win.alignChildren = ["fill", "fill"];
        win.margins = 0;
        win.spacing = 0;
        var sheet = win.add("panel");
        sheet.alignment = ["fill", "fill"];
        sheet.onDraw = function () {
            var g = this.graphics, w = this.size.width, h = this.size.height;
            drawGlass(g, this);
            fillRect(g, 0, 0, w, 1, WHITE, 0.16);
            strokeRect(g, 0.5, 0.5, w - 1, h - 1, T.edge, 0.30);
        };
        var body = win.add("group");
        body.alignment = ["fill", "fill"];
        body.orientation = "column";
        body.alignChildren = ["fill", "top"];
        body.margins = margins;
        body.spacing = spacing;
        return body;
    }

    function paintText(ctrl, c) {
        try {
            ctrl.graphics.foregroundColor =
                ctrl.graphics.newPen(ctrl.graphics.PenType.SOLID_COLOR, rgba(c, 1), 1);
        } catch (_) {}
    }

    function setFont(ctrl, font) {
        if (!font) return;
        try { ctrl.graphics.font = font; } catch (_) {}
    }

    function makeFont(style, size) {
        try { return ScriptUI.newFont("dialog", style, size); } catch (_) { return null; }
    }

    function fixed(ctrl, w) {
        ctrl.preferredSize.width = w;
        ctrl.maximumSize.width = w;
        ctrl.minimumSize.width = w;
    }

    function flex(ctrl) {
        var inColumn = false;
        try { inColumn = (ctrl.parent.orientation === "column"); } catch (_) {}
        ctrl.alignment = ["fill", inColumn ? "top" : "center"];
        ctrl.minimumSize.width = 10;
    }

    var PINNED = [];

    function pin(ctrl) {
        PINNED.push(ctrl);
        return ctrl;
    }

    function pinAll() {
        var i, c, w;
        for (i = 0; i < PINNED.length; i++) {
            c = PINNED[i];
            try {
                w = c.preferredSize.width;
                if (w > 0) {
                    c.minimumSize.width = w;
                    c.maximumSize.width = w;
                }
            } catch (_) {}
        }
        PINNED = [];
    }

    function setShown(ctrl, shown) {
        ctrl.visible = shown;
        ctrl.maximumSize.height = shown ? 10000 : 0;
    }

    function selIndex(dd) { return dd.selection ? dd.selection.index : 0; }

    function repaint(ctrl) {
        try { ctrl.size = ctrl.size; } catch (_) {}
    }

    function timecode(seconds, comp) {
        try { return timeToCurrentFormat(seconds, comp.frameRate); } catch (_) {}
        return formatTime(seconds);
    }

    /* ------------------------------------------------------------------ */
    /*  Artwork                                                            */
    /* ------------------------------------------------------------------ */

    var IMG = {};

    function imageFromTempFile(key, bin) {
        var f;
        try {
            f = new File(Folder.temp.fsName + "/AdmiralBeatDrop_" + VERSION + "_" + key + ".png");
            if (!f.exists) {
                f.encoding = "BINARY";
                if (!f.open("w")) return null;
                f.write(bin);
                f.close();
            }
            return ScriptUI.newImage(f);
        } catch (_) {
            return null;
        }
    }

    function loadImages() {
        var assets = admiralAssets(), key, img;
        for (key in assets) {
            if (!assets.hasOwnProperty(key)) continue;
            img = null;
            try { img = ScriptUI.newImage(assets[key].png); } catch (_) { img = null; }
            if (!img) img = imageFromTempFile(key, assets[key].png);
            IMG[key] = img ? { img: img, w: assets[key].w, h: assets[key].h } : null;
        }
    }

    function drawImageFit(g, a, w, h, pad) {
        var dw, dh, room = w - 2 * pad;
        if (!a) return false;
        dw = a.w;
        dh = a.h;
        if (dw > room) {
            dh = Math.round(dh * room / dw);
            dw = room;
        }
        if (dw <= 0 || dh <= 0) return true;
        try {
            if (dw === a.w) {
                g.drawImage(a.img, Math.round((w - dw) / 2), Math.round((h - dh) / 2));
            } else {
                g.drawImage(a.img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function drawFallbackText(g, text, c, h) {
        try {
            g.drawString(text, g.newPen(g.PenType.SOLID_COLOR, rgba(c, 1), 1),
                         8, Math.max(0, Math.floor((h - 16) / 2)));
        } catch (_) {}
    }

    /* ------------------------------------------------------------------ */
    /*  Tooltips                                                           */
    /* ------------------------------------------------------------------ */

    var TIP = {
        mark: "What should get a marker.\n" +
              "Every beat: one marker on each beat - best for cutting to music.\n" +
              "Kick / Snare / Hi-hats: only that part of the drums.\n" +
              "Every hit: every strong sound in the mix.",
        tempo: "The tempo Every beat follows.\n" +
               "Auto-detect: measured from the music.\n" +
               "Half speed: a marker on every second beat.\n" +
               "Double speed: a marker on every half beat as well.\n" +
               "Exact BPM: type the tempo, if you know it.",
        tempoBpm: "The song's tempo in beats per minute (30-300).",
        amountHits: "Right: more markers - weaker hits count too.\n" +
                    "Left: fewer markers - only the strongest hits.",
        amountGrid: "Middle and right: a marker on every beat; further right\n" +
                    "also reaches into very quiet parts.\n" +
                    "Left: only beats that carry a strong hit.",
        add: "Uses the selected layer, or the only layer with sound.\n" +
             UNDO_KEYS + " undoes everything in one step.",
        remove: "Deletes only the markers this panel made (named " + PREFIX + ").\n" +
                "Your own markers are left alone.",
        help: "A short guide to this panel.",
        advanced: "Opens the advanced settings: marker placement, detection and options.\n" +
                  "The defaults suit most music.",
        done: "Close this window. Every change is already saved.",
        target: "Where the markers go.\n" +
                "Composition: on the timeline ruler of the composition.\n" +
                "Music layer: on the music layer itself.\n" +
                "Both: in both places.",
        range: "Which part of the music gets markers.\n" +
               "Work area: between the work area handles.\n" +
               "Whole composition: from start to end.\n" +
               "Music layer only: where the music layer sits.",
        color: "Label colour of the new markers.",
        minGap: "Two markers are never closer than this.\n" +
                "Raise it if one hit gets two markers.",
        offset: "Moves every marker. Minus is earlier, plus is later.\n" +
                "Use it if the markers sit slightly before or after the hit.",
        precision: "High suits almost everything.\n" +
                   "Ultra measures twice as finely and takes about three times as long.",
        limit: "Keep only the strongest markers.",
        source: "Analyze automatically: the panel measures the audio itself.\n" +
                "Use my Audio Amplitude layer: use one you made with\n" +
                "Animation > Keyframe Assistant > Convert Audio to Keyframes.",
        snap: "Put every marker exactly on a frame.\n" +
              "Turn off to keep sub-frame positions.",
        number: "Name the markers " + PREFIX + " 1, " + PREFIX + " 2, " + PREFIX + " 3 ...",
        replace: "Delete this panel's earlier markers before adding new ones.",
        keepHelper: "Keep the temporary Audio Amplitude layer after the analysis.",
        reset: "Put every advanced setting back to its default.",
        bpm: "The tempo the beat markers follow (Every beat mode)."
    };

    var HELP_TEXT =
        "HOW TO USE\n\n" +
        "1.  Open your composition and click the music layer in the timeline.\n" +
        "2.  Choose what to mark. 'Every beat' is best for cutting to music.\n" +
        "3.  Click Add Beat Markers.\n\n" +
        "TIPS\n\n" +
        "Too many markers?  Move Amount to the left.\n" +
        "Missing markers?  Move Amount to the right.\n" +
        "Beat markers twice too many or too few?  Tempo > Half or Double speed.\n" +
        "The result line says (or 174.0) when the other speed fits almost as well.\n" +
        "Kick markers inside a long 808 note?  Move Amount to about 20.\n" +
        "Markers a little early or late?  Advanced settings > Offset.\n" +
        "Only part of the song marked?  Advanced settings > Time range.\n" +
        "Long edit?  It works; measuring takes about 3 s per minute of music,\n" +
        "and a second mode on the same music reuses the measurement.\n" +
        "After thousands of markers?  Save, close and reopen the project:\n" +
        "After Effects gives the memory back and measures audio fast again.\n\n" +
        UNDO_KEYS + " undoes everything the panel did in one step.\n" +
        "Remove Markers deletes only markers made by this panel.\n" +
        "Hover over any setting to see what it does.\n\n" +
        "made by Admiral";

    /* ------------------------------------------------------------------ */
    /*  UI construction                                                    */
    /* ------------------------------------------------------------------ */

    function buildUI(host) {
        var root = (host instanceof Panel)
            ? host
            : new Window("palette", APP_NAME + " " + VERSION, undefined, { resizeable: true });
        if (!root) return null;

        loadImages();
        var adv = loadAdvanced();

        var body = glassBody(root, [10, 6, 10, 6], 6);

        var LABEL_W = 118;
        var FONT_BODY = makeFont("REGULAR", 12);
        var FONT_BOLD = makeFont("BOLD", 12);
        var FONT_BIG  = makeFont("BOLD", 18);

        function addRow(parent) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = ["left", "center"];
            g.spacing = 6;
            g.margins = 0;
            g.minimumSize.width = 10;
            return g;
        }

        function addCard(parent) {
            var s = parent.add("group");
            s.orientation = "stack";
            s.alignChildren = ["fill", "fill"];
            s.alignment = ["fill", "top"];
            s.minimumSize.width = 10;
            var pane = s.add("panel");
            pane.alignment = ["fill", "fill"];
            pane.onDraw = function () {
                drawPane(this.graphics, this, this.size.width, this.size.height, 0);
            };
            var c = s.add("group");
            c.alignment = ["fill", "fill"];
            c.orientation = "column";
            c.alignChildren = ["fill", "top"];
            c.spacing = 5;
            c.margins = [10, 8, 10, 10];
            c.minimumSize.width = 10;
            return c;
        }

        function addText(parent, text, c, font) {
            var t = parent.add("statictext", undefined, text);
            flex(t);
            setFont(t, font);
            paintText(t, c);
            return t;
        }

        function addCaption(parent, text, tip) {
            var c = parent.add("statictext", undefined, text);
            fixed(c, LABEL_W);
            c.helpTip = tip;
            paintText(c, T.dim);
            return c;
        }

        function addTitle(parent, key, fallback) {
            var t;
            if (IMG[key]) {
                try {
                    t = parent.add("image", undefined, IMG[key].img);
                    t.alignment = ["left", "top"];
                    return t;
                } catch (_) {}
            }
            return addText(parent, fallback, T.gold, FONT_BOLD);
        }

        function addDivider(parent, vertical) {
            var d = parent.add("group");
            if (vertical) {
                d.preferredSize = [1, 34];
                d.maximumSize.width = 1;
            } else {
                d.alignment = ["fill", "top"];
                d.preferredSize = [24, 1];
                d.maximumSize.height = 1;
                d.minimumSize.width = 10;
            }
            paintBg(d, T.line);
            return d;
        }

        function addDropdown(parent, label, items, index, tip, width) {
            var r = addRow(parent);
            addCaption(r, label, tip);
            var dd = r.add("dropdownlist", undefined, items);
            dd.selection = clamp(index, 0, items.length - 1);
            if (width) fixed(dd, width); else flex(dd);
            dd.helpTip = tip;
            return dd;
        }

        function addSliderRow(parent, label, lo, hi, value, unit, tip, width) {
            var r = addRow(parent);
            addCaption(r, label, tip);

            var sld = r.add("slider", undefined, value, lo, hi);
            if (width) fixed(sld, width); else flex(sld);
            sld.helpTip = tip;

            var edit = r.add("edittext", undefined, String(value));
            fixed(edit, 42);
            edit.justify = "right";
            edit.helpTip = tip;

            var unitText = r.add("statictext", undefined, unit);
            fixed(unitText, 22);
            paintText(unitText, T.dim);

            var ctl = {
                onChange: null,
                get: function () { return clamp(toInt(edit.text, value), lo, hi); },
                set: function (n) {
                    n = clamp(Math.round(n), lo, hi);
                    edit.text = String(n);
                    sld.value = n;
                }
            };
            sld.onChanging = function () { edit.text = String(Math.round(sld.value)); };
            sld.onChange = function () {
                ctl.set(sld.value);
                if (ctl.onChange) ctl.onChange();
            };
            edit.onChange = function () {
                ctl.set(toInt(edit.text, value));
                if (ctl.onChange) ctl.onChange();
            };
            return ctl;
        }

        function addCheck(parent, label, value, tip) {
            var c = parent.add("checkbox", undefined, label);
            c.value = value;
            c.helpTip = tip;
            paintText(c, T.text);
            return c;
        }

        function addGroupTitle(parent, text, first) {
            var g = parent.add("group");
            g.orientation = "column";
            g.alignChildren = ["fill", "top"];
            g.spacing = 5;
            g.margins = [0, first ? 0 : 6, 0, 1];
            if (!first) addDivider(g, false);
            addText(g, text, T.text, FONT_BOLD);
            return g;
        }

        function addImageButton(parent, key, label, kind, tip) {
            var b = parent.add("button", undefined, label);
            b.__key = key;
            b.__kind = kind;
            b.helpTip = tip;
            b.minimumSize.width = 10;
            b.preferredSize.height = (kind === "primary") ? 40 : 30;
            b.onDraw = function (state) {
                var g = this.graphics, w = this.size.width, h = this.size.height;
                var hover = false, down = false, primary = (this.__kind === "primary");
                try { hover = !!state.mouseOver; down = !!state.leftButtonPressed; } catch (_) {}
                if (primary) {
                    goldRamp(g, 0, 0, w, h, !this.enabled ? -0.2 : (down ? -0.12 : (hover ? 0.1 : 0)));
                    strokeRect(g, 0.5, 0.5, w - 1, h - 1, T.goldHi, 0.8);
                } else {
                    drawGlass(g, this);
                    fillRect(g, 0, 0, w, h, WHITE, (hover && this.enabled) ? 0.075 : 0.035);
                    fillRect(g, 1, 1, w - 2, 1, WHITE, 0.07);
                    strokeRect(g, 0.5, 0.5, w - 1, h - 1, T.edge, 0.22);
                }
                if (!drawImageFit(g, IMG[this.__key], w, h, 6)) {
                    drawFallbackText(g, this.text, primary ? T.ink : T.text, h);
                }
                if (!this.enabled && !primary) fillRect(g, 0, 0, w, h, T.bg, 0.45);
            };
            return b;
        }

        var header = addRow(body);
        header.margins = [0, 2, 0, 0];
        var logoArea = header.add("panel");
        flex(logoArea);
        logoArea.preferredSize = [IMG.logo ? IMG.logo.w : 200, IMG.logo ? IMG.logo.h + 2 : 24];
        logoArea.minimumSize.width = 80;
        logoArea.helpTip = APP_NAME + " " + VERSION;
        logoArea.onDraw = function () {
            var g = this.graphics, w = this.size.width, h = this.size.height, a = IMG.logo, dw, dh;
            drawGlass(g, this);
            if (!a) { drawFallbackText(g, APP_NAME, T.gold, h); return; }
            dw = Math.min(a.w, w);
            dh = Math.round(a.h * dw / a.w);
            try {
                if (dw === a.w) g.drawImage(a.img, 0, Math.round((h - dh) / 2));
                else g.drawImage(a.img, 0, Math.round((h - dh) / 2), dw, dh);
            } catch (_) {
                drawFallbackText(g, APP_NAME, T.gold, h);
            }
        };
        var versionText = pin(header.add("statictext", undefined, "v" + VERSION));
        versionText.alignment = ["right", "bottom"];
        paintText(versionText, T.dim);

        var info = addCard(body);
        info.margins = [10, 8, 10, 8];
        info.spacing = 4;

        var infoTop = addRow(info);
        infoTop.spacing = 8;
        var dot = infoTop.add("panel");
        dot.preferredSize = [12, 12];
        dot.maximumSize = [12, 12];
        dot.minimumSize = [12, 12];
        dot.__color = C_WARN;

        dot.onDraw = function () {
            fillDot(this.graphics, 1, 1, 10, this.__color);
        };
        var layerCap = infoTop.add("statictext", undefined, "Selected layer:");
        fixed(layerCap, 108);
        paintText(layerCap, T.dim);
        var layerName = addText(infoTop, "Select your music layer", C_WARN, FONT_BOLD);

        var infoMeta = addRow(info);
        infoMeta.margins = [20, 0, 0, 0];
        infoMeta.spacing = 6;
        var metaType = infoMeta.add("statictext", undefined, "");
        fixed(metaType, 96);
        paintText(metaType, T.text);
        var metaLenCap = infoMeta.add("statictext", undefined, "Length:");
        fixed(metaLenCap, 48);
        paintText(metaLenCap, T.dim);
        var metaLen = addText(infoMeta, "", T.text);

        var markCard = addCard(body);
        addTitle(markCard, "title_mark", "MARK");

        var modeNames = [], mi;
        for (mi = 0; mi < MARK_MODES.length; mi++) modeNames.push(MARK_MODES[mi].name);
        var markDD = markCard.add("dropdownlist", undefined, modeNames);
        markDD.selection = clamp(readInt("markMode", DEFAULTS.markMode), 0, MARK_MODES.length - 1);
        flex(markDD);
        markDD.helpTip = TIP.mark;

        var modeWhat = addText(markCard, "", T.text);
        var bestRow = addRow(markCard);
        var bestCap = pin(bestRow.add("statictext", undefined, "Best for:"));
        setFont(bestCap, FONT_BOLD);
        paintText(bestCap, T.text);
        var modeBest = addText(bestRow, "", T.dim);

        var tempoRow = addRow(markCard);
        tempoRow.margins = [0, 2, 0, 0];
        var tempoCap = pin(tempoRow.add("statictext", undefined, "Tempo"));
        tempoCap.helpTip = TIP.tempo;
        setFont(tempoCap, FONT_BOLD);
        paintText(tempoCap, T.text);
        var tempoDD = tempoRow.add("dropdownlist", undefined, TEMPO_ITEMS);
        tempoDD.selection = clamp(readInt("tempoMode", DEFAULTS.tempoMode), 0, TEMPO_ITEMS.length - 1);
        flex(tempoDD);
        tempoDD.helpTip = TIP.tempo;

        var tempoWhat = addText(markCard, "", T.dim);

        var bpmRow = addRow(markCard);
        var bpmCap = pin(bpmRow.add("statictext", undefined, "Exact tempo"));
        paintText(bpmCap, T.dim);
        var bpmEdit = bpmRow.add("edittext", undefined,
            String(clamp(readInt("tempoBpm", DEFAULTS.tempoBpm), 30, 300)));
        fixed(bpmEdit, 56);
        bpmEdit.justify = "right";
        bpmEdit.helpTip = TIP.tempoBpm;
        var bpmUnit = pin(bpmRow.add("statictext", undefined, "BPM"));
        paintText(bpmUnit, T.dim);

        addDivider(markCard, false);
        addTitle(markCard, "title_amount", "AMOUNT");

        var amountRow = addRow(markCard);
        amountRow.spacing = 10;
        var fewerText = pin(amountRow.add("statictext", undefined, "Fewer"));
        paintText(fewerText, T.dim);
        var amountSld = amountRow.add("slider", undefined,
            clamp(readInt("amount", DEFAULTS.amount), 0, 100), 0, 100);
        flex(amountSld);
        var moreText = pin(amountRow.add("statictext", undefined, "More"));
        paintText(moreText, T.dim);

        var advToggle = body.add("button", undefined, "Advanced settings...");
        advToggle.alignment = ["fill", "top"];
        advToggle.preferredSize.height = 28;
        advToggle.minimumSize.width = 10;
        advToggle.helpTip = TIP.advanced;
        advToggle.__changed = false;
        advToggle.onDraw = function (state) {
            var g = this.graphics, w = this.size.width, h = this.size.height;
            var cy = Math.round(h / 2), hover = false, lab = IMG.adv_label, mod = IMG.adv_modified;
            var ink = g.newPen(g.PenType.SOLID_COLOR, rgba(T.dim, 1), 1.5), i, knobs = [18, 13, 20];
            try { hover = !!state.mouseOver; } catch (_) {}
            drawPane(g, this, w, h, hover ? 0.03 : 0);

            for (i = 0; i < 3; i++) {
                fillRect(g, 11, cy - 5 + i * 5, 13, 1, T.dim, 1);
                fillRect(g, knobs[i] - 1, cy - 6 + i * 5, 3, 3, T.text, 1);
            }

            g.newPath();
            g.moveTo(w - 17, cy - 4);
            g.lineTo(w - 13, cy);
            g.lineTo(w - 17, cy + 4);
            g.strokePath(ink);

            try {
                if (lab) g.drawImage(lab.img, 32, Math.round((h - lab.h) / 2));
                if (this.__changed && mod) g.drawImage(mod.img, w - mod.w - 26, Math.round((h - mod.h) / 2));
            } catch (_) {
                drawFallbackText(g, this.text, T.text, h);
            }
        };

        var advWin = null;

        function updateModified() {
            var changed = advancedChanged();
            if (advToggle.__changed !== changed) {
                advToggle.__changed = changed;
                repaint(advToggle);
            }
        }

        function advancedEdited() {
            persistAdvanced(adv);
            updateModified();
        }

        function openAdvanced() {
            if (advWin) {
                try {
                    advWin.show();
                    advWin.active = true;
                    return;
                } catch (_) {
                    advWin = null;
                }
            }

            var w = new Window("palette", APP_NAME + "  -  Advanced settings", undefined,
                               { resizeable: false, closeButton: true });
            var wBody = glassBody(w, [12, 12, 12, 12], 8);

            var box = addCard(wBody);
            box.spacing = 4;

            addGroupTitle(box, "Marker placement", true);
            var targetDD = addDropdown(box, "Apply markers to", TARGET_ITEMS, adv.target, TIP.target, 230);
            var rangeDD  = addDropdown(box, "Time range", RANGE_ITEMS, adv.range, TIP.range, 230);
            var colorDD  = addDropdown(box, "Marker color", LABEL_NAMES, adv.color, TIP.color, 230);

            addGroupTitle(box, "Detection", false);
            var gapCtl = addSliderRow(box, "Min spacing", 40, 1000, adv.minGap, "ms", TIP.minGap, 150);
            var offsetCtl = addSliderRow(box, "Offset", -120, 120, adv.offset, "ms", TIP.offset, 150);
            var precisionDD = addDropdown(box, "Detection precision", PRECISION_ITEMS, adv.precision, TIP.precision, 230);
            var limitDD  = addDropdown(box, "Max markers", LIMIT_ITEMS, adv.limit, TIP.limit, 230);
            var sourceDD = addDropdown(box, "Audio source", SOURCE_ITEMS, adv.source, TIP.source, 230);

            addGroupTitle(box, "Options", false);
            var optionBox = box.add("group");
            optionBox.orientation = "column";
            optionBox.alignChildren = ["left", "top"];
            optionBox.spacing = 3;
            optionBox.margins = [LABEL_W + 6, 0, 0, 0];
            var snapChk    = addCheck(optionBox, "Snap to whole frames", adv.snap, TIP.snap);
            var numberChk  = addCheck(optionBox, "Number the markers", adv.number, TIP.number);
            var replaceChk = addCheck(optionBox, "Replace earlier markers", adv.replace, TIP.replace);
            var keepChk    = addCheck(optionBox, "Keep the Audio Amplitude layer", adv.keepHelper, TIP.keepHelper);

            var bottom = addRow(wBody);
            bottom.alignment = ["fill", "top"];
            bottom.alignChildren = ["fill", "center"];
            bottom.spacing = 8;
            var resetBtn = addImageButton(bottom, "btn_reset", "Reset to Defaults", "secondary", TIP.reset);
            flex(resetBtn);
            resetBtn.preferredSize = [150, 28];
            var doneBtn = addImageButton(bottom, "btn_done", "Done", "secondary", TIP.done);
            flex(doneBtn);
            doneBtn.preferredSize = [150, 28];

            function bindList(dd, key) {
                dd.onChange = function () { adv[key] = selIndex(dd); advancedEdited(); };
            }
            function bindCheck(c, key) {
                c.onClick = function () { adv[key] = c.value; advancedEdited(); };
            }
            bindList(targetDD, "target");
            bindList(rangeDD, "range");
            bindList(colorDD, "color");
            bindList(precisionDD, "precision");
            bindList(limitDD, "limit");
            bindList(sourceDD, "source");
            bindCheck(snapChk, "snap");
            bindCheck(numberChk, "number");
            bindCheck(replaceChk, "replace");
            bindCheck(keepChk, "keepHelper");
            gapCtl.onChange    = function () { adv.minGap = gapCtl.get(); advancedEdited(); };
            offsetCtl.onChange = function () { adv.offset = offsetCtl.get(); advancedEdited(); };

            resetBtn.onClick = function () {
                adv = defaultAdvanced();
                targetDD.selection    = adv.target;
                rangeDD.selection     = adv.range;
                colorDD.selection     = adv.color;
                precisionDD.selection = adv.precision;
                limitDD.selection     = adv.limit;
                sourceDD.selection    = adv.source;
                gapCtl.set(adv.minGap);
                offsetCtl.set(adv.offset);
                snapChk.value    = adv.snap;
                numberChk.value  = adv.number;
                replaceChk.value = adv.replace;
                keepChk.value    = adv.keepHelper;
                advancedEdited();
            };
            doneBtn.onClick = function () { w.close(); };
            w.onClose = function () { advWin = null; };

            advWin = w;
            w.layout.layout(true);
            pinAll();
            w.layout.layout(true);
            w.center();
            w.show();
        }

        var addBtn = addImageButton(body, "btn_add", "Add Beat Markers", "primary", TIP.add);
        addBtn.alignment = ["fill", "top"];

        var buttonRow = addRow(body);
        buttonRow.alignChildren = ["fill", "center"];
        buttonRow.spacing = 8;
        var removeBtn = addImageButton(buttonRow, "btn_remove", "Remove Markers", "secondary", TIP.remove);
        flex(removeBtn);

        removeBtn.preferredSize.width = 100;
        var helpBtn = addImageButton(buttonRow, "btn_help", "Help", "secondary", TIP.help);
        flex(helpBtn);
        helpBtn.preferredSize.width = 100;

        var progRow = addRow(body);
        progRow.spacing = 10;
        progRow.margins = [0, 4, 0, 0];
        var progCap = pin(progRow.add("statictext", undefined, "Progress"));
        paintText(progCap, T.text);
        var bar = progRow.add("panel");
        flex(bar);
        bar.preferredSize.height = 6;
        bar.maximumSize.height = 6;
        bar.value = 0;
        bar.onDraw = function () {
            var g = this.graphics, w = this.size.width, h = this.size.height;
            var fw = Math.round(w * clamp(this.value, 0, 100) / 100);
            drawGlass(g, this);
            fillRect(g, 0, 0, w, h, T.edge, 0.14);
            if (fw > 0) goldRamp(g, 0, 0, fw, h, 0);
        };
        var pctText = progRow.add("statictext", undefined, "0%");
        fixed(pctText, 38);
        pctText.justify = "right";
        paintText(pctText, T.dim);

        var statusText = addText(body, "Ready", T.text);

        addDivider(body, false);

        var results = addRow(body);
        results.alignChildren = ["fill", "center"];
        results.spacing = 0;

        function addStat(label, tip) {
            var col = results.add("group");
            col.orientation = "column";
            col.alignChildren = ["fill", "top"];
            col.spacing = 2;
            flex(col);
            var cap = addText(col, label, T.dim);
            cap.justify = "center";
            var val = addText(col, "--", T.gold, FONT_BIG);
            val.justify = "center";

            cap.preferredSize.width = 60;
            val.preferredSize.width = 60;
            if (tip) { cap.helpTip = tip; val.helpTip = tip; }
            return val;
        }

        var resBeats = addStat("Beats");
        addDivider(results, true);
        var resBpm = addStat("BPM", TIP.bpm);
        addDivider(results, true);
        var resLen = addStat("Marked");

        var footer = body.add("panel");
        footer.alignment = ["fill", "top"];
        footer.minimumSize.width = 10;
        footer.preferredSize.height = 22;
        footer.maximumSize.height = 22;
        footer.onDraw = function () {
            var g = this.graphics, w = this.size.width, h = this.size.height, a = IMG.footer;
            var iw = a ? a.w : 110, lineW = Math.max(0, Math.round((w - iw) / 2) - 12);
            var y = Math.round(h / 2);
            drawGlass(g, this);
            fadeLine(g, 0, y, lineW, false);
            fadeLine(g, w - lineW, y, lineW, true);
            if (!drawImageFit(g, a, w, h, 0)) drawFallbackText(g, "made by Admiral", T.gold, h);
        };

        var busy = false;

        function relayout() {
            try { root.layout.layout(true); } catch (_) {}
            try { root.layout.resize(); } catch (_) {}
        }

        function refresh() {
            try { root.update(); } catch (_) {}
        }

        function setLine(ctrl, text, c) {
            if (ctrl.text !== text) {
                ctrl.text = text;
                paintText(ctrl, c);
            }
        }

        function setDot(c) {
            if (dot.__color !== c) {
                dot.__color = c;
                repaint(dot);
            }
        }

        function setStatus(text, c) {
            statusText.text = fitText(statusText, text);
            paintText(statusText, c);
            refresh();
        }

        function setProgress(percent, text) {
            bar.value = clamp(percent, 0, 100);
            pctText.text = Math.round(bar.value) + "%";
            repaint(bar);
            if (text !== undefined) setStatus(text, T.text);
            refresh();
        }

        function currentMode() { return MARK_MODES[selIndex(markDD)]; }

        var tempoShown = -1;

        function updateModeHelp() {
            var m = currentMode(), showBpm = m.grid && selIndex(tempoDD) === 3;
            var state = (m.grid ? 1 : 0) + (showBpm ? 2 : 0);
            modeWhat.text = m.what;
            tempoWhat.text = TEMPO_WHAT[selIndex(tempoDD)];
            modeBest.text = m.bestFor;
            amountSld.helpTip = m.grid ? TIP.amountGrid : TIP.amountHits;
            if (tempoShown !== state) {
                tempoShown = state;
                setShown(tempoRow, m.grid);
                setShown(tempoWhat, m.grid);
                setShown(bpmRow, showBpm);
                relayout();
            }
        }

        function tempoChoice() {
            var bpm = parseFloat(bpmEdit.text);
            if (isNaN(bpm)) bpm = DEFAULTS.tempoBpm;
            return { mode: selIndex(tempoDD), bpm: clamp(bpm, 30, 300) };
        }

        function advancedChanged() {
            var key;
            for (key in ADVANCED_KEYS) {
                if (ADVANCED_KEYS.hasOwnProperty(key) && adv[key] !== DEFAULTS[key]) return true;
            }
            return false;
        }

        function persist() {
            saveSetting("markMode", selIndex(markDD));
            saveSetting("amount",   Math.round(amountSld.value));
            saveSetting("tempoMode", selIndex(tempoDD));
            saveSetting("tempoBpm", Math.round(tempoChoice().bpm));
        }

        function setBusy(isBusy) {

            busy = isBusy;
            addBtn.__key = isBusy ? "btn_working" : "btn_add";
            addBtn.enabled    = !isBusy;
            removeBtn.enabled = !isBusy;
            repaint(addBtn);
            repaint(removeBtn);
            refresh();
        }

        var metaShown = true;

        function setMeta(typeLine, lenCaption, lenValue) {
            var show = (typeLine !== null && typeLine !== undefined);
            if (show !== metaShown) {
                metaShown = show;
                setShown(infoMeta, show);
                relayout();
            }
            if (!show) return;
            setLine(metaType, typeLine, T.text);
            setLine(metaLenCap, lenCaption, T.dim);
            setLine(metaLen, lenValue, T.text);
        }

        function fitText(ctrl, text) {
            var s = String(text), w, g, n;
            try {
                g = ctrl.graphics;
                w = ctrl.size.width - 4;
                if (!(w > 0) || g.measureString(s, g.font)[0] <= w) return s;
                for (n = s.length - 1; n > 1; n--) {
                    if (g.measureString(s.substring(0, n) + "...", g.font)[0] <= w) return s.substring(0, n) + "...";
                }
                return s.substring(0, 1) + "...";
            } catch (_) {
                return ellipsize(s, 32);
            }
        }

        function updateContext() {
            var comp = activeComp(), music, layer, hasVideo = false, hint;
            if (!comp) {
                setLine(layerCap, "No composition", T.dim);
                setLine(layerName, "Open a composition first", C_WARN);
                setMeta(null);
                setDot(C_WARN);
                return;
            }
            layerName.helpTip = comp.name + "  |  " + Math.round(comp.frameRate * 100) / 100 + " fps";

            music = resolveMusic(comp);
            layer = music.layer;
            if (layer) {
                try { hasVideo = (layer.hasVideo === true); } catch (_) {}
                setLine(layerCap, music.auto ? "Music layer (auto):" : "Selected layer:", T.dim);
                layerCap.helpTip = music.auto
                    ? "Nothing is selected, and this is the only layer with sound, so it will be used."
                    : "";
                setLine(layerName, fitText(layerName, layer.name), T.text);
                layerName.helpTip = layer.name + "\n" + layerName.helpTip;
                setMeta("Type: " + (hasVideo ? "Video" : "Audio"),
                        "Length:", timecode(layer.outPoint - layer.inPoint, comp));
                setDot(C_OK);
                return;
            }

            if (music.problem === "many") hint = music.selected + " layers selected - pick one";
            else if (music.problem === "noaudio") hint = "'" + ellipsize(music.picked.name, 20) + "' has no sound";
            else if (music.problem === "choose") hint = "Click your music layer";
            else hint = "No layer with sound";
            setLine(layerCap, "Selected layer:", T.dim);
            setLine(layerName, hint, C_WARN);
            setMeta("Sound layers: " + music.audioCount,
                    "Comp:", timecode(comp.duration, comp));
            setDot(C_WARN);
        }

        function startAutoRefresh() {
            var previous = null;
            try { previous = $.global.__admiralTaskId; } catch (_) {}
            if (previous !== null && previous !== undefined) {
                try { app.cancelTask(previous); } catch (_) {}
            }
            $.global.__admiralTaskId = null;
            $.global.__admiralTick = function () {
                if (busy) return;
                try {
                    updateContext();
                } catch (_) {
                    try { app.cancelTask($.global.__admiralTaskId); } catch (__) {}
                    $.global.__admiralTaskId = null;
                    $.global.__admiralTick = null;
                }
            };
            try {
                $.global.__admiralTaskId = app.scheduleTask(
                    "if ($.global.__admiralTick) $.global.__admiralTick();", 600, true);
            } catch (_) {}
        }

        var lastHoverRefresh = 0;

        function refreshOnHover() {
            var now = new Date().getTime();
            if (busy || now - lastHoverRefresh < 300) return;
            lastHoverRefresh = now;
            try { updateContext(); } catch (_) {}
        }

        function readControls() {
            return makeConfig(currentMode(), amountSld.value, adv, tempoChoice());
        }

        function analyze() {
            var comp, layer, cfg, result, summary, notes = [];
            try {
                setBusy(true);
                cfg = readControls();
                comp = requireComp();
                layer = requireMusic(comp);
                persist();

                result = runAnalysis(comp, layer, cfg, {
                    progress: setProgress,
                    confirm: function (question) { return confirm(question); }
                });
                if (result.cancelled) {
                    setProgress(0, undefined);
                    setStatus("Cancelled", C_WARN);
                    return;
                }

                summary = plural(result.count, "marker") + " added";
                if (cfg.mode.grid && result.tempo.bpm > 0) {
                    summary += "  -  " + result.tempo.bpm.toFixed(1) + " BPM";
                    if (cfg.tempoMode === 1 || cfg.tempoMode === 2) {
                        summary += " (" + (cfg.tempoMode === 1 ? "half" : "double") +
                                   " of " + result.tempo.detected.toFixed(1) + ")";
                    }
                    var alt = result.tempo.alternative;
                    if (cfg.tempoMode === 0 && alt && alt.bpm > 0 && alt.share >= OCTAVE_HINT_SHARE) {
                        summary += " (or " + alt.bpm.toFixed(1) + ")";
                        notes.push("This music also reads as " + alt.bpm.toFixed(1) + " BPM. Tempo > " +
                                   (alt.bpm > result.tempo.bpm ? "Double speed" : "Half speed") +
                                   " marks it that way.");
                    }
                    if (result.tempo.sections && result.tempo.sections.length) {
                        summary += ", other tempo in " + plural(result.tempo.sections.length, "part");
                        for (var si = 0; si < result.tempo.sections.length; si++) {
                            notes.push("From " + formatTime(result.tempo.sections[si].start) + " to " +
                                       formatTime(result.tempo.sections[si].end) + ": " +
                                       result.tempo.sections[si].bpm.toFixed(1) + " BPM");
                        }
                    }
                }
                if (cfg.mode.focus > 0 && result.band === 0) {
                    summary += "  -  full mix (bands unavailable)";
                }
                notes.push(formatTime(result.range.start) + " - " + formatTime(result.range.end));
                notes.push(TARGET_ITEMS[cfg.target]);
                if (result.reused) notes.push("Reused the last measurement of this music.");
                if (!result.bandsMeasured) notes.push("Only the full mix was measured (your Audio Amplitude layer).");

                setProgress(100, undefined);
                setStatus(summary, C_OK);
                statusText.helpTip = notes.join("\n");
                resBeats.text = String(result.count);
                resBpm.text = (cfg.mode.grid && result.tempo.bpm > 0) ? result.tempo.bpm.toFixed(1) : "--";
                resLen.text = timecode(result.range.end - result.range.start, comp);
            } catch (err) {
                setProgress(0, undefined);
                setStatus(errorText(err), C_ERR);
                alert(APP_NAME + "\n\n" + errorText(err));
            } finally {
                setBusy(false);
            }
        }

        function deleteMarkers() {
            var comp = null, removed = 0, undoOpen = false, count;
            try {
                setBusy(true);
                comp = requireComp();
                count = countAllOurMarkers(comp);
                if (!confirm("Remove every marker this panel made in '" +
                             ellipsize(comp.name, 40) + "' and its layers (" + count + ")?\n\n" +
                             "Your own markers are left alone." +
                             (count > MARKERS_WITHOUT_ASKING ? "\n\nThat takes " + markerCostText(markerCost(0, count)) + "." : ""))) {
                    setStatus("Cancelled", C_WARN);
                    return;
                }
                app.beginUndoGroup(APP_NAME + " - Remove Markers");
                undoOpen = true;
                removed = deleteAllOurMarkers(comp);
                noteMarkerChanges(removed, true);
                setProgress(0, undefined);
                setStatus(plural(removed, "marker") + " removed  -  " + UNDO_KEYS + " brings them back",
                          removed > 0 ? C_OK : T.dim);
                resBeats.text = "0";
            } catch (err) {
                setStatus(errorText(err), C_ERR);
                alert(APP_NAME + "\n\n" + errorText(err));
            } finally {
                if (undoOpen) { try { app.endUndoGroup(); } catch (_) {} }
                setBusy(false);
            }
        }

        addBtn.onClick    = function () { updateContext(); analyze(); };
        removeBtn.onClick = function () { updateContext(); deleteMarkers(); };
        helpBtn.onClick   = function () { alert(HELP_TEXT, APP_NAME); };
        advToggle.onClick = openAdvanced;

        markDD.onChange    = function () { updateModeHelp(); persist(); };
        tempoDD.onChange   = function () { updateModeHelp(); persist(); };
        bpmEdit.onChange   = function () {
            bpmEdit.text = String(Math.round(tempoChoice().bpm * 10) / 10);
            persist();
        };
        amountSld.onChange = persist;

        try { root.addEventListener("mouseover", refreshOnHover, true); } catch (_) {}
        if (root instanceof Window) root.onActivate = refreshOnHover;

        updateModeHelp();
        updateContext();
        startAutoRefresh();

        root.onResizing = root.onResize = function () {
            try { this.layout.resize(); } catch (_) {}
        };

        updateModified();

        relayout();
        pinAll();
        relayout();
        if (root instanceof Window) {

            try {
                root.size = [380, root.size[1]];
                root.layout.resize();
            } catch (_) {}
        }
        return root;
    }

    /* ------------------------------------------------------------------ */

    var ui = buildUI(thisObj);
    if (ui && (ui instanceof Window)) {
        ui.center();
        ui.show();
    }
    /* ------------------------------------------------------------------ */
    /*  Embedded artwork                                                   */
    /* ------------------------------------------------------------------ */

    /*
      The Admiral PNGs, written as escaped byte strings so the panel stays
      one self-contained .jsx. Sizes are in pixels.
    */
    function admiralAssets() {
        return {
            logo: { w: 218, h: 39, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00\xDA\x00\x00\x00'\x08\x06\x00\x00\x00i\x11V" +
                "\x1C\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05\x00" +
                "\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x08\x09IDATx^\xED\x9BMn\xDCF" +
                "\x10\x85}\x00_ \x17\xF0\x05|\x00{'\x0D\x02\xF8\x04\xBE\x81/ N\x169\x80\xAE0\xBB\x00\x96, Ff\xEC\xAC" +
                "\xB3\xD0\xC2V\xB2\xB3\x05/t\x19\x07\xAF\x87\xC5)>VuWS\x8E\x86\x88\xFA\x03\x08\xCBd\xB1\xBB~\xBB\x9BM" +
                "\xCE\x93'\x8DFc9|\xBBX=\xFB\xF2\xEE\xF45\x9F\x8Fp\xFB\xF6\xE4\xD5\xED\xDB\xD5\x9B\xD2\xF1\xE5\xEA" +
                "\xE7\xE7\xB7W/\x9E\xF2\xFD%\xB8\x1D9\xA03\xCBZ\xA4~\x8D\xFBq\xB0\xAC\xC0r|\xA0M\xBE\x07D}\x01\xB9" +
                "\xA8\xFE\x11\xFE\xCB\xF8}\xFB\xED\xE4'\xBE\xA71\x93\xDB\xCB\xD5\xE6\xF6r\xF5}\x8ESS\xA0\xFA\xFB\xE5" +
                "\xF8zyz7\x0A\xD8\xF8\xFA\xC6KT\x8B\xAF\x17\xABujO\xB5\xDF\x1F\xE7,k\x81\xFB\x8D{7\xD0\x8Be\x85\xD4" +
                "\xE7\xC5\xEA\x9A\xEF\xC39\\\xF3\xF4\x8F\xF8\x82\xDA}\xFF#\x0A\xEE\xBE\xF1\xCB\xD9:\xA7\xCD\x86\x01" +
                "\x1C988\x93|%\xFA$\x1B\x12hr\xFD\xEA\xC5SJ\xFAM\xCD\x0C\xC7\x09\x9C\x8E\xC0\xFD\x93$z{\xF2\x8Ae<\xB4" +
                "Mh\x87\xAF{|\xBD8y\x99\xF5\xC5\xD8W\xB3\x0AD\xF8Q\xF1\xC3\x8C8\xC7\xD6F\x90\x91\x83/O\xEF\xF8z\x94" +
                "\xB4D\xCB$\x97\xC0\xC9\x1B)\x16\xA0\xDA??$V\xBEh0[\xF4\xFD\x0C\x05\xEE\xCDF\x16Q\x9B\x98\xC8}8\xAFdB" +
                "\xB3\xB3\xC5C\xC7\xAF1\x13^\x96a4f\x99\x085\x81\xA2\x99-\x94d\xD2>\xCD\x16\x1B\x96\xD3\xF4\xFD\xA4e" +
                "\xA2\xDC\xB3\x98BS:y2\x11\x8E\x11\xBFF%s\x92\xD7\xA3&P\x98\xC5trD\x92_\xDA\xEF\xFF=,#33\xE2`\xDB\xFF" +
                "\xB4\xD0\x8E\x15\xBFF%\x98M0\xEA\xF7\x7F\x0F\x89\x9FK^\x8F\xDA@\x8D\x96\x80\x81YmThj\xF9\xE9\xED\xB6" +
                "!\xF9d)\xB5\xC8BS\xF6K\x0Cj9f\xFC\x1AAdV\x91\x07\xF1\xD1s\x8C\x93\xBC9j\x03E\xA3\xF0w\xBE\xCE\xE8B" +
                "\xC3\xFFU\x92\x9A\x0F\xEE\xA3$\\X\xA1\xF1\x8C>g3\xE4\xD8\xF1k\x04A0t\x92\xEA\xDD\xAB9\x0F\xD5\xB5" +
                "\x81\x92\x8D\x8A\xE1(\x8C\xC2F\xA1\x0D3\x02'*'\xE1\x92\x0A\xAD\xDF}M;\xA1\xF0\xF3\xDC\xED\xFDc\xC7" +
                "\xAF\x11$\x05\x9Bv\xED\xE0\xE0!y+\x13`N\xA0\x94|\xB1\x00\xB8\xD0\xF4\x8C\xC8K\xAF~i9\xE8p\xCCB\x1B" +
                "\xBDG\xEB\x07\x07\xF1}ip\xC9\xB1\x84\xF85\x0A\x0C\xB3\x09\x05\x9A\xDE\xEF\x14\x9F\x9B4s\x02\xA5\xE4" +
                "\x8B\x05\xC0\x85\x06d\xC7\x8DGpN\xC2E\x14\xDA\xF8\x994\xDC\x96\xC5R\xE2\xD7(\x90\x9E_\xF8\xEB\x8D" +
                "\xC3\xA8;$?\x072Gm\xA0\xF89\xA5\xD4\x97Yh\xC6\xFB\xB1a\x09\xA5\xDA;f\xA1\x8DfV\xBD[z\x8F\x97\xCBK" +
                "\x88_\xA3\x80$xJR\x0E\xD2>P\x87\x17\xA9\x85\x17\xC2\x9A\xDA@\x91|\xF5f\x08\xA0\xE7\xBC4\x82\xF7\xC57" +
                "\x1A\xCD\x17Shx>S\xEF\xBDj\x97w`)\xF1k\x14\x80\xF3y\xA9\xA5\xD1\xC9\xEB\xED\xE8Y\xD4\x06J\x7F\xD1" +
                "\xC0\x85aa\x15\x1A\xD0\x89+\xFFg\x99\xA5\x14\x1A_\xAB\xF92FXJ\xFC\xA0\x07oB5\x14p~i\xFBW\x7F\x1F\x18" +
                "ufu\xA0\xD4\xC8\x1BI~\xAF\xD0\xA8`7V\x12.\xA9\xD0\x80^\xF2\xF2FN\x89%\xC4O\x96\xE75\xBE|T\xC8hWr>}`" +
                "\x1AJ\x84\xAA@\x8DG\xDD\xAA\xF69\xB8\xA3\x8Fjq\xDDH\xC2\xA5\x15\x1A/!\xA3\x9FM-%~\xB2\xB1S\xE3\xCBG" +
                "\x85<D\xF3y\x867*\xF8\xBAE4P\xA3\xF7H\x15K\x1B\xD9\xCE\xB7\x92\xB24\x82/\xAD\xD0\x00\xC9\x846.\x96" +
                "\x10?=\xB0Y\xBE~\xF4\x0C\x89\x8A\x914\x16\xD4ai\x17\x19\x15G\xEF\xB5\x9C>0\"\xAB\"+\xB6\xA9\x91\x1D;" +
                "\xEB\xB9Fmk\x9B\xDF\xF9\x8D\x96\xA9\xC6\x8C\xE7\x11\xB1\xC9\x82\xDE\xF1\xB9\x83\x09-!\xAFs\x89\xFB" +
                "\xA0\xF1\xCB\xE8\xAC\xDB\xE5k\x8F\x9A~\xA4\x9A\xFE\x96\xEBru\xCE\xA3{\x1A\xAD\xA6?N\x1C\x9Co\xEDb" +
                "\xA5\x87s\xE3\xC7\x95H\x08\xBD3\xA6\xDA\x9C\xF4\xEB\x01}\xD0\x86^f\xA9c\xF8\x01\xE9a'\xEE0\xDB%\xBB" +
                "\x1D[R\xB2d\xB6\xD7\xFB\x19P\xBF\xF7\x1Al\xCA\xE9\xDF\x17\xFC\xF4\xBE\xE4\xBB\xE9\xAF\x95y\xE6\xE9" +
                "\x8FQ\xFB\x0F\x11?Kg\xF1\x91\xDA\xCD\xDC\xBFRP2\xDC\xD6\xA3F\x12\xCE:\xBC@\xF9\x87\x13\xA8\x89\x1C" +
                "\xF5\xF3\xEE\xF45\xF7\x15\xA1\xA4\x8Fn\x93u\xCB\xD9-\x87\x96\xD7\xB0\x1C\x1F\x9E-%_p\xA1\x01K\xCFI" +
                "\xA1\x19m\xB1\x1C(\xF9\x8B}\x04J:\xE7\x0En\xAB\xD1h4\x1A\x8DF\xA3\xD1h4\x1A\x8DF\xA3\xD1h4\x1A\x8DF" +
                "\xA3\xD1h4\\>o\xBB\xF7\xC3\xB1\xEB\xCC\x17\x8E#\x99mg~\xF3\xF6\xD7\xD5\xAFOq\xED\x9F\xDF\xD7\x93\x17" +
                "\xB0\xE0\xF3\xB6[s;8\xC7r9p\xCF\xA7?\xCE&/X?}\xF8\xE5\xE5\\\xBD\x84\xA8\x1F\xE4\xEF\x9B?\xCF\x9EY" +
                "\xFA\xB3\x8D|\x1DD\xFA\x02\x9F?\x9E=\xBF\xD9\xAE\xCFE\x16}\xB2\x8CGD\x0F\xF8\xF2f\xB7\xDE\xF42k\xCFG" +
                "Q}=\"\xBA\xE8\xEB\xC9\xE6\x8Fg\xE6\x07\x00\x80\xDB\xA8\xC9\xAD\xA8\xCD bw8F7\xBB\xF5w\x08#Yo\xB6\xDD" +
                "\xB5\x95\xC8\"#\x07_\x07\xC9\x80mw\xE7)\x94\x12\xB3WJ\x1C\xE9*\xE5\x00=\xD0\x07\x9FO\x06\xEE\xD6\xE6" +
                "\xE7?%\xBD\x84\xA8\x1F\xF0/\x8A\x17mZ\xFAG|\x15\xE9\x0B\x09\x009\\\x93\xB6\xD0/\xCBy\x94\xF4\xD8\xC7" +
                "\xA1\xBBN\x83\x14dv\xDD\x1B\xDCc%^D\xDF\x1C%]\x80\x96\xF9{\xDB\xBDN1s\x8A\x85c\x1D\xCD\xAD\x1A\x9BA" +
                "\xC9\xEE\xAA\x18i\xA5\xA1\x087\x96\xCE;I\xACI\x15\x9D\x8C\x9D\x16\x82\x06\xC6\x95\x92\xDE\x03z\xF0h" +
                "\x07\x87&\x07::F\xF5\xD2\xF7{:\x8A\x0C\x9C\x9EK\x18>\xC7D\xFAJ\x81sF\xFF\x089=\xF6>\xEB\xEE8)R\xE2m" +
                "\xD7\x93\x1F\xDCF\xF4\xCD\x91\xD3E`\x19Ib\xD6\x11\xB0\xAC\x90\xD3\xAD\xD6fP\xB2\xBB*Fh,\xCD\x08H\x1E" +
                "\xE7&\x91\xF1\xA6\xE4\xE4\x94m\x97\xBE\xEEN\xD3\xB2\x93\x84\xC0R8J\xD2\x03E\xB3[\x0F_\xE4\x0F#\x98" +
                "\xE1\xFC\x1A\xBD\xF4\xFDh\x13\xA3\xEAXb/\xE3\x0DFB\xC9W \xD2W?k^\xE3\xBA7\xE2\xE6\xC8\xE9\x91b`\xE8" +
                "\xE6%ND\xDF\x1C9]\x04+~2H\xF2yK\x16\xE4r\xAB\xD6fP\xB2\xBB*F\x92\xBC\x92\xC0\x962#\x19cJ\x86\x02\xA2" +
                "\xC4~\xA9f\x8F\x10 \xE7\x8C\x12b8\x8C\x83ab\xA8\xBE\xA6\xA9\xD1K\x92A\x1C\xC7\xD7\xC1\xBE\xD0\xFC" +
                "\xD9\x0C\x94|\x05\"}\x09i\xC4\x85|\xA5\xCFrzx1\xF0\x92\xAEF_\x8B\x9C.\x82\x15\xBF\x1F^h\xC65\xCFf" +
                "\x10\xB5;\x14#\xAD\xB4\xD7\xA9g\x98\x90\x9EW\xFA\x191)\x95\x91\xF7\x0C\x8E \xED\xA65q\xDF\x8E\xCC.V" +
                "\x9F5z\x0D\xC9\xB0\xED\xD6\x9ES!\xD3\xCF\x92\xE6\xF3\x19\xC8\xF5!D\xFA\xD2\xC8\x80b%\x9DGN\x0F\xD9" +
                "\x10\x98\x9C\xC7\xB3\x88q\xBEV_&\xA7\x8B`\xC9\xC0\xCF\xD6La\xC9\x82\\n\xD5\xDA\x0Cj\xEC.\xC6H+\xED" +
                "\xED\xDEy\x86\x81~\xF7-\x8D<\xC3\xA8\xB5[o\xBC\xE5U\xCE\x19%\xB4\x1E\xFBQ\xA6\xBB\x9657\xEBX\xAB\x97" +
                "\xBE\x1F\xF7\xC1\x17c\x89\x83LjK\xF5m\xC9\xE4\x88\xF4\xC5XK\x97\x1C9=RR\xF4\x0F\xF1\xA3s\xFDF\xC1Xz" +
                "\x9E\xBE\x9A\x9C.\x02\xCB\xC0\xDE\\\x01\xF09\x90\xCB\xADZ\x9BA\xAD\xDD\xD9\x18\xA1\xB1\x94\x90\xFD" +
                "\xCE\x9D5Rk\x99$\xA7d\xD08'on\x94\xC89\xA3\xC4\xC8pZs\xB3\xF3k\xF5\xD2\xF7\xCB\xAC\xC5\x85d\xF4o\x0E" +
                "J\x9E\xAF\xB4\x8C\xFC\xED\xF6%\x03\xC5\xB0t\xB1\x0B\xDB\x83\xFD\xC1\xC8\xE6\xC00\xE3g\x96>\x11}sD}2" +
                "\xCA\xC3\xED\xFA\xDC\xEB\xC3\xB3\xAD\x94[56\x83\x92\xDDU1\xD2#\xBE'\xA4eX\x0E\x9DY\xF7yS(\x14\xB6" +
                "\x96\x03\x11t\x9B\xE8S\xF7\xCB\xFD\xD5\xEA\xC5\xE7q?\xEB\xC92\xEC\x0B9\xE7\xF9J\xCB\xE8\xFF[}\xE1>i" +
                "\xC3J\xCC\x12\xDC\x87GNO\x81\xDB\xB2\xF4\xCD\x11\xF5I\xEE\xBA\x86\xF5\x11\xA2\xB95\xB7\x1F\xB6\xFB" +
                "\xBE1j4\x1A\xF7\xE4_\xAC\xF2sT\xA4) \xBD\x00\x00\x00\x00IEND\xAEB`\x82" },
            btn_add: { w: 133, h: 14, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00\x85\x00\x00\x00\x0E\x08\x06\x00\x00\x00\x01" +
                "\xAD\xDF'\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05" +
                "\x00\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x03;IDATXG\xEDX\xD1\x8D" +
                "\xDB0\x0C\xF5O\xE5\xA2\xE8\x9F}\x1F\x97\x00\xFD\xCC\x02]\xA0\x13d\x82n\x90\x0Dn\x85\xAE\x90\x19\xB2D" +
                "\xB7\xC82-(\x8B\xD4\xD33\x153\x87k{(\xF2\x00\xE3\xCE\x14\xC5\x90\xE2\xA3Dy\x18\x1Ex\xE0Oa7\x8D\xA7" +
                "\xFD<\xFE\x92\xBF<\x86\x88\xEA=0\x0C\xBBy\xBC\xC8Z\xB1\xFC\x9F`7\x8DWqf?\x8F?x\xAC\x87h\xB2#z\xBA" +
                "\x18\xCD3\xA5\xF3nN\x07\xD6\xFD[h|\x9A\xC6o<.x\x9E?|U\x9D[\xF1E\xF1nH\xA1\x81)1\x9E\x9E\x86\xCF\xAC" +
                "\xE3!\x92lADO\x17C|\x91\xF7/\xF3\xA7\xE7{\xFD\x89\"\xDB\x9E\xC7\xCB-\x7F\x04-)\xD2\x99\xC7\x05RD\xFF" +
                "%),\xB0\xE9\xE3\xF7%\xB8td\x1D\x0F\x91d\x0B\"zL\x8A,+\xF3P\xF6\x16\x80\"\xE8\xFA#P\x9F\x94\x9CB&\x1C" +
                "\x97w%L\xC4^\x04\xEF\x82\x14R\x85%\xB0\x9F\xF8?\xEB\x09\xF6sz\xC9\xE3E\xA7\xB7\x18Q=\x84G\x0A\xB5" +
                "\xC3G\x88\x90\x17\x8E\xBB\x95]\xB1\x81U.\xBAJt\xEF\x98\xE2\xF9\x0A \x85Kj\x95\xD7b\xAA\xE3\xB7|\xC8s" +
                "\xCDv:.1\x8E\x17\x94\xD7\xDFh\xC7\x05[\xF1\xF7l\xE7b\x90|@np\x9EA'\xCA\x0F\xC9\xBB&\x90\xAB\xC2\x12]" +
                "\xF4$Q\x9ESQ=\x06\x93\x02\xCE\xEA\xA6\xC7\xE1\xDD\xC3\xFC\x9F\xD3K\xD5IG\xED\x012\xD1\xCBB(\xB9\xEE" +
                "\xDD)r\x82sR\xC7k3.\x89\x91\xBE\xC7!\xCD\x96\x0FF\x98R\x8C6\x0FHak\x07:\xA1\xF8\x1D\xDB\xBA\xAB\xC9" +
                "\x98\xC8\xE4\xE9\xC6\xAF\x06\x94\x04\xCAz\xFC\x91\xDE\x0E\xC2\x15\x12\xD5\xF3\xD0\xA9\xE0+\xEE\x1Cf" +
                "\x9F\x88\xA2\x0B\x8E2\x84\xC5T\x88\xFA\x1ART\x1BK\xA2\xE5\xAF\xBE{\xA4`\xB0\x0FV\xCD\xB4\x0Bb>t\x1D4" +
                "7\xD1\xF8=\xDB\xBD\"[\x01\xCEDK\xA21\x0A\xAA\xA2\xB7\x88,\xE7\xF7\x9E\x9E\x07\xDE)\x8A\x1F\xB9\xD7a" +
                "\xFB\xBDGm\x95&\xF5\x94m\xC2v\xC9vn\xF9#@\x9F\x80\xF0\xB9\xE1,;D^#\x8F\x14[>\xE0\x8E\x80\xC0*\xCF" +
                "\xFA~b\xDD\x87m\x98Q\xDE\xAD\x96]\xEF\xE46\xF0\xCD\xD9\xEF=\xA5*z\x8B\xC8r~\xEF\xE9y`R\x08\xB0Z\xE4=" +
                "b\x07\xAA)\x9F\xA9\xB2\xA8<\x8F\xDF{`\x9F\x94\xA4<\x9FI\x11\xF1\xC1K\x1C\xCAk\x1FV\xFB\x10\xB6\xD1C" +
                "\xCF\xB6`9\xD6*I\xB9M\xB0o\x13\x8D\xB0\xD9\x1A\x97\xAA\x80\xB3\xAD\xB9\x96Y#h\x81\xC6\xF4<p\x02\x04" +
                "\xBCky;\x1B\xC3[8N\x9A\xA7\xE3\x81}\x82y\xCDm$b\x9Fuz\x89S9V\xB6\x16g$~A\xCF6\x82{\xBFEH\x89g\xE41" +
                "\xF8F\xA0?\xA4\xCC\xD5\xC0W\xC1\x07\xF5\x18\x9C\x80RmvUV=\xBC\xC9\xD4\xE6K\xD8O\x8D\xED\x94\xCE\xB9" +
                "\x99r\x1A\xDD\x1Ey\x19\xEC\x93\x00\xAA\xCC\xCE\xE6u\xC2#>\xF8\x89Cy3\xAF\x1C#[\xF1\xB3\x8D*K\x07\xD5" +
                ")\x84\xCBv060\xEE\x7F\x93\xE0\x84\xA0!\x0D\x98\xCF\xFC{\xF4\x18\xB6m\xE2\x93\xAF\xB3\xED\x97\xC4\x85" +
                ",t\xEC\xD1\x97O\x1C\xCFv\x9D+q{m\x86j\x01x\xA4\xD0n\xBF\x95\xAD{\x8A-\x1F\xBC\xC4yr,*\x89=\x12?\xDBX" +
                "d\xE9\x80\xD7Xom\x1Fx\xA0\xC1oc\xFBj\xA4O\xCA\xDFq\x00\x00\x00\x00IEND\xAEB`\x82" },
            btn_working: { w: 75, h: 18, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00K\x00\x00\x00\x12\x08\x06\x00\x00\x00\x13\xCF" +
                "#\xD5\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05\x00" +
                "\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x02.IDATXG\xEDW\xCBm\x021\x10" +
                "\xE5\x12;\x8Ar[s\x00\xA4\x1C\xD3@\x1A\xA0\x02*H\x07t@\x0B\xB4@\x0D4\xB1]\xD0L\xA2g\xCF\xD8\x0F\xAF" +
                "\xCD\xC7YE!\xDAwY<\x9E]\xCF<\xCF<\x9B\xD9l\xC2ca\xE9\xECq\xE5\xECWnW\xAC:\xD3c~>\x9F\xBD\xE6s\xBF" +
                "\x8EUg\x0E\x08f\xD9\x99\x0D\xDB\x97\xCE\xBC\xC3^JD\x13xs/\x8B|\xEE^<\x14Y IH\xD9\x9F\xDB\xEDV\xC9Z" +
                "\xB8\xA7\x0F\xB5#ho\xEFL\xCF\xFE\xAD\xB8F\xD6\x9F\x02\xAA#T\x96=\xB1]wT\xE6\xB6\xC9n\xD7\xC1nv\xEC" +
                "\xDF\x8A\x87\"\x0B\xC8\xDB*V\x8F3;O\x96\xB3G\xF5\x8D\x15\xD7\xD9u\xB2\x99\x0D\x93\x8B\xD6\xE6j\xF4>B" +
                "\x8AV\xB2~3'\xEB\xEA\xBC\x8C\xB1>6X6\xF3\xC4\xF1\x00\x1A\xBB\xC4\xD3'\xB9I\x1B\xDF\x84H\x8A\xE8\x96V" +
                "\x0F\x12\xD6ET3\xF2\xE0cP\xDD\xF3'\xC6\xBER\x858\xE8\x9E\xFA\xA5$M\xCF\xFA\xC3\xDF\x8B:I>\xF9z\xF1;" +
                "\xCE\xEE\xE1\x83\xF5\x944}'\x8F\xC9\xE7Q\xE8\x92&\xD0\xC7\xBCn\xE1\xA9\x01b\xC1\xB0p\xD89I\xE6\x80" +
                "\xDF5\xFD\xD2\xD6V? V\x16\x11\xC8\xF6\xF8Nvp\xD4\xC8b\x1F%\x07y\xD4b\xD2\x8E\xF81Y\x80|\xC8\xEBV(" +
                "\xEB\x90hJ\xC2\xEC\"\xA9\xD9\x8E\x95\x02\x08\xC4P\xFBV\xB4\x89+\xEE\x12\x99\xB5\xB1\xB7\x09\x11\x88" +
                "\xA7\x16S\xCD\xDE\x04m\xB7(\xE0B\x08 \xE4\xF5qw$\xA1K\x014\x90U\xB9\xC2\x8CC\x96\xE6\x95\xDB\x9B\xC0" +
                "\xC2\x8A\xE7y\x99\x87\xB6\xC4\x1C\x9F\x9A\xF1$%R\xD8\xCE\xD7\x91R\x92l\xF7\xED\xA3\x87\x04\x1F\x1Ew" +
                "\x92E\xBA\x17%\x00H\xBA<\x02Y\xAC\x19\xC3k\x84^\x17\x86\xF7\xB1\\LY\xE0/iO\xC9\xCE\x17a\xAD\xDE\xFC" +
                "\xBD|\xECmD\x16\xFBh\x95\x96\x04\x1E\x9B\xA3\x1Ds\xCBx\x00:\xFE\xCF\x08IW\x89a\x9B\x00\x08@O\xA4@" +
                "\x9C9\\\xD3\x9E\x9A\x9D\x13\xF3\x017\x90%U\x1Ad%\xB5x\xE8\x8E\xB1\xC8\xFA\xCF\x88z[\xD8\xEC\x09\x19" +
                "\xB4\xB2\xC6\xF8?\xFB\xAF\xE0uT\x0E\x89\xD0\x92rW\xCC\xE4eBAC\xF1{\x94Sp\xC2m\xF8\x06h\xB6I'\x0A\xA7" +
                "\xE65\x00\x00\x00\x00IEND\xAEB`\x82" },
            btn_remove: { w: 97, h: 12, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00a\x00\x00\x00\x0C\x08\x06\x00\x00\x00rl\xD3'" +
                "\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05\x00\x00" +
                "\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x02kIDATXG\xEDV\xDBM\xC3@\x10L" +
                "\x014@\x034@\x03T\x90\x0A\xE8 \x1D\xD0\x02-PC\x9AH\x0B|\xC5 \xC5\x86\x9F\xE4\xDC\x03h\xF6v\xCEs\x1B" +
                "\xC7\xCE\x07\x88 e\xA4\xC8\xDE\xF5\xDD\xBEf\xF7.\x8B\xC5\x15W\xFC'\xBCu\xFDW\xD4\xFD\x18\x9A6\xAD" +
                "\xE1\xA0\xFC\xDA\xFE\xF9u\xBF\xBF\x89\xEB.\x1D\xC8\xA3\xE9\xD2&\xEA\x01\xE4\x83\xDC\x9A.\xAD\xE2\xB7" +
                "s\xF1\xFB$\xB4\xE9\x1E\xEF\x16l\x9B^\x9A\xB6\x7F\x8A\xEB.\x1D\xA5\x99<\x97\xEA[\x97V\xFF\x86\x04\x93" +
                "?\xD2\x03\x88\xA0\xFC\xFEy\xB8c\x82M\xDBo!\xF3[\xD6\xA5%\xA7\x08{+\xB9MK\xB5\x03\xBB\xC3\xB7\x81h" +
                "\xE8\xB7\x1F\xE9\x912;\x17\xCF)\xFF\x8A\x9CG\xFF\xAC\xB1\x03\xB0\x81}\xF0\xA7$\xC0\x1F\xF4\x1E\xE7Z" +
                "\xA7_\xF3\xE2\x1E%\x01~\xB0\x07\xEFS\xF1E;\x88\x81\xF9\xC3\x06\xD7U$\xECv\x87[\x8C4\x8A9|\xEF\xB7," +
                "\x10\xD6A\xE67-&\x9CYRn\xDC\xC8\x94\xC0\xD5N\xF1\xE3\x09\xE6\xBD9)\xCA\xC5\xCE\x84\x7F\x05\xF3\x80O" +
                "\xD8\xA7\x1E{\xADh(B \x81\xEB\xE2\xF4\xC7&\xA1\x8E\xFB\x10;I\x9B\x8AO\xED\x18Y\xB2\xAF\xC2\xF1\x9D0L" +
                "\x85\x19\x0D\xE7,\xD6\x93\xED\x98\xF0\x98l\xCF\x11;\xB9\x83r\xC0\xDA\xF9\xBE\xFE\xC5'\xF2h\x9F\xFA" +
                "\x8Fz_\xBF\xD2.\x83\x0F'\xBD\"A\xE1\x13\\\x9A\x00\xB1D\x1F\xB9\xA0i\xA9\x85\x9C\x8BO\xED0_\xADO\xB5" +
                "\x09\xC6\xF2}\x801\xAB\x8E\x09\xEB\xAC\xA3\x9F\x13\xC5\"\x97\xF5'\xE4\xDC!C\x92\xF1\xBB\xBD\xE7\x11_" +
                "Z\xC1\x9C\x9C9\xFF\x0A\xCD\x03\xFB\xF3S&*\x90\xC0\xE9C\x11\xBD\xC0\x15\x09|W\x9Dv\xBD\xE9f\xE2\x8Bv2" +
                "\xD98\x1AC#\xE9q\xC4\x8E,FN\x14\x8F\x88NN\xC9c\x1D\xC3\xF1\xA4\xCC\xBB\xC8\xCFjk\x849\xFF\x0A\xCDC" +
                "\x8E\x9F\x0DuJ\x02\xE3\xC1\x13\xA4G?1\x0F\xEA\xD8\xCD\xA5\xD3g\xE2\x1B\xB3\x03\xF0>*\x0A\x0D\xDEe" +
                "\x1B9\xBC\x97\xBFvr\xC1*\xA2\x93)y\xEAN\xD0\xF5\x88\x87#;\xE7_\xA1yXaCw+\x09\xF9\x9E\xC8\x17\xB8O" +
                "\xCC\xFA\x1C\x12\xF0\xE4E\x0B\"\xE6\xE2\x1B\xB3\x03\xE8Ql\x88$\x98\xAEK\x1B\x16\x8C\x1D\x0B\x83\xD9a" +
                "}\x81\xE9\xBE)9;\x1E\xEE\x9FH\x00\xE0\x1D<:1c\xFE\x151\x0F\x1Eo\xE5\xBB\x90\xC0\xC2\xBB=k\x8EsI\x00" +
                "\xD8\xC9\xB03\x15_\xCC_\xD6\x9C\xFC\x97w\xC5\x1F\xE0\x1B\x8F6\x03\xAB\xD5\xEF/\x04\x00\x00\x00\x00IE" +
                "ND\xAEB`\x82" },
            btn_help: { w: 27, h: 15, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00\x1B\x00\x00\x00\x0F\x08\x06\x00\x00\x00\x15" +
                "\x93\xB4\xD8\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa" +
                "\x05\x00\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x00\xE3IDAT8O\xDDR" +
                "\xC1\x0D\xC20\x0C\xEC\x00,\xC0\x02,\xD0=\x98\x80\x0D\xD8\x80\x15X\x81\x19\xBADW\xE0\xD5\x04\xA9\x0E|" +
                "\xA8\xB3C\xD1%uU\xB9\x81\xE6\x01\x12pR$\xC7>\xFBb;E\xF1k\xB0\xCE\xF7\xDA\xF7\x14\x86\xB8\xB2\xC4\xA5" +
                "\xF6\xE7\x16\xC9\xE5\x05|\x9D\xD8\xE5\xD6m\x02\xCF\xF9\xDE\x90opO\xF1`G\xAEo\"\x97\xAB\xF3\xFD\xBE" +
                "\x92x\x96\x18\x92\x9B+\xEF\x82\x9F\xB8\xC4=\xC5\x83m\x89O\x10\xC0\x81m\xC9\x1F%\x1E\xC5@J\x9CP\x00" +
                "\xC5\x1D\xD7c\xC2\x90#\xDDi\xB1\xB6\xED\xD6r\x87=}\xD8bg\x88\xE9G\x0C\x1D\x84\x1C-6\xAD1\xF3\xE5\x88" +
                "\x81\xA3\xE3\x02-6\xEDl6\x95%\xB10\xFB\xB8\xEC\xAD\xE6\x00Z\xCC\x90?\xC8\xCE d\x1C\xEFG\xF2\x92\x18" +
                "\x10~\x98\xE3ZF\x88\x82)\x9E<*\xC5{;R;\xFB\x18\xFEW\xEC\x15\x1E\xB9\xBBdEI\\/\xB7\x00\x00\x00\x00IEN" +
                "D\xAEB`\x82" },
            btn_reset: { w: 89, h: 11, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00Y\x00\x00\x00\x0B\x08\x06\x00\x00\x00\x14M!S" +
                "\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05\x00\x00" +
                "\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x02\x09IDATXG\xEDV\xC1m\xC30\x0C" +
                "\xCC\x00]\xA0\x0Bt\x81,\x90\x09:A7\xC8\x06Y!+d\x86,\x91\x15\xFA\xB2R r\xFAI\xA4\x1DZ\x9C,\xAA'Z\x12" +
                "\x1C\xB7\x08\xFA\xC8\x01\x06,\x91\"\x8F\x14I{\xB1x\xE0>8\xF6\xFEK\x1Ec}g\xAC{\xD5:\xFF\x0D\xCC9<\xD6" +
                "\xED>>\xAF/ZO\x03:\x88\x11g\xB4l*f\x9D\x8D$\x97\xE1\xDD\xBA%\xD6\xEF\x97\xCB\x93\xD6\x9B\x0Bc\xFDF" +
                "\xECk\xB4d-0gp5\xBD[c\xEFt\xBA>k]\xC6\xD1\xFA-t\xF5\xFE-\xE0$O\xE6\xCF\x84\x01c\xDD~\xD2\xC1\x89h" +
                "\xD9k\xC9Z\xD0\x9C\x81\x90h\xEB\xB7\xBC\xA71\xD7\x1F#O\xF2D{\xBA\x92M\xEF\x0E\"3g\xB7\x92\xF6\x82A" +
                "\xB4\x1B*\x07\xC1H\xAB\xCAx)\xE9\x06\x12?z{\xF6[\x92\xE56\xEA\xA3\xAB\x94\xE4\xC0\xBDh\xA7\xCE%\xDF" +
                "\xF3\x1B\xB1\x835\xDB\xCD\xD6\xF1]\xDB\xAB\xE5%\x1D\xD2\xCA\xD8G\xEBa--\xD8\x9D\xDD\x1Bf\x9F\xBE\x88" +
                "\x96.\xDE\x03\x99\xCAm\xB3\x0Cg9y\x12\\i\xD6\xB2^\xDA\x8BI\x9E\xC3%\x8E\x9CC\xF0\xA9\x93\xAA\xD7\x95" +
                "J.\xE5%A\x08#\x18\x0E*\x90\xA3\x0B\x18.\xC1wC\x10\xBEC{f\x81\x14t!\xAB\x05\x06\xB0lHF\xDE\xEE\xA8" +
                "\xAE\xD2\x0Cm%\xF9\x16.\xA86\xECI\xD5\xFF&\xC9\xA5\xBC$0aq\x8A\xF7R\xD0\x02\xDC<\xE4\xC1\xE8\xD9\xAD" +
                "Z\xBA:0\xC6\x1F'y\x07\x1B%;\x02\xF6\x17FJ\xAC\xDEP\xC9Q&\x1D%g\xA6&\x19\xD0y\x91\xFD\x11\xE1p\xAB" +
                "\xE4L\x07\xC3\x90$\xB4t\xA5\xBA\xF4>\xC02mC:kT\x15\x8As\xAC \xF08 Hm\x871\xBE\xD4a\x8C\x88/\x91e\xEF" +
                "q\xCE\x8A\x0D\x9D\xE4Rl\xA3\xE2\xD0\x84\xE4\xA31(\xA3\xB2c+\xC5a\x8E\x87\xD6\xE1\xA3R\xD3\x15{\xA2" +
                "\x9B\x9C\x92/\x96\x8D>|\\\x0D\x04\xF1\x91\xF4z\xB7\xE6\xDF\xCE*\x17Jr\xAA\xDE\x10\xBF\xDFfU\xCE1\xC6" +
                "\xDFC\xF6\x9D\xFC\x10\xFFZ^\x1E\xB8\x03\xBE\x01\x9C\xA2\xC1\xABT\xCD\x13\xD5\x00\x00\x00\x00IEND\xAE" +
                "B`\x82" },
            adv_label: { w: 117, h: 15, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00u\x00\x00\x00\x0F\x08\x06\x00\x00\x00\xDA\xBD" +
                "\x80\x1B\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05" +
                "\x00\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x02\x8FIDATXG\xEDW\xD1M" +
                "\x031\x0Ce\x00\x16`\x01\x16`\x01&`\x026`\x83\xAE\xC0\x0A\x9D\x81%\xBA\x02_\xBD\"5W~ \xB7\x03\xE89y=" +
                "\xC7M\xC2EP]\x91\xEEI\xD5%\x8Ec\xBF\xD8\x89\x93^]-X@t\xBD\x7F\xEA\x9C\x7F\xB1\xF2K\xC2\x1C\x1C;7l;" +
                "\xE7\x1F\xAC|VtnX\xED\xFA\xE1\xCB\xCA-\xE6\x08X+\xCE\xC1\x11\xF1\x81\xDDR\xFF\"\x81\x84\"\x10\xDD" +
                "\xC1\xDF\xDB1\x8Ds\x04\xEC\xAFq\x0E\x8E\x12\x9B$\xA9i\xFF\xE2\x80\xB2\xB1s~\xCD\xAF\x1E{{\xFF\xBC" +
                "\xC5\x02B\xD2\x87m\xD4\x93\x80\xA1\xBD=\xF8G\xEA\xBE~|\\C\x0F_\xC8E?n\x16\xC8\xA8\x07Y\xB0\xCB\xF1a" +
                "\x95\xD8p~\x0Dy\x9C+%\xCD\xF2@\x9Fs\xEC\x98\xE6\x98\x03\xAB\x92\xFC\xDC\xF0L\xB9\xB5C\x1F\x94)NI\x1F" +
                ":\xFC\xB2]Z\x9F\xF5a\xB9\x96\xB85\x83'\x94I\xD9\xEF?o\xC6\xB1a\xCB\xC4A\x1E\xEF\x0E!\x81\x80\xA7\x84" +
                "\xB0)\x02\x11\xCC\xA1\x9D@|\\\x18\x09\xC3\x1Ft\x18\x04\xB1\xD1\xFB\x0Dt9\xC6\xCA\xA1y\xEC\x9C\xBFC" +
                "\x7F\xF4[\xE6h!A\xED\xFDFo2\xA2\xEE\xA3~RmR\x8B\xEB\xABp\xADqk\x02\x9D\xB2\x0F2$+\x0B\xEB\xFDF\xEB" +
                "\xEB\xD2\xA6Of\xD4_\xE7\xCA7d:\xC8\x99\x8D#\xF7S\xCE\x1F\x90\x93\xC3\x1E\x82\x90\x1D\xAB\x94_\x9E " +
                "\xED\x1F\xC8\xDA\x89>\xD8nI\xEA\xD4\xF5i\xAE%n\xCD\x08\xCE\xC6c\xAEwhh\xA7\xC1\xB1\x01\x93M\xE0\xFC" +
                "\x03w\xDDQ/\x9Eb,\"\x94\x9A4\xA9l\x8B.lr\xD1\x99d@~,I\xFA\x07yf\x8E\xE5h\x116Y8!LZ\xCD\x87\xCCiL*" +
                "\xDB@m}\x96k\x8E[3`\xE0d!H\xC2\xC1\xDFO%\xC1\xBB\x95%\x96;\x12_\xA9\x04\xC6Nu\xD1\xA5\x93ZHRn\xCCr," +
                "\x81\xF7>\xDA9;\x1A6\x89\xB6\xFFWI%4\xB7&pW\x9C\xC8\xE3\xE9ey\xD5\xF7\x8C$\xDC\x90\xA0\x8Ce\x03\xFA|" +
                "p\xC1\x86\x04`BR\xA5m\xEF\x1Cu\xD7\xE7\xFE\x07N\xE5\x98\x03\xCB\x1D\xDA5\x1F@\x08\xFE\xF8.\xB0\xFD)I" +
                "m\xE1\xAA\xB9\x01\xD0c|\xE5\xDD\x11\xAF9}]\x06E\xF3z%x\xCF\x82D\xFA\x8ACr\x86\x95%\x11\x0D\x1FO\x18" +
                "\x13\x19\xE6\x84$MM\xAA}\x1D\x92<\x1F\x11\x90\xC71\xF3\xA2\xACs$\xE4\x1E\x1Em\x9C\xBE\xA2+>(\xCF\xF5" +
                "\xF5\x9A~^\x9F\xE5\x1A\xFC\xD4\xB8A6)\xA9\x0B\xE6\x07\x1FQV\xBE\xE0\x9F\x82\xE5\xF7\xD7\xAF\xDD\x05" +
                "\xF3\")\xEF\xAA\x8C.X\x90\xC57ga\xF4\xAD\xE8p\x9AG\x00\x00\x00\x00IEND\xAEB`\x82" },
            btn_done: { w: 32, h: 11, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00 \x00\x00\x00\x0B\x08\x06\x00\x00\x00\x1E\x11" +
                "\x8F\x01\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05" +
                "\x00\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x01\x10IDAT8O\xCD\x94\xD1" +
                "\x0D\x820\x10\x86\x19\xC0\x05\\\xC0\x05\\\xC0\x09\x9C\xC0\x0D\xDC\xC0\x15X\xC1\x19X\x82\x15|\xA2\x98" +
                "\xD0\xE2\x0B\\w\xC0\xFC\xADW\x8EZ\x08/\x18/i\xD2\xEB\xDD\xE5>\xFE^\xC9\xB2\x7F0\xA5\xA9\xA8\x8D\x1Dx" +
                ")C\xA5\xD2t\x8E\xF363\x07\xA0\xE9\x18\xFC\x96N\x1E\xC2\xDE\xA6\x99\x1BY\x0C\x00{t\xDD\x0Ej4M\xBF\x87" +
                "\xFF|\xF5\x87Z\xD3=\xA8\x14\xC1\xE1\x0C9J\xDB*\x8E\xFBs\xAF2\xE2\xF0em\x12\x00Vk\x9B\xF3U\xA0\xB0j" +
                "\xE9\x82=\xA0\x9CB\x86\xAE!\x17`\xDA\xE6\x00G\x9C\x81\xE2Z\xF4\x81?vY\x00@\x03,Wd\xA8\x941\xFEZ\xF6" +
                "\xA5Z0(0W\x8B~\x13\x15\xE6\x00 9\xE6\xC1SS\xF1\x157vH\xEDa\x12^\x0ExX\xB2_\x0A\xC0\xDD\xB9\xB1\x83" +
                "\x9B\x85\xC4W8\x05\xC4\xD9\x12@\x0A~b\x12\x00\x0Dq\xEF~`\xC6\xA7\xB8f\x06x\xEF\xF2?\x00<\xCC\x8B\xCF" +
                ":\xFE\x0F\xB8iO(\"\xF3ds\xD8\x1C\x00\xF6\xACV\xA8\xFD\xD5\xF3^co\xE8\x80\xAB\xAAO\x81i\x10\x00\x00" +
                "\x00\x00IEND\xAEB`\x82" },
            adv_modified: { w: 45, h: 10, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00-\x00\x00\x00\x0A\x08\x06\x00\x00\x00 \xB3" +
                "\xD7\x14\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05" +
                "\x00\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x019IDATHK\xD5T\xCB\xAD" +
                "\xC20\x10\xA4\x00\x1Ax\x0D\xA4\x01\x1A\xA0\x82\xA7\xAC\xD1\xBB\xBD\x0E\xD2\x01-\xD0\x02\x17\xB4\xE1" +
                "\xC2\x81\x168p \x86\x0E\xD2\x0Chl\xAFq6\x1F\x0B\xC4\x85\x95\"\x91\x19{<\x9E\xDD0\x9B}k\xD9\xDA\xDC" +
                "\x1B\xA6\xB5\xC6\xAF\xBC\xFA\x07\xA7\xF1\\5\xFBr\xD1\xD4\xE6(\xEF\x96\xA9\x95\xDF\x17\xA6_w^\xE0Sn" +
                "\xAA\xB4\xA63=\xB4\xD9\xB29\x7F\xC2tZ\xC0/\xBCZj<W=MI\x1A)\x08\x06a`\xA9i\x97\x12S+I\xDD\x98~:\x1C." +
                "\x1F\xB4:I\x07\x0D`qMMU\xCA\xE9\xFDCX\xCF4\x0C Y\xC1\xC4\x94\x88\xDA]Y8\x81]Yx\x9E*\xCB\xB4\xD5\xDC" +
                "\xE9\xF07\xB7l6C\xA6E\x17\xA9\xA5\x9C\x9C\x8D\xBDx\xA4\x1BS\x9AQ\x14&\xB0\xC8\x8B\x04C1%\xAA\xF4\xDC" +
                "\x8Fq\xBA\x959\xD3.\x80\x90hL6\xA3\xF9<|_.p#<2wc\xC6z\\h\xB7{\x7F\xC3\xB4\xD6\xCEivD\xDD\xC7\x97\x8C" +
                "I\xEC\xC2\xC4x\xF8\xCBR\x8B\x0E\xF9V\xD2\xF6\x15\xD3Z\xDB\xAD\xCBhvD1\xFC\xF8\xAB\x1B\xE3\x9E\xED3G" +
                "\x88\x09'\x1F-\x0E\xC2\xFEWL{<\x19\x91\x10\xDA\x94\xE6\xD7\xD5\x03xe\xBCr\xCAj\xDA\xF1\x00\x00\x00" +
                "\x00IEND\xAEB`\x82" },
            title_mark: { w: 45, h: 11, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00-\x00\x00\x00\x0B\x08\x06\x00\x00\x00\xEB\xEF" +
                "\x04\xB1\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05" +
                "\x00\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x01bIDATHK\xD5T\xD1M\xC30" +
                "\x10\xED\x00,\xC0\x02,\xC0\x02L\xC0\x1F*v\xD8\x80\x0D\xB2\x02+t\x82J .\xC0\x04Y\x01\xB5M\x96\x01\xBD" +
                "\xB3_z\xB9\xD8\xE9w\x9FtR\xEC{\xF6=\xBF\x9C\xBD\xD9\\+\x86.\xFE!\x8E_\xCD\x83\x9D\xFF\xDD?\xDD0g\xE7" +
                "=\x06\x89#8\xE0\xFB\x1C\xC1}\xA6\x90\xD0z\x0E\x81\xFC\xA9\x8B\xAF\xF8V\x0D\x12\xC7\x93\x84\x8F\x05I" +
                "\x89\x12\xDE\xEC\xFC\xF1\xB3y\xBC$\x1A\x07U\xD1\x12G\xF0}\x9E\xB0B\x0E?\xDB\xBBT\xEF\xF9\xC5\xF3\x00" +
                "\xCB\x85\xA6\xA2!\xE9\xE4\xB1\xF7\xC9\xA1\x0B\xBB\x14u\xD1\xBA\xA9\x84V\xA3\x0B;\x9F'\xAC\x10\x00" +
                "\xCE\xD9\xB1\x05\xB9j\x08:\xE0;\xDE{\xCEDRBv\xEB\xF0\xDE\xDC\xEA8/\xF4k\x08\xE4\xE0\x1C\xDD[8\x92aEC" +
                "DU\x0C\xB9\xD9\xE1\xDA\xDF8\x8B\x96\xD0\xB2w@\x86s,\xE0\xD7\x00l\x0D\x8E\xD7Z\x04{\xD8\xA8\x09\x06," +
                "\xAFf\xC2$\x9An\xA9\xCBY\xC0\x9Ah\xBA1\x8Fr\x8BL5\xF2\xDE\x97.bj\xB9\xC2\x05$\xB8\xA1~K\xEC)\x06\xE3" +
                "\x9Ah\xBE,\xD6\xB1\xB5\x16\xB15x\xC1\xC1\xF7<\xC0\x9BX\xEC}\x9BHmq~Ij\xA2Y\xD8\xCF\xA7\xB5\xCB>\xF4" +
                "\xC5\xD7\\\x9C\xE9\xE1]\xF3\xEDdIt\x90.\xD4D\xA3\x0DJE\xF5\xB5\x91\xD8/\xE7\xE7\xA2y\xE8\x85\x98\x02" +
                "\xB7\xF4\xB2]\x1D\xFE\x01\x1D\xDE\xDF\xDF\x1ADu\xA4\x00\x00\x00\x00IEND\xAEB`\x82" },
            title_amount: { w: 70, h: 11, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00F\x00\x00\x00\x0B\x08\x06\x00\x00\x00\xC2\xE8" +
                "\xFB6\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05\x00" +
                "\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x01\xC4IDATHK\xEDV\xD1M\x031" +
                "\x0C\xED\x00,\xC0\x02,\xC0\x02L\xD0?D\x93\xEB\x06l\xD0\x15X\xA1\x13 \x81\x9A\x02\x13t\x05\xD4^o\x99" +
                "\xA2\xE7\xDC\x0B\xC6\xE7\\Q\x8B\xF8\xEA\x93\"zN\xEC<\xBF81\x93\xC9\x05\xBF\xC3>\xC5n\xBF\x8E\x87\xCF" +
                "\xE7\xFB+;G`\x1Ec\xF7\xD6\xDCi;|8\xA7\xED\x1A\xED:>r\x0F\x0C|\xDB5\x84\xEC\xF1\x1Eo\xAD\xAD\xE6\xC3" +
                "\x98\x9A;\xFC\xBD8m\x0A\xAF\\\xAF\x87\x1B\x1B\x89\x0A\xE9\x14\xBB\xDD\xAA\x99\xDAy\xA2\x04I\xE1I\xDB" +
                "\xE13&\xCC>\x85\x85&)\xA4S\xDC\xD88\x84\x97P\x95\xBC\xE2\x85}h\xAB\x09C\xC8AU\xF8\x16\x80\xA0\x90" +
                "\x97\x04\xC2\xD2\xCE\x13y\xF3\xB8\xC1_}:\xF0\xC9c\xB8\xD1\xF6\xA5\xB9\x16\x82\xA6\xCAH|\xFB\xF1p\xA3" +
                "\xED\x80\x97\xD01aX\x09\x8C\xF7'\xC20 \x86MZ\x83\xE4d\xC3\xBE\xB2t\xE2\xDEFm\x9A\xCD=;\x90\x13\x9A" +
                "\xCD=\xBBM\xE8\xA80\xC2+,!\x10lg\x0B\xC3k\xC4\xEF\xB1\xEBT\x08\xA4\xB0 \x81\x9CxX\x92\x88\xF5\x19#PK" +
                "\xD6K\xA8\xB6\x16\xE0\\9\xA4U3=[\x18\xB9F\x83\xC7\xC8\xBFN\x85@_YB\xA4\x17\xB2*\xCC?V\x0C~\x97\x8A" +
                "\xEE+\xD8\xC6!F\x85a7\xD1\xCEc\xD7I\x13\xE0\xE3\xC9\xE05a\x18\xCF\x12\xE4z\x88\xAB\xED\x80'\x98\xC48" +
                "R\xC9\xE5;7\x12y\x0B\xED\xBE\xC4\xA80\xEC&\xD6\xEE\x11+v\x9EL_\x09\xEC,5a\x00\x0AH\x92\xB2\x16\xC4U" +
                "\x17\xD1\xC8\xCD v\x14\x8DIx\x87\x05Xa\xC8\xE5da\xF4ce\xED >\xB4\x7F\x13`\xB5\xD9.`}\x08!\xC2\xFFcR" +
                "\xECj\xD7\x02@\xEC\x1FW<\xC5\x8D\xD7\xBD\x08+L\xB6\xE5.y\x920\x17\x0C\xF1\x05\xEFH\xACLG\xC1~R\x00" +
                "\x00\x00\x00IEND\xAEB`\x82" },
            footer: { w: 112, h: 12, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00p\x00\x00\x00\x0C\x08\x06\x00\x00\x00\xBA\x00" +
                "9\xF1\x00\x00\x00\x01sRGB\x00\xAE\xCE\x1C\xE9\x00\x00\x00\x04gAMA\x00\x00\xB1\x8F\x0B\xFCa\x05\x00" +
                "\x00\x00\x09pHYs\x00\x00\x0E\xC3\x00\x00\x0E\xC3\x01\xC7o\xA8d\x00\x00\x02\x97IDATXG\xEDW\xC1m\xDB@" +
                "\x10t\x01j\xC0\x0D\xA8\x01\x15\x10\xFFd\xC2@*p\x07\xEA@\x88\xC4O`\x8A\xC8\xD7\x8F<D\xC6F\x00Q\xF1CM" +
                "\xA8\x03K\xF0C\xCD\xD8\x98\xD5\xEEy5\xBCPt\"\x036\xC0\x01\x88\xD3\xDE\xDC\xED\x1Dwn\x97\xA7\xB3\xB3" +
                "\x0E\x1D\xFE\x86iV\x8C\xA6\xB3r\xC5\xFDm1\xC9\xEE\x06\xD3\xBC|\xE6\xFE\xF7\xC0S\x95\xF4\xB7\xCB\xE4y" +
                "\xBBL~0\xE7\xB1]$\xA3\xED2\xF9\xE7wz\xFA=<\xC7:h\x99k\x8B\xC7\x87\xAB\x01|p\xFF\xC9\xF1\x99\x04\xDCT" +
                "\xC9\x18\xC2\x1C\x0B\xCC\xFF\x0Ax\x0A\xD4\x04\xB4@M\xF2r\x8C\x16A\x97\xBEY\xB1\x83\x9D\xE6\xF3\xAF" +
                "\xDE\xC1$/\xE72.\xC2\x89h\xCA\xC98\x12\x10\xE3\x1D?\xF6\x1C\xC3\xF6\xF5-+\xAEc\xEB\xC9>\x9D\x8FI^" +
                "\xAE168x\x036\xCB\xCB\x9D\x05fS\x0D/<\xA7\xA2!;\xF1\xCC\xBD\x80\xAFs\xE4\x00\x80_\xA1\x0F\xFE\xC4^" +
                "\x0C\x0F\xE2\xC3\xC17\x1B\x99\xEF\xFBu\x9D\xFD\x9AG|\x84@!8iz\xDB\x83p\x08\x06~K\xF0f\xC5\xCE;Ho\xEE" +
                "\xFB\xD2f\xBF.|\x86\x84\x83\x90\xDD\x0D\xF6~\xCA\x95\x17\x10\xFD\xE6\xD7\xD6\x81\x0F\xE3\x19~_b\xEB" +
                "\x013^\x0E\x83\xEEm\xFC\xFD\xE798\xB4\xDEG\x1B@0\x0B\x88\x062\x94Q\x0B\x96\xB4\x0F_z\x9A\xA55\x01" +
                "\x11d\xF0\x10nS%k\xFC~\xFCsy\x0D\xDB\xC6\xFA\xF1lc\xAC\x1F\x87\x92\x8E\xD6\xEF\xCD\xC0>j\xA5J\x02" +
                "\x9F\x15\xA3\x18'\xBC\x96F\xCB\x0A\xEEo\xB4uNxt\x9D\x18xm\x7F@`\xCB!\x80\xC07\xF7}\x88\x89\x8C?p\xD0" +
                "\x12^4\x0B\x18\x04\x10\x8EJ&\xDB\x1CL\x11x\x91\xC8;1\x17\xEBc\xDB`\xEBX\x16z\xAE6\x87\x03\xD5$ 2\x12" +
                "Y$\xD9\xC4\xF3b\x82\xB1\x9D\x17\x8D\x97\x04\x0F\xF6\x1F2R+\x00\x00\x7F\xBA\xA79\x97\xF3\xB6\xB0 \x1D" +
                "<Z\xB6X0\xB69\x98\xA7\x10P2\xB7J\xD6\xE0\xA2<\xF7q\xA0\x9A\x04D\xBF\x9Dt\xCB(\xE3\xEC\xFB&\x19\x91" +
                "\xDE\xF6 \xB4\x17\xD0J\xAE\x17\xA0\x09\\B!V\xAD\x9C\xC3\xA7V\x03\xAC\xE9\xB96\x90\xD2G\x01\xD2\x8C" +
                "\x94w4^n\xA9(\x91(\x8F\xEF,\xA0\x1E\x12]\x7F\xFF\xFD\xF5|mNM\xA4\x06\x01\xE5[\xA3\x97\x1B\x09(\x95" +
                "\xD7\xD7\x8B\x90|Gk\x97\x98\xC0\xEB\x18\xCF1B\xC9t>c\xE2\xDB^\xB8\xBF\x0D\xF4\xB2p0\x97\xCB\xA8]P" +
                "\xF4b\x12\xBD\xC4\x98}\x0A\x01\xF1\x17#\\\x82\xE8r\x03\xC4\xE6|Z@P\xC9\xBE\x86\xCBP\x87\x0F\x0A+\x9D" +
                "\xC7\xFE\x8Et\xE8\xF0a\xF1\x02\xD7\xD6Uxe\xD859\x00\x00\x00\x00IEND\xAEB`\x82" },
            glass: { w: 360, h: 640, png:
                "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x01h\x00\x00\x02\x80\x08\x02\x00\x00\x00>xu\xF0" +
                "\x00\x00\x86BIDATx\xDA\xEC\xBD\x87r\x1CI\x96\xB4\x9BOp\x07U\xD0\xB2 \x08\x12\x04\xA8\x00BSk\x0Dj\xB2" +
                "\xD9\xBA\xA7{fw\xFF\xF7\x7F\x80K\xA2DFF\x1C\x19\"+\x0B\x08\xB34\xBF>\xB4^\xB0\xFA\xBF\x13\x9E\xDF" +
                "\xF1\x13\x85)\xAE<\xF8\x9F\xAB\x0F\xFF\xF7\xEA\x83\xFF\xFD\xAEWN\xF5\xF4\xF9\xBF\x81^+\xFD\xFF]{\xC4" +
                "\xE8\xE9\xF3\xFFN\xFD\xFF\xEBz\x89:\xFF\xB7\xEC\xDFU\xF9\x84\x83\xA7\xF7\xF9{\xFF.\xFF\xF3\xDD\x0C" +
                "\xB4|\xEE\x97\xBAu\xFF\xBF=\xBD\xDF\xD5\xFF\xF6\xF4\xDE\x7F\xB6*\xFA\x9F\x1Fz\xEF?\x9B\xA6\xDE\xFDg" +
                "\xD3\xD4\xFEs\xF9\xEE\xDF\xA5\xDE\xF9\xFB\xBB\xE9\xEB\xBF\x7F\x98S\xDD\xF8\xA1\xFF\xEE\xE9mS\xFF\xFA" +
                "n\x0C\xFDk\xE3\xD6\x0F\xBDt\xEBOS\xCB\xE7\xB8\xAB\x7F|\xD7\x8B\x03=\xFE\xE3\xA2\xF9\x1C\xFD>\xD0\xF5" +
                "\xEFz\xF4{U\x7F\xFB\xA1\x87\xBF\xAD\xF7\xF4\xB7\x1F\xDA\x7F.\x1C\xFEZ\xEA\xC1\xAF\xDF\x8D\xAD?\x9E_" +
                "\x06\xBA\xB6\xFF]\x7F\x19\xE8\xDA\x0F\xFD\xB9\xA7\xFB=]\xFD\xA1?\xF7t\xEF\x9B\xA9\xAB{]\xAD>\xBB?" +
                "\x0Dt\xA5\xD4\x9F\xBE\xAB\xF1|-\xF5f\xA9\xCB\xDF\xF5\xE6WH\xBF,\x0Ft\xE7\xCB\x0F\xE3hg\xE7\xF3w\x03" +
                "\xE8\xF6\xE7\xEF\x06\xD2O?\xCC\xA9.\xD9\xFA\xA9\xA77*\xBAT\xEA\xC7\x1F\xE6\xBB\x9A\xBE\xA7\xBDg\xD1" +
                "\xD4\xEB\xA6~\xC0t\xD1\xF4\xBD\xC7\xF4AO\xD1;c\xFD\xF3v\xB5\x9A\x1D\xD7Le\xF2\xE2\xFF\xAE)\xF3\x02" +
                "\xD1\xFE\xCF\x84\xF2\xA2\xA7v\xA2\x95\xD9q\xD5\xCA\x8EJ\x82\x00\xD9q\xE54;\xAE\x98\xA9\xD1\xCF\x0E A" +
                "\x9C\xEC\xE8'\xC8?\xA5:\xD9\xB1ifG5A.S\xD9Qy\xCA\xEC\xB8U\xAA\x91 @v\\\x82\xB2\xE3T\x7FD\x86\x9B\x1D" +
                "\x17\xCD\xEC8\x82\xB3\x03H\x90Jv\xFC\x08\x8BR{\x09beG\xE5\xB1\xB2\xA3\x9F \xD2\xEC0\x13d\x15\xC8\x8E" +
                "\xAF\xA5:\xD9\xB1R\xC9\x8E\xAFPvt=\x92 ;\xBD\xD4X6\xB3\xA3\xEB\xB7\xB1\x1C\xF9\x84\xE7\xC8\xC7\xAE.m" +
                "3\x09b\xE6\xC8\x92&G\xF04\xF1\x0A\x8E\xF2\\=\xAC(\x98#\x0E\x83\xFC\xAFq\x9E\xFF/\xAA\x9Ai\x05\xF3" +
                "\x05\x9C\x11\x14k\xFCw\xA0\x00e\x80\xACq\xCFb\x8D\x7F\xAA\xAC\xF1\x0F\xC1\x1A\xDD\xBC\xD8\x04\x93\"" +
                "\x11k\xDC\xFA\xA3\x92\x1A\xB2\xBCX\x17\xE5\xC5\xAF\x035R\xC3`\x8D\x03\x9E5\x88\xBC\xD0\xB2\xC6\xAA" +
                "\x95\x14 k\xEC~-\xB5^\xD6\xE80\xAC\xD1\xCB\x05aR\xF8\xB0\xC6u\xEFtx_\xFAk\xA5_\xE8\xF9\xF7\x03_py" +
                "\x01\xA7\xC65;5H\x1EyHs\x04\x9E\x1D(_\xFC\x1F\x9F\x1D\x0FK\xCA\xB8\x8Ae\xC7\x038;\xAEPs\xCA?2\xD6" +
                "\xF8\xDB\x835.\x8BX\xE3\xCFJ\x82\xDC\xFA\xA3\x92 \xC7\xD5\xEC8\x16d\xC7\x11\xCC\x1A\xEB\xA7\xA9\xB1n" +
                "&\xC8a5A\xE4\xACq\xE0\xCB\x1A{?\x0D\x14d\x8DU\x09k\xD8\x09Ra\x8D\x158A>\xD3\xAC\xB1\x0C\xB3F?5v\xDC" +
                "\x1CI\xC4\x1A\x1F\xE4\xDA}\xC2Y\xA3O\x1C\xF7{\x87\xEAjE\xFF\xD7%\x11 Sl\x1E!\xD9\x04\xF1W\x1FrL\xE1" +
                "\xC9\x17vR\\\x01\x92\xE24\x1D\xEEW3\xE2~u\x1E\xE9&\xC5=8)6\xD1\xA9\xC4\xE95\xAC\x8C0\xB4|z\x94\x01" +
                "\xE4\x855\x95\\\xC2\xA6\x12\xA6\xD7\xA0\x93\x02e\x0D\x8B/*y\xB1\xCF'E\xBF\xD1\xF8Y\x90\x14\xDF\x06" +
                "\x19\xB1\x0AQ\x06\xDEk\x18\x19\xE1\xCC#+\x95y\xC4I\x8A\xFE\x03\xA4\xC3\x8E\x99\x0E\xD5\x8C\x00X\xA3" +
                "\x9A\x0B8k\xB0|Q\xCD\x85\x8FQ\x13\xC1e\x8A\x92#\xBA\x7F\xB2 \xD0\x02H\x0D\x9BAL\x05y\xA4|\xE8\xA4" +
                "\xB8&J\x13\xFC\x09\xE0\x0B\xB4\xCB\xB8\xFF\x9F+\x95\xEC\xA8P\xC6\x96\x9D\x1D\xFF\x9C\xB2\xC6 ;\xFE" +
                "\xB6\xB3\xC3b\x8D*_T)\xE3/bB\xB1\xE7\x94\xD3\xC8\xD8\xC0\xB2\x83\xE95~\xAF\xB2\xC6o\x9A^\x83\x99P.@" +
                "\x94q\x01\x9FPB{\x8D]+A\xBE\x82\xAC\xB1\\\xE95\xBE\xB8\x0AN(Hv\x80|\x01\xE5H\xA5\xD7\x18\x16_|p\xD2D" +
                "\x93#\xD7\xDF\xC3z\x0D\xF0E\xE5\\U\x1F M\x1E\x00\x99\"\xE0\x11\x8D7r\xE1*\x9C\x0Ev\xDFy\xD5\xFA\xE4(" +
                "_p{\x13\x905\x80\xA9\xC4\xCA\x8B\xBF\x19\xD6\xB8#e\x8D\x0D_\xD6@{\x8D#8/\xE4\xAC\xB1\xDEM\x8ACO\xD6 " +
                "{\x8Do\x82\xBC\xF8I\xD0kp\xACQ\xF6\x1A_ \xD6\xF8\x1C\x935*y\xF1\x11O\x8A\x8F2\xD6\x10N\x1F\xFA\\\xF0" +
                "a\x8D\xF7\xA6/\xECw2\x91\x1AT^\xFC\x0F\x9C\x05\x92\x07\xC9\x8E\xABDv<\xC4S\x03\xEE2\xFE{\xC5\xAF\xCB" +
                "\x00Y\xE3\xAE'k\\\xB6\xB2\xE36\xB4C\x19*k\x18\xBD\xC6\xAFU\xE2\xF8e\x9D`\x8D\x83*k\xA4\xDB\xA1\x18" +
                "\xD9!\xD8\xA1\xE8X\xA3\x9B \xCB\x1Ck,Gb\x8D\xCE6\xC0\x17\xD8#f\x8D22\x96\xA2\xF2\x85\xDB\x8F\x16\xE5" +
                "Yz\xD0U\x84\xF0\x9DS\x0Au\"(\x9B\xF0\xFA\x00N\x04\x96)D|q\x1F\xE6\x0Bd\x1E\x01\xBB\x0C\xDD\xDE\xE4" +
                "\xB2dor\x1B\xD8\x9B\xD8I\xC1\xB0\xC6iF\x1C\xDBI!\xEB5\xAC\xEE\xB3L\x0Ab*\xA1X\xC3\xDE\x9BH\x92\x02" +
                "\xEC>\xBFI\xF6&\xE2^\x03\xDD\x9B\x10\x19\xB1\x8C\xEFM\xBA\xE9\xC0fD5\x1D\xD0I\xA4\x92\x0B7b\xF1\x85" +
                "\x8A)\xDE;^\xA4\xC5 5\xAE\x94*`\x10`\x8A\xF9\x1F:\x1D\xAE\"\x1E\xE6\x086A\xE0\xEC\xF8/\xCA\x17D\x97q" +
                "\x1F\xCE\x8E-3;\xAA\x13\xCAf\x95/\xBA\xD9\xB1)\xD9\x9B\xDC\x01\xF6&\x1B\xA7\xA9\xB1A'H\x99\x1D\x7FT7" +
                "\xAF\xBF\xA3\xDB\x13\x805~;e\x0D#;\x8E\xC8\xBD\x89xN\xB9\x80O(k\xFBVv|\x1B\xA8\x9D %kp\x13\xCA\xAEho" +
                "B\xB2\x06\xB87\xF9l\xCD)\xDC\xDE\xA4\x97\x1A\x1DnN\xE9\xA7\xC9GgZ\xA9\x81/\xDE\xAB2eQ\x96&\xC5\xE0DY" +
                "'\xCD>\x87\x08\x83\x9C>,\x8F\xFC\x0F\xCB\x11\x8E\xFF\xAF\x90/\xCA\xCF\xE9d\x84\xA0\xCB\xF8\x87d\x0Df" +
                "\x1E\x11\xB0\xC6_\xA3\xC5\x1A\x95^C\xCE\x1Avj\xFC\xC8\x8851k\xD8y\xE1\xCC#\xC4T\x82&\xC5\x0E6\x95X" +
                "\xACQ\xCD\x88\x9E\xFFD$EG\xD6eT&\x91\xED\x8F^\xAC\xE1\xA4\xC3\x8D\xF0\xFE\xE2\xBDN\xAF\xA1\xBE@\xD8" +
                "\x9Ef\x90\x9E\xF7K\x0Aq\x9A\xFC\xF7\xAA\xF1w\x81|q\x85\xE3\x8Bj\x97aM(\xFF\x0C\x94\xDA\x9B\xA8Y\x03" +
                "\xCE\x8E\xD1b\x0D\xA8\xD7\xF8\x85\xDC\xA1x\xB0\xC6Or\xD6\xA8&\xC8W\xF7\xA6\xC6J\x0D\xAC\xB1\x03$\x88" +
                "\x925\xC0\xF8\xF8\xC0\xB1\xC6\x07\x19k\xA8\xFA\x8B\xF7\x0E_\xBC_\xD4dJa\x9C\xA8\xFE\x9B\x19a\x105" +
                "\x8F\xF8\xEB\x7F9\xA6 \xF8\xE2?\xAE\x02dA\xDE\xCB\xA8\xB0\x86\xC5\x17\xC0m\xAE\x7Fo\xC8\x93\x82a\x8D" +
                "?\xAAw\xBA\xFE\xB8\xE4\xDE\x07EY\xE37;)\x8E\xCC\xA4\x90\xF4\x1A\xBF\xC0\xF7A\xAB\xDD\xE7\x05\xF1\xDE" +
                "\x84\x9AJ\xF6|\xF6&U\xD6\xB02\xE2KO\xC1\x8C\xB8\xC9\xEFMP\xD6\x10\xCF#\xD0\xDE\xC4\xDA\xAD~\x18$\x05" +
                "\xC1\x17K\x14_\xB0s\xC7{\x1D_\x94\x1C\xF1\xAE\xE7\x7F\xE8\xBB\x85k\x83?\x81}\xD1=]&\xD5_\xC1\xB3\xE3" +
                "\x0A\xC5#\xFF\x8D\x9B\x1A\x0A\xA6\xA8\xF6\x17\x01|\xE1\xDFeTY\xA3\xB27\xB9l\x07G55n[\x13\x8A\x95\x1D" +
                "\x7F\x82\xD9\xD1O\x90\xDF\xAB\x94\xF1\x9B=\xA1\xF0\xACaoO\xAA\x09\xF2KuN\xF9Y\x90 \xD0\x9Cr\x1A\x19k" +
                "{*\xD6\xF8*\xE85\xBE\xC0\x09\xB2C%\xC82F\x19\xFD9e9\x12_td|\xE1\xE4\xC8\x07P\x11\xBE\x10\xECD<\x98" +
                "\xC2\x9EP\xDE\xB9\xBE\xB0\xF7\x0B\x95w5\xC8 n\xA6\xFC\x07\x9Ct\\^\xC0<\xCE\x11hF\x10|A\xECJ\xD8\xA4" +
                "\xE8\xB5\x18`\x97q\x97\xDF\x9B \xAC\x01\xCD#F^\x08X\xE3\xF7t\xAC\x01\xDD\xD4\xA0\xF2\x02~\xF6\xAC" +
                "\xBC`X\xA3\x9B\x14\xAB5\xB2\x06\xDAk\xC0\xAC\xF1I\x95\x17\xE4$R3k\xF8\xF0\xC5\"\xC7\x17\xAE/\xB0\xB3" +
                "g\xB6\x03W\xF8\xEC\x80x\xA4\xEA\xAF \xDE\xDD\x83\\\xD1d\x07\x92 \xFF\xF4\x14\xBC\x91\x11\xB5\xCB@" +
                "\xEEh\xFCUe\x8D?\x01\xD6\xB8E\xB3\x06\x9C\x1D(k\x00\xC4\x81\xB1\xC6\xAF\x09Y\x03\xEC5\x86\xC3\x1A" +
                "\x9F!\xD6\xF8\x1C\xCE\x1A\x1D\x9C5:<k|\xF0b\x8D\xF7\x1A\xD6\xE8%\x88\x865\\\xA6xG\xFB\xA2w~\x8C\xD3" +
                "\xB5U\xF1\xF8[\xDDI\x99-\xEB<\xDF's\xE7\x9E\xB3\xFB\xB09B\xC0\x14\xF7\x81\xCF,\xE7\x8Bn:\x10\x19\xD1" +
                "O\x8A\x7FS\xF3\x08\xDEe\xD8\xDD'\x98\x14\xDC<r\xC9m=\xD1;]NF\xF4\x93b]\x9C\x14\x9A^\x03\xD8\x9B\x18S" +
                "\x09\x98\x11V\xAF\xF1\x15N\x0A'#V\xA0\xA4X\xC6Xc\x87\x9FG\xD8\xD6\x93\x9DG\xC8\x1B\\2\xBE\xB8\xA1" +
                "\xE5\x8BJ\x7F\xC1g\xC15X]\x8E\x80\xF4\x1D\xED\x8BAjl9\xD9\xD1\x7Fo\x83IQM\x8D\xFB\x126\xF9\x0F\xCF" +
                "\x0E\x10G\\\xA1\x93K\xD0_\xC4\xE0\x8B\xBF\xD9\xEC\xE0\xF6&\x7F\xA2\x13\xCA\xB1M\x19\x97\xA0\xEC\xB8" +
                "\xC4\xEEM\x8E\xE0.\x03\xB8\x0FzX\xDD\x9B\x88\xE6\x94\x9F\x07\x0A6\x1Ak\xD5\x09\x05N\x90\xBDrBY\x1Dd" +
                "\xC7\x9E\xDF\xDE\xE4\x8B5\xA7\xAC@{\x13C)\xBE\xE8\xFBO\xA5\xDA\xAC\xF1\xB1T\x82/\xB6\x81\xEC@r\x04N" +
                "\x90\xA5\x92/\xDE\xE39\xF2\x9E\xE6\x0B\x1DS\\\xD3\xA5L\x958\\E\x19\xA4\x9C\x02\x84<\xE2\xA9\xF7\x8C" +
                "\xB9\x03\xCA5\x96/\xB6\xCCt\x90w\x19w\xC4\xF3\x08\xCC\x1A\x7F\x92\xAC!\xDA\x9B\x90\xAC\xF1\x1B\xC6" +
                "\x1A\x17\xEB`\x0Df\x1EY\x93\xCC#(kXI\x81\xB2\xC6J0k,{\xB2\x061\x89\xF8\xB1\xC6{\x0Dk\x10s\xC7;=k\xB8" +
                "\x1CQ}\xAER\xBE\x80\xF2B\xC0 $\x8FH8E\x99 \xFFX\x09\x82\xF2\x85\xB8\xBF\x80\xE6\x14~B\xB9|\xC7\xA2" +
                "\x8C\xBF\x06ju\x198k\xFC\xA1g\x0D:;\x82Y\xE3\xF0\x97\xD8\xAC\xF1S$\xD6\xE8gG\x02\xD6X\x1Ea\xD6x\xCF" +
                "\xB1\xC6;\xC7\x8B\xF8b\xD1I\x16\xCC\x17\xF0;\xB9<o,\x8F\xFC\x83\xDD\x92\xD8R\xFAMY\x97\x090\x05\x97" +
                "\x0EU\xBE\xA8\xA6Cec\xC2w\x19N\xEB\x09\xDE\xE3R$\x05\xD0z\"{\xD6\x8B\x9E{\x93_\xA0\xA9\x84\xEE>\xF1" +
                "\xA4\xD8\x07\xF6&8k\xFC$`\x8D\xAFp\xF7\xA9\xD9\x9Bt\xD3\x81\xCD\x08\xC1\xDE\x04\xCC\x08boB\xF4\x9D" +
                "\xECV5\x8C/\x04\x13\x87{\xDAY\x8E\x90k\xE1$\xC5\xDF[L^\xB8\xCA\xE4\x02\xA6\x82\x1C\xF9\x07\xC8\x0E G" +
                "\xFEf\x13\xE4r\x85/\xFE-\xE6\x0B\xB0\xCB\xF8\xCB\xB3\xCB(\xF5\x0F;;nE\xDE\x9BT\xE6\x94jv\xACC\xD9" +
                "\xF1=&N\xE7\x14(A$s\x0A\xC8\x1A\xBBv\x82\xACB7A\xFDX\x83\xDD\x9B,{\xEDM:\xA7\xA9\xD1\xD9\xFE(\xDE" +
                "\x9BP|\xB1\x14\x8B/\xAEI\xF8\xC23M\x16\xF5s\xCA\x8F\xE0\xB8l\x9F+\xF3]M0\x08\xC9#w\x91s\xCE\x9C\x7FL" +
                "\xFF\x0E\xE0\x0B\x9F]\xC9e&)\xF0y\xE4\x96M\x19\x1B\xEE$\x12\x935~\xD5\xB0\xC6/\xA3\xC2\x1A+8k\xAC" +
                "\x0C\x895:8k,\x89X\xE3=\x9E\x14\xEF\x93\xB1\x06\x97\x05\x80\xBE\x15\xFA\xC2\x1D\xF8{\x8Fq2\xB7`\x1E" +
                "\xF9\xDB'#<s\xC4\xFD\x0C\xD6\x84\x85> _P\x09\x82g\x87\x7F\x97qK\xD0e\xF0\xAC\xF1\x9B\x95\x1DD\x1B" +
                "\xAAe\x8D\x0Bb\xD6\xE86\x1Ak<k\xFC$`\x8D\xAF\xBE\xBD\xC6g\"A\xFA9\xF2\xA9T;A>\x89Y\xE3#\xA8\x04k," +
                "\xE9Yc\xC9J\x10\x865\xDE\x01\x8A\xA6\x09\xC5\x17\x8Bb\xBEp}\x01\x9D\xA5\xF2-\xEDr\xFE\xA6\x90M\xC2=" +
                "\xF0\xF3\xFF\x86\xE6\x0E\x9C)\x02\xF8\xC2\xE82\xFEDw%\x9A\xA4\x003\xE2\x123\x8FX\x19!\xD8\x9B\x80" +
                "\xAC\x01N%\x16k\xEC\x0F\x92\xE2\x1B\xD3}\xEE\x97\x19\xB16h=\xC1\xEE\xD3\xC9\x88U\xD1\xDE\xC4\xCE\x08" +
                "b*\x11\xB0\x06\xD0z.Q\xF3\x08\xC7\x177\xA2\xF2\xC5u,\x17\x18\xBE\xA0\xA6\x8Ck\x12\x8E\xB0u^\xE9\x0B" +
                "\xF0=L\xE6\x85s\x92\x91\x93\x0F0\x82\x88\x1D\\\x8E\x102\x05\xD3_l\x82\xF1\x11\x9B/\xAA\x09bM(\xBFC" +
                "\x09\xF2{uo\xF2\x1B\xB57\xE9\xE5\xC8\xAF\x17\x15\xD9\xF1\x0B4\xA7\xD0\x13\xCA7H\xE1\xEC\xD0\xEEM\xCA" +
                "\x04\xD9\xB5\xB3\xC3`\x0Dpobe\xC7\xE7R}\xF6&Fv\x88\xF6&$_\xDC\xE0\xF8\xE2F\x02\xBEp\x98bQ\xCA\x14|" +
                "\x8E\xB0ZX\x07\x89g{\xE3\xAC\x02\xEF\x7F\xF2\x843\xE7\x1Fe\x8A\x7Fc;\x91*_\xFC\x9Bi:\xBB\x19q\xE7/tW" +
                "\xC2t\x19\x7F2]\xC6-Q\x97q\xE9t\x18\xB9$\xEE2\xC4\xACAO%\xCC<rA2\x8F$d\x8D/a\xAC!\xDF\xB0\x0E\x9D5" +
                "\xDEs\xAC!\x9C>\x88\xFEB\x97\x0B6S\\5\xFD[\xCC\x17\x9B\xAA\xD4\x90\xF2H\xE4\xA7\xF2\xF7\xCA:\x8BM" +
                "\xFC\x16\x06q\x17\x83\xF8\x8EI\x08k\\\xF4a\x0D\xB8\xD1\xB8\x08v\x19pv\xFCR\x12\x07\x9D\x1De\x82|\xBB" +
                " f\x0D;A\x92\xB0\xC6\xE7\x1AX\xE3\xD4S]F\x07\xC8\x8E\x0F\xDD\x16\x03b\x8D\xF7\x95\x04\x01\xD2\xE4=" +
                "\x90#=}\xA7g\x8Dw\x1Ck\xBCu2%\x82\x16\x1B\xC6{\xB8\xAF\xE8\xB3yW\x9D2\xC1\xFAoY\"\xC0\xB9p\x99I\x87?" +
                "7@\xB5\xF8\xA2T'\x1Dn\xF9\xF2E_\x81\x8C8\xF2\xED2\xC0\xBD\x89r*Y\x95\xDC\xE6\xAA\xB4\x9E_\x07\xCA" +
                "\xEDM\xCA\xD6s\x05k4n\x8A\xF7&\xD5\xEE\xB3\x9B\x0B\xCB\x04_\xD8\xF3\x08\x98\x14\xC4<\xF2a\xE9:\x9E" +
                "\x11\xE8$\x82f\x04\xC9\x17\xEF\xF4|\xA1b\x8A\xB7\xF3\x96\xD7k\xE1\xE4E%;6\x9D\xD40Or\xBD\xEA$\x17" +
                "\x97\x1Dl\x7F\xD1\xCD\x0E(A\xFE\x84\xB3C\xD3e\\\x12\xF3\x85\xA1d\x97!\xDA\x9B\xFCB\xEEM~\xB6)\x03H" +
                "\x90o\xD0\x9C\x82L({v\x82\x18\xAC\xF1\x15\xDA\x9B\x90|\x11co\xB2\x0C'\x88|o\xF2\x81J\x10\x83/\xA8" +
                "\x1Ca\xF9\xE2:\xCC\x17\x8Bv\x9A\xBC\x13\xF1\x852G\x10}[\xE6\xCBU\xDE\x17\xE6Y2\xCFX\xE5\xEC\x09y\x04" +
                "e\x13\x81'\x7F2\x95\x0Bz\xBE\xB8\xCC\xF1\xC5\x06\xC4\x17\xDA{\x19\xB5\xB2\x86doR&\x85\xA2\xFB\\\xC3" +
                "\xBBO\x845J\xD0X\x05\x92\x02d\x8D\xCF\xA5\x92\xAC\x81\xE4\xC5\xD9c\x8Dw8k\xE8\xFB\x8B^7\xF16\x84/@" +
                "\xE2\xE8\xE6\xC5_\xB2\xBC\xF8K\x9E\x14\x9BJ/N\x93\xBF`-\xB3\xE3\xAF\x0DPQ\xBE\xA8\xF4\x17\x1BVv\xDC" +
                "\x86\xF9b\x03\xCB\x8E[\xD5\xD4\xE0Y\xE37\x925~-\x15e\x8D_ \xD6\xF8\x99d\x8DoP\x82X\xAC\xF1\x93\x805" +
                "\xBE\x0AX\xE3\xCB\xAA\x945>WY\xA3\xD2e\xE8Y\xE3#\xA4\x1F\x89\xEC\x80\x12\xA4\xFATr\xE4=\xA0\xBA.\xE3" +
                "\x1D\xC7\x1A\xEF8\xD6\xE8\xF6\x17R\xA6p\xF8\xE2\xAD\xC1\x11:_\xF4\xCF\x8Fy\xAE\xF0\xB3\xD7\x7F\x9FW" +
                "\xD8\xE4\xB6\x935\xE1\xFE6\xC7\x11.S\xDC1>\x7Fp\x7F\x11\x9D/\xD8\x8C\x00[Ob\x1E!\x92\x02j=\x87\xBF7Y" +
                "\xE1\xF7&@R \x19!\xDF\x9Bh\xF8\xE2\x06\xD7w\xB2\xE9\x80\xF0\xC5b\x10_\xB0\xFD\x857S\x9C8^\xAAE%/\xB8" +
                "\xD4\xB8l{\xFC\xFCk\x95\xCF\x11\xF73PL!\xEC/B\xF8\xC2\xE92H\xBE\xA0\xEE\x80\x0A\xBA\x8C\xEE\xC6D\xB7" +
                "7\xF9Y\xB07\xF9\x06\xCF)\x95\x04\xF9\x89\x9AS\x9C\x8DI\xC8\xDE\x04a\x8DO\x03\x85\xF9\xC2goR\xE1\x0Bj" +
                "o\xA2\xE1\x8B%\xAA\xCB\xF0\xE3\x8B\xB7\x8B\x8A\x1C\x113\x85O\xA6T|Qa\xF5\xEA\x19s2\xA5\xCA#L\xCADU" +
                "\x92)\xE0\xCE\x02\xE98\x99\xFE\x02\xD9\x95\x94\x19\x01N\"\xBD\xBC\xF8\x0DL\x8Au\x805\xF8\xA4X\x87" +
                "\xEEe\x10I\x81\xB3\xC67\x01k\x90S\x09\xBE7qX\x03N\x0A\"/V\x14\xAC\x01&\x058\x8F\x0C\x915\xF0\x8C\xE8" +
                "f\x01\x95\x14\xC2\xBD\xE9[\xDF\xFEB@\x13W\xA4\xBE\xD8@N`\xE5\xBD-K\x8A\xCB\x91\xFC\x06\xCB\x14Hg\x11" +
                "\xCE\x17\x1B\xA7\x91\xB1Ag\x078\xA1\xF4\xB3\xE3\x12>\xA1\x80\xD9Av\x19\xBF\x04w\x19\xFDF\xA3\x92 " +
                "\xDF\xCCF\x83\xA0\x8C5hob\xB0\xC6W\x01k|)\x95\xCC\x8E`\xD6\xF8(\xEE5@\xD6\x08\xED24\xAC\xF1N\xC3\x1A" +
                "\xAA\xFE\x02\xE5\x8B\x055S0Zt\xCF\x8F\xFBN\x06\x14k\x0D\xF0\xD3\x1B\xE27\xC0\x14\xB8\x0D\xB7\x98\x14" +
                "S\x10\xE9\x80\xF4\x17\xDDt\xF0\xE3\x0Bi\x97\x01\xF6\x9D\xF6<\xA2\xEC2\xD0\xBD\xC97\xB8\xFB\xE4\xBA" +
                "\x0C\x875\xA0\xA4\xB0)\x03\xCA\x08{o\x02\xB6\x9EFF\xF8\xECM>\x12\x19A\xB5\x9EDF\x10\xE9\xE0\xE4\x82" +
                "\x93\x11B\xBE\x90&\x82\x8C/D\x1C1?\xF8\x13\xDB\x9F\x0C\xFE\x84\xF5\xC5\xE0\xDDK\xE6\xC5\x9FlR\xA4P" +
                "\x9E#|\x98\x82\xE0\x8B\xDF\x01\x8D\xC3\x17Vv\xFC:P0;\xD6\xA1\xEC\x80'\x94\xD3\xA4\xB8 \xBE\x03\x1A}o" +
                "\xB2\x8A\xEFM\xAAs\xCAg\xC1\xDE\x04\xCC\x8EOVv(\xF7&\x1F\xA4\x09r\xA3\xCC\x8E%<A\x96\xC0\x04\xA1r" +
                "\xE4]\x99#A|\xF1\x16V\xAA\xBF\xD0\xF5\x9D\xF29\xA5O\x1C\xB7\x90\xF73\x9B)t\xD6\xF8y\xB1\x9A\x9FP\x94" +
                "\x0E\xC7f\x7F\xF1\xBB\xB2\xBF0U\xC0\x17\xDDI\xC4\xEE2\x80I\x84\xEB2~\x16u\x19\xC4\x86\xD5\xE8>\xD7" +
                "\x98.\x03\x9AG\xE4\xACq3.kXI\x81t\x19\x0Dd\x8DklR\x10\xAC\xF1V\xC3\x1A\xEA,\xE8\xF2B\xD5\x9F\x18\x1C" +
                "\xA1\xD0\xC2J\x8D\x0D /\xFE\x88\x93\x17\xB7\xE3\xE7\x88\xFB\x99\x09\xA6\x10\xF2\x85\xE1\xAD\x04\xF9" +
                "\xAD\xAB\x17\x01\xD6\xF8\x0Db\x8D_\x05]\x86\x91\x1D(e\xFC\x0C%\xC8\xCF\x10k ]F\x855~\xAA\xB2\xC6O" +
                "\xFC\xDEd\xEF4)\xF6\xBE\x0AX\xE3K\xE3Y\x03\x7F`\xD6x\x0F\xEA\xE9\xF3\xAET5k\xBCu\x95M\x10\x985\xCA" +
                "\xFE\xC2\x9B/N<|\xD1;'f\x17h\x9F\xB4?\x1D\xFF'\xCF)\xB7\x1C\"\xC0\x18A\xE2\xD9)C\xCC\x14e:\x1C\xF3" +
                "\xFD\x85\x1F_ \x93\x88\x93\x11\xE2.\x03\x9EG\xB8\xD6\xD3\x9EG\xC0\xA4\xD8\x0B\xEB2v\xF9\x8CX13\xE2" +
                "\xA6\xB8\xCB@[\xCF0\xBE\xB8\x81\xF7\x9D7\xF0I\x84\xEF2x\xBEX\x94M\x1FP\x16\xBC\xD53\x85'G(\x88\xA3" +
                "\xBC\xA7\x00\xBF\x9F\x91\xD4\xB8\xEDp\x0A\xCC,z/J\x90?P\xA68\xE6\x98\xE2\x16\xC1\x14\\\x7F\xD1%\x0B%" +
                "_\\\x84\xF8\xC2\xD0_\x04]\xC6\xCF&e\x90\x13\xCA7a\x97\xE1\xB0\xC6W\xC1\xDE\xE4KW\xC9\xBD\x09\x9A\x1D" +
                "D\x82,\x13|\xD1\xCD\x0E0An\xB89\xF2A\xBC7\x81\xF8\x82J\x90w\x01]\x86\x90/\x00\xA6\xA8\xF2\x85\x8A)\\" +
                "^8\x01\x93\xC5\xCF\x17\xF8\xB92\xCE^\xF5}\xBE\xA1\xD6?\x05\xFE\x0Ff\xB2P1E5\x1D\x84\x19\x81\xF2\xC51" +
                "\x9F\x11\xECV\x95\xE8;\xF1.\x03\xCE\x08\xC1\xDED\x92\x14IY\xE3s\x18k|\x8C\xCF\x1A\xD7\xEBa\x8D\xB7QY" +
                "\x83\x9D5N|Y\xE3M\xC5_Q\xFB\x02;o\xE6]\x86\x0D\xCF\xBC\x88\x93\x1A4SlH\xB2\xA3\xCA\x17\x97\xB0\xEC8" +
                "\xB6\x12D\xC7\x17\x95\x09\x85\xE82\x0EB\xBA\x8Co\xE1]\x06\xCE\x1A_K\x95\xECM|X\xE3\x93\x965\x96\x09" +
                "\xD6\xC0\xBB\x8C\xCEidt\xE4]\xC6\x8D\xF7\xA5\x0E\xA1\xCB\x00Y\xE3D\xC3\x1A0_\xC8YC\xAB\x85\xFB\x06" +
                "\xB6\xCF\x98\xDB\x1A6A\xFB\x9F\xED\xA2\x9C)\x8Eu\xD3G\xED|\xF1\x0B\xDCw\xA6\xE92\xD0\x8C\xE8\xCF#" +
                "\xAB\xEA.\xE3\x0B9\x89\x98\xF7\xB8\xC0\xA4\xA0\xF8\x02\xCE\x08b\x12a\xE7\x11x\xAB\x0AgD7\x17\x16\x87" +
                "\xC3\x17'\x15\xBEP1\xC5\x95\x01Y@>L\x0B /n\xFD~\xC9J\x8D`\xDD@|\xBC\x04\xE1\xB2\xE3\x18d\x0A\xFF\xFE" +
                "\xA2V\xBE\xA8$\xC8\xB7\x81Z\xD9\xD1\xA5\x8C5h6\xF1\xEB2\xAA\xACa%\xC8\xE7\x81\x1A9\"\xE92\xFA\x1B" +
                "\x13h\xE7J$\x08\xD1et4]\xC6\x12\xC7\x17K2\xBEXL\xC2\x17\xAA\xFE\xE2\x84\xED/\xD0\xD9D\x92,\xA4/*\x13" +
                "\xBEy\xBA\x98s\x08\xB2\x89\xCB)\x0A\x0F\xFF\x1C\xD9'\x01s!._\xB0\xBB\x12\xB6\xEF\x84\x93\xC2\xE82" +
                "\xE0\xBC\xB0\x92b\xBF\x9A\x11<k\xC0IA\xCC#\xAB\xF1\xBA\x0C\x8E5\xC8\xA4\x88\xC9\x1ADR\x18]\x86\x9A5" +
                "\xDEB\xAC\xF1\x96\xD6\xEE\xF9_\x90\xF6\x17'2\xD6x\xC3$\x02\xAEs^\xBE@\xF2\xE27&#\xAA\xEF\xF9K0\xA7(=" +
                "\xFE3\xB1\xCF \xCC\x0E\xA0\xB3\xE0\xF8\xE2\"\xC7\x17^\xBB\x92\x9F\xD7\x0FJ\x057&l\x97q\x01\xCF\x8E5" +
                "\xB4\xCB\xF8*\xED2\xA2\xB1\x06\xD2e\x04\xB1Fh\x97A\xB0\xC6\x12\xCA\x1A\xEF\x16\xAD\xEC(Y\xE3-\xC7" +
                "\x1Ao\xF9\x1C\xE9'\xC8\x02?\xAD\x9Ch\xFA\x8B7h\xA6\x04\xB3F\xD7\x17\xF6\xEE\xA0\xA7\xE5Is\xEF5\xD8" +
                "\xE7\xF3\x18c\x16:\x8F\x90\x7F\x92\xFE\xF9\xD0\xE7\x11$\xC2\xAF\x14S\x1C\xD1\xD3\x07\x98\x0B\xDD[" +
                "\x18\xBF@\x19\xF135\x89\xB0\xF3H(_\xE0]\xC6\x9E\xB8\xCB\xE8\xEB2\x97\x11+\x04_\xE0\x19A\xA4\x03\x95" +
                "\x11\xDB\xA1]\x86\x99\x11x\xDF\xC9\xF3\xC5bb\xBE@&\x0E\x1DS\x9Cr\xC1\x1B\xC7\xBF\x99\x8B\xA4\x85{" +
                "\xDE.9\xA9\xA1\xCC\x08I^\x04\xE4\x08\xC4\x11\x82\x04\xF9\x15f\x8AR\x7F\xB5\xB2\xE3\xA2\x99\x1Dx\x82P" +
                "\xD9Q\xE1\x8B\x9F\xA5\xD9\x01w\x19?Az\x9A\x1A\xFB\x92.#\x15_\xE0\x09Ry\xB4|\xD19M\x8A\x0E\x9C ed\x18" +
                "\xAC\xF1\xBE\xD4P\xBEpXC\xCC\x17\x8Bp\x82\x9C\xE8\xF8B\xD4_\xBC\xF1\x9DP\xDED\xF1\x85y~\xEC3f\xBE" +
                "\xB7\x8Fy\xC5Nr\x88G9\x82c\x0A'\x17L\xA6 \xA6\x0F*\x1D\xFC\xFA\x8Bj\x97\xF1M:\x89\xC0\xAC\x01&\xC5Wq" +
                "\x97\xF1\xC5go\xD2M\x8A\x9B\x95.\x03g\x0Dp\x1E\xF9X\x17k\x10I\x01\xB2\xC6;x\x1E\x89\xC1\x1AdF\x9C" +
                "\x80\x19a\xA4\xC3\x1B=k\xA0|\xC1\xB0\xC6\x96\x8F/\x8CS\xF7k\xE5(\"\xA9q\x09\xF5\xBF\x0F\xFE$\xDC\xD3" +
                "\x7F\x17\x92 n\xF6\xFD\x0Aw\x16\x1C_\\\xF4\xE3\x0BvB\xE9\xB1\xC6\xB7\x812\x13\x0A\xC1\x1AN\x8B!\xEE2" +
                "\xAC\xEC\xF8r\xCA\x1A_\xBC\xBB\x8C\x9AX\xA3\xCB\x17 k\\\x8F\xC8\x1A\xEFp\xD6x\x1B\xC0\x1A'8k\x9C\x10" +
                "9b\xF2\xC5\x02F\x19\xB241|\x9C\xA7\x00\xCE\x8F;\xFFc\xE7\xB0\x928\xBF\x82\xEF\x7F_\xCF\xFF\xBD\x15" +
                "\x8E\x80z\x0A_\xA6\xE8mO\x13\xF4\x171\xF9b-^\x97\xE1d\xC4g\xB8\xCB\x80Z\xCF\x0E\x97\x11\xFD\xA4\xD0" +
                "\xF1\x05\xDCz\x12}\xA7\x82/\"v\x19'>|q\x05\xE3\x0B<\x118\xA6\xE08\xE2u\xF9'\x80\xF7\xD1\xA2\x9A\x17=" +
                "\x92\x97e\x04\xA6P\x16\x1C#\x9E\xCB\x0ELU=\x85\x07S\xAC\xB3\xDD\xE7\x81\x99 \xF8#\xE3\x8B\x0Bi\xF8b5" +
                "r\x97\xE1\xC9\x17T\x82\xC0]F\xC9\x17\x9D\x88]F\xA9M\xE2\x8B~v0|Qa\x0A\x11G\x88f\x96-O_\x94\xA7Hp\xEA" +
                "p6\x81\xBCV\xE9\x9F\xA9\xD0\xFE\xF9\xD7t\x16B\xBEX\xC7\xFB\x0B8#d\xBB\x12\x9B5\x88\xAD\xEA\x1E\x9C" +
                "\x14\xABX\x8BAv\x19R\xD6\x80\x92\xA2\xCA\x1A\x1F\xA5I\x01\xB3\x06\x91\x146kt\x93\x02b\x8DwpR\xA0]" +
                "\x06\xD1w\xBE\xED)\xC3\x1A'\x10k\x9C\xB0\x19\x81\xB2\x06\x97\x0E\xB2\xF3\x1F\x87)\xC4\xC4\xD1K\x10a^" +
                "\x98l\xF2\xAB\xF1\xFE\xFFu]<k8\xBE\xFAs\xDC>\xE2H\x91\x1Df\x82@|\xF1\x8B\x8E/\x0Em\xBEXWd\xC7\xB7R" +
                "\xED\x04\xF9\xA9TgW\xE2\xCB\x1A_\xC2\xBA\x8C\xCF\xBE\xAC\x01e\xC7iL,\x83\xF1Q'k\\\xF3f\x8D\xB7\x03uX" +
                "\xE3\x84H\x90\x05,AP\xD6x\xA3a\x8D7\x0A\xD6\xE8\x9E\xF6\xD8\xBEpN\x11\xA9\xEEi4\xDF\xF3\x88\xBF(\xF0" +
                "\xE8\xCF9\x94L\x16L\"\xF4\x98\xE2\x80\xCB\x05\x9E)\xEC\xFEb8|Qv\x192\xBE\x88\xD1e,\x07t\x19\xD4n\x15" +
                "\xBE\xC1ee\xC4{;#n\xC0]\xC6\x12\xB7+\xA9\xB2\x86\x95\x0Ee\x97\xB1\x18\x9F/|\x12\x01\xE7\x8B ^\x98" +
                "\xBB\xF2:\xDC\x17\xD0I#\x93\xC2\xF0\xE2\\\x903\x02\xE6\xA1\x04\xD1p\xC4\xFA\x81\x82)\xF8\x04\x91\xF5" +
                "\x17\xF0]\x8C\x04|\xB1\x1AoWR\xE1\x8BJ\x82\x84u\x19\xDB\x1F\x06\x1A\xC2\x17p\x8E8s\xCA\x92\x84/~x" +
                "\x94/\x16\x87\xC6\x17\xDEL\xF1:\xE9lbia\x9E\"w\xE6G\x9E_u\x9C\xE2\xA9x\x0A \xF3\x854\x17T|\xA1\xEF/." +
                "\xA03H/)\xD6\xA0]\xC9\x1A\xB7+!\xBB\x8C/\x83\xBC\x00\xF9\xC2\x8B5>I\xE7\x11\x05k\x80I\xE1d\xC4\x0D" +
                "\xBC\xCB\xB8\x01w\x19K\\\x97\xB1HO\"u\xB3F\xEA\\\xA0y\xE1\x87v\x1Fo_\x94oc>/|R\xE3\xE2!\xC2,\xD1\x13" +
                "\xE4\x00\x9BM~\xE6\x12\x04\xEF,\x0E\xBE\x85\xF4\x17\x17 \xBEX\xB3\xF8b\x1F\xCE\x8E>k|\x85\xE7\x14i" +
                "\x97\xF1\x19J\x90\xCF\xF1\xBB\x8C\x9D\x8F\x03\xF5\xEA2\xDE\xDB\x09B\xB0\x06\xC2\x17$k\xD8|Q\x17k\xBC" +
                "q\xB5\x92&\xDDG\xC7\x1A\xAFO\xCD\xEB0\xD6x\x1D\xE8\x8B\xF2\xE48[FR\x7F\x01\xBD\xD9#\xAC\x93,\x03\xFC" +
                "3\xC8\xCF\xBC <\xFF\xC8\x96t\x9D\x9D54Lq\xC1f\x8Ao\x0CS\x88\xF8\x02M\x07\x1D_@I\xD1<\xBEp&\x11\xA6" +
                "\xCB@\xD2\x01\xBD\xB5\xD5\xCF\x85\xEB5\xF0\xC5\x9BH|\xF1Z\xDF_\x18\xEF\x7F\x87#\xE6L\x9F\xE6)*\xA9" +
                "\xC1\xE9z\xC5\x1By\xE1\xCE8\x01\x1E\xF8\xF9\xAA\xEC09\"\x8C).\xE0Lq\xC1b\x0Ad?\xB2\xC6\xF5\x17%_\xA0" +
                "\x09\xF2%\x0A_\xACxv\x19?\x92bY\xCE\x17N\x97\xD1\xE1\x12\xA4\xC3w\x19\xEF\xA8\x04A\xF9\xA2?\xA7D\xE8" +
                "2N\xA2\xF2E\\\xA6x\x0D\xA6\x09\xA6\x81\x13J\x858\xCCg\x1D\xF3\xC0iT\x9E\xE4\x10%S\x80b\x0A$\x17\x9C" +
                "\x8C\xF8&\xE3\x8B\xD3\xA4\xB0;\xCE\x9F\\E3\xC2\xBE\xF7\x89\xEEJV!\xBE@ZO;)\xA0y\xE4\x130\x89(X\x03L" +
                "\x8A2#\xD4]FR\xD6\x90v\x19'\\RH3\xA2\xCA\x1Ao\xF4\xAC\xA1\xE0\x0B:\x05\x9C\xE7U\"_\xB8'\x10P\xF7\xF4" +
                "\x0EK\x91\x04!\xD3\xC4\xC9\x8E\x83o\xE1|\xC1\xF4\x17\xF6\xAE\xE4+\x94 _OY\x03\x9CP\xBE@\xAC\xD1O\x0D" +
                "\xCF.\xE3\x13\x94 \x9F\x94s\x0A\x9E 7$\xAC\x01v\x19\xEF]\xCA Y\xE3\xDD@e]\xC6\xDB\x05L\xAF\x9E\x08" +
                "\x13d\x01\xCB\x8E\xABop\xD6xc\xB3\x06\xFC\xBC\xA6X\xA3\x19|\xE1\xFAb\x0Dy\x0F\x03g\xCC=\x87\xB5>\xFC" +
                "\xF9G\xB2\x80j1a\xA6\x10\xEFD\xFA\xFE+\x9C\x0ED\x7F\xA1\xE3\x8B\xCFD:\xF0|q3\x0A_|\xF4\xE3\x8B\x0E" +
                "\xC7\x17K\xDE|q\x9D\xEF2\x16k\xE2\x0B6\x17\xD8\xB9\x03N\x04\x84)\\\x16\xA8[\x0BA^|s\xF2\xE2\x9Bh\xBA" +
                "\x89\xE4\x91\xBF\x17\xF9\x9Cp\x8E\xF4R#.S\xACqL\xE1\xF2E\xA5\xB90\xF9\x82\xBC\x8B\xD1\xCD\x0E6A\xC2" +
                "\xF9\xC2\xAF\xCB\xE8p|Qe\x8D\x04|Qa\x8D\xB7x\x97\x91\x9C/\xD8\xFE\xC2\xCD\x11\x87/\x04LA\xB1\xC0\xAB" +
                "\xF9Z2\xA5\xB0OQ\xE5\x8C\xFD\xECx\x9CMD\xCC\"<\xE7L\x1F\xE1\xF8o0S\x1C\xC0\xB9\xE0\xDDY0|\xB1w:w\xEC" +
                "A\xD3G\xB5\xE9\x04\xF8\x02\xDA\x95@I\xF1Y\xD8w\x92I\xF1q\xA0\xB5t\x19\xEF\xDD\xBC \xBB\x8C~RH\xBB" +
                "\x8C\xB7D\xDF\xE9\xC5\x1AhF\xA8\x9AN\xB2\xE3|\xAD\xE9/\"\xF1\xC5fL_X\xA7\xCE8\x87\xBDwu\x84\\\x08" +
                "\xF1\x94~\xF3f\x0A\x9C/~\x8A\xC2\x17kX\x7F\xB1\x07\xF4\x17\xABPv\x98\xFD\xC5\xAA\xC9\x17\xD5\x04\xF1" +
                "e\x0D0;\xCA\xD4\xE8}\xC7d\x07\xCF\x8E\x1F\xFEC\x972\xD8.\xA3\x93\xB2\xCBpXC\xDEe\x9C\x04\xB0\xC6\x1B" +
                "\x19k\xBC\x06\x95d\x8D\xD7\x1Ck\xBCr\xF8b\x08\xD3J\x01\xCE\xF6\xC6\xB9\xFA\xE6xH\x0F\x12{\xF8\xFC" +
                "\x7F\xE3R\xC0\xE5\x88\x1A\x99\x82\xE0\x0B\xA8\xBF\x10\xF3\xC5'\xE5$\x92\x9C/\xECI\x04\xE1\x8B%\x09_" +
                "\\g\xBB\x8Ch|\xB1\xC0\xF3\xC5\x1B\x8E/\x8C\xF3O\xF5\x9A\xD2\x89\xC3\x97#\xBA\xCF\xEB\xD9\xAE?\xD5" +
                "\xD4\xBE\xC0\xDE\xC3Lv\xD0\xA7\x1Dz\xFFK\xBC&A~\xA29\xE2\x02\xD8S\xEC\xE3\x1C\xE12\xC5\x0F\x1F\xCA" +
                "\x14\xAB6S@\x13J55V\xF1\x06\xB4\x92\x1D7?y\xF3\xC5\xB2\xC5\x17;8_l+\xF8b\x18]\x86\x96/N\x02\xF8\xE2M" +
                "\x08_\xD4\xCE\x14\xAF*~3\xB2/\x9C\x93\xD3\x7F'W\xCF\x1B\xF6>\xBF\x90L\xF9\xBF\xD7\xFE\x9C?\xC9\xB5{" +
                "\xFE\xD7$\x13\x07\xCB\x17{\x1C_\x00\x19A\xF5\x17\xE2\x19\xE4\xD3@\xE1\xC7\xEE;\xC1I\xE4\x03\x9C\x14`" +
                "Fl\xBB\xE9\xC0\xB2\xC6\xBBS\xFFN\xDCe\xBC\x05&\x11\xAA\xCB8A\x93\xE2*\x90\x14\xC2\xBEs\xDEL\x0A\xB6" +
                "\xE3\xB43B\xD5nz\xF3E\xEF\xCD_\x0F_\xB8\xBE\xB0S\xA3\xFFN\xAE'\x1D\xE2%\xCBO:\xA6\xE8\xD2\x04\xCB" +
                "\x148_\xACa|\xB1W\xE1\x8BU.;\x84\x09B\xCE)D\x82\xC8\xBA\x0CnWR\xCD\x91\xF7n\x82\x90\xAC\xD1\xCF\x8E" +
                "\xEB&k\xBC\x03\x15\xE7\x0BS\xAD\x049\x09`\x0DfW\xB2\xE0&\xC8U\x86/\x0C\x15\xDE\xB9x\xE5\xB0\xC6+\x19" +
                "k\xBC\"\xF9\xE2UR_\x94\xEF\xDE\xF2=\xDC\x7F'k\xDE\xE1\xC3R\xFB3+8\xE2\xA7\xDE\xF9\x0F`\x0A\xA2\xD7" +
                "\x14\xF6\x17\xC2\x19d\x19N\x872\x17j\xE0\x0B\xB6\xCBX\x0A\xE4\x0B\xBE\xCB8Q\xA5\x83\xB2\xCB@\xEFe" +
                "\x09\xF8\x82\xCA\x85\xDE~$6S@\xFA\xB26_X\xF3\xFCZ%/F#;\xCA\xCF\xB9\x07p\xC4\x9Ad\x12\x112\x05\xD3_|" +
                "\x81\xEEw\x82\xFD\xC5\xE9\xB3\x0B\xCE&\x9FN\xCD'1_|\x04\x15\xE7\x8B\x0F\xCBhvD\xE5\x8B\x1B\xC1|q\x9D" +
                "\xE0\x0B A\x16e|\xB1\x10\x95/\x8C\xFD\x88\xAA\xBF\xF0b\x0A$S\x862\xB3\x14\x08\x99\xA3j\x9F\xC9}\x91_" +
                "C\xBC\xEE\xE7\x089\xC2M\x84=,\x11\xF0\\\xF0\xE2\x0B\xD5\xF4\xD1#\x8B\x9B\x9F|\xFA\x0B;#\xE0\xA6\xD3" +
                "\x98D\x9C\xA6\x93\xE8;\xB7a\xBE\xE8\xD0}\xE7u\x935\xA0\xA4\xA0\xBA\x8C\xB7\xC2\xBES\xDCe8\x19q\x15m:" +
                "\x17\xAE\xCA;\xCE\xD7z\xD6\x10\xA6\xC3+\x19k\xB8\xEF\x7FN7\x93\xF8\x82H\x0D\xF8\xBD\x8D\xA7\x00\xAE?" +
                "\x09\xFCW\xABw\xC0\xBC\x98#p\xA6\x00\xF8\x02O\x8D~g\xB1Jg\xC7.\x90\x1D\xFD\x04A\xF9bE\xCD\x17\xEC" +
                "\x9CB$\xC8\x87e\xD9\xAE\x84`\x8D2A\xD8.\xE3\xBA\x1Fk\xBC\xC5s\x04d\x0D'5Jod\xC7UfW\xE2\xB0\x86\xB4" +
                "\xBF\xE0X\xA3\xC7\x172\xD6\xC0\x1F\x11k\xBC\xAC\xD3\x17\xE5\xDDg\xE3\x1E\xB4\xFB~\xA6\xCE\xDE^2\xC5" +
                "\xFF^\xE4s~Qq\x04\x9A\x05\\\x97\xA9j4\x05;T\xAE\xBFh _\xDC\x08\xE6\x8B\xEB\xA3\xC2\x17d.x'\x82\x07S" +
                "\xD0,\x00\xE8\xCBt\xBE\xE8\x9E%\xF3\xDD;\x9C\x8C\x08\xCF\x14\xF3\xF3W<\x91 _\xDC\x04\x81r\xE4\xB3" +
                "\x8C)\xB8\x9D\x08\xCC\x17\x9F@%\xB2\xA36\xBE\xE8\xC8\xF9\xE2F}|\xB1(\xE3\x8B\x85\xF8|\xF1\xA3\xA4P" +
                "\xF0\xC5\x96\x9B&\xAF\xD04A\xE7\x14\xF7\x9D?\xCC\x09e\xE0\x0B\x98\xCC\xC5\xBAfsJ\\\xAF\xD1]&\x11V" +
                "\x14|\xF1\xB9!|\xD1M\x87e\x82/\x8C]\xC92\xBE+\xB1\xFB\xCE\xE8\xBB\x92\x0Ak\xBCe\x93\x82\xCD\x08\xB6" +
                "\xE9\x14\xF4\x9D kP\xE9Pa\x0Dbo\x8A\xA4\xC3\x1C\x91\x0E\xE2\\\x90\xA6\x00\xCA\x025i\xA1L\x07\xD7\xF7" +
                "\xCE\xB9\xD4\xEF)\xFFy\xEE3\xAC\x861\x05z\xCFb\xF73\xCD\x17\xAB\xBBl|\xA8\xF9b\x85\xE0\x8B\x1D\x05_," +
                "[|\xB1-\xDC\x95\x08\xF8\xA2\xC2\x1A\xEF\x88\xEC\x80\x12\xE4m\xA96k\xA0\xD9!H\x10\xB0\xCBxCP\x06\xC7" +
                "\x1A\xAFe\xAC\xF1\x0A\xD00\xBE\x98k*_\xB8\xBE\xE8\x9F\x13\xF8\x0D\xBCJz\xE4d\x1A~O\xE9\xA1\x13\xBE*" +
                "\xF8<(;\xC88B\xD0b\x9AY\xC0\xEEM\x89t\xE0\xFB\x0B\x88/>P\xD3\x07;\x83\x10\xE9 \xE0\x8B\xA5!\xF3\x051" +
                "\x83\xBC\x09\xE6\x0Bq.\xF8\xF7\x17\x1EL\xC1s\xC4\xEC\xB0}!\xCB\x05\xF2\xD9\xFB\x9A\xD6s\x0F\x9E)\x9F" +
                "\xE5\x1C\xB1\xDA\xE3\x08\xE1\x1E\x84e\x0A'Av$\xFD\xC5\xC7e\";\x90\x04Y\x86\xFA\x8B\x11\xE3\x8Bk\xE9" +
                "\xF8\xE2\xB50A\xA49\x82\xB6\xA1\xAF$92\xE7p\xC4\\\xBC4\xA9S\x0B\xE2m\x0C\x9F7\xF7L\xEE\xFA3\x0B\xCA" +
                "\x0B\xD8\xCF\xE7\xCF?\x9F\x08\x95)cW1k\x18\xFE\x13\xC7\x17\x1F\x03\xFA\x8B~:\x00I\xF1A:\x83HY\xE3" +
                "\x1D\xA8x\xD3\xF9\xB6TAR\x90\xACa4\x9D2\xD6\x00w%\x0B6_\xE8XcN\xC7\x1A\xEC\xAET6kD\xE5\x8B\xD3\xE7E" +
                "\xE9/\xD7\xE1\x0B2#>\x83gx\x15\xF0\xAA\xB9F\xC1\x0B\x98\x07>g\x92\x04\xF9\x04*;\x95t\xDB\x0A\x0F\xBE" +
                "X\xC6\xF9\x02N\x10\x805\xDE\x0F\xD4H\x90\xF7\xA0\x12\xD9\x81\xB3F%;bt\x19D\x82\xBC\x01\xD5\xD8\xB9jY" +
                "\xA3\xD2_\xCCoa\xAC!\xEA/\xE6i\xD0\xA8\xE6\x88\x805^\xDAi\xB2\xF5\xB2!|\x01\x13\x07pr\x0C\xBFjp{\xD5" +
                "\x7F\xB1\xFCj\xC5\x87(\xFC\xF3\xDD\xCF\xB0\xA2c\x07\x87#\xF4=E$\xA6`\xFA\x8Be\xBC\xBF\x80s\x81H\x87" +
                "\xEBu\xF2\xC5\x09\xAC^|\xB1 \xE2\x0BA:\\\x91\xF5\x9A\xC2\xE9\x03\xE0\x0Bn\xEE\xD8t\x12A\xC0\x14\xC8;" +
                "\xFFE\xE9\x87\xAAE%\x1D\x90\xA4XE\xD3!VR\xF0\x09\x02\xF9\xCF ;\xACj\xBA\x09d\x1E\xF9$K\x90\x8F\xDCN" +
                "\xE4c@\x7F\xF1\xE1\xD4\x83\xB3\xC9{k6\xE9\x0C\xE6\x11O\xBExWj(_\x9C\xC4\xE6\x8B7\xC1|\xF1\x1A\xE3" +
                "\x8B\xB9p\xBE\xE8\xE6\x85\x93#s\xB1\x99\xA2\x9B\x1A\xA4\xEF\x9D\xEAz|\x81\x9D\xA2\xAA\xBAg\x0Fzv\x13" +
                "x\xFD\xF9g\x98\xE2\xA6\x9C)\xCCF\xF3#5q |Q\x9D;>J\xA7\x0F6#\x04\xFDE\x87\x9B>\x96d|\xB1\x84\xF1\xC5u" +
                "\xF9>\x15L\x0Ad\x06\xE9\xA6\x03\x97\x11|\xD3)\xCC\x88J\xD3\xC9M\x1Fd.\xCC\x11\xE9@\xE9\x8BY\xDB\xBFh" +
                " _`\xC4\xA1\xC9\x0B\xE4\xDD\xBE*\x9AnHO\xFEL\xE3\xEF\xFD\xE4\x9D#+\x0ES\xAC(\x12\xE4\xA3\x99 8_|\x84" +
                "\xF8\xE2\x03\xCD\x17\xCB\x16_l\xC3\xD9\xE1\xD1_td\xFD\xC5R%;\x8C]\x89\xCD\x1AL\x7F\xB1h\xCF)'Vv,\x9A" +
                "\xD9\x81'\xC8\x82\x86/\x16\xAE\xC8X\x83\xE5\x8B\x9E\xB7\x13d\xDE3G\x02;\x0B5S\xCC\xD6\xE8\x0B\xC1" +
                "\xBB\xB7\xF7~F\xF6\x0B\x90\x17Q\x0C\xC5\x05\xD8.C\xB3\xD7\xC0\xE7\x0B\x87#Vv$L\xF1Q\xC7\x14;\\\xA3" +
                "\xC9\xF6\x17\xC2\xE9C\xD0_\x84\xF2\x053\x83\x10\xE9\xE0\xC7\x17\xAF}\xF8\x82\xEB/t\xED&?w\x08\x13!" +
                "\x90)^8\xBE\x11Z\x80\xA7\xAB\xF2N\xB6\xFD\xF0\x14\xFE<\xFD\xCF\xAC\xCA\x0E5GT{\x0A\x84)\xE0\x9D\xC8" +
                "\x8E\xC9\x14x\x7F\xE1dG\xA9\xDD\xA4\xA8\xA5\xBF\x18\x1D\xBE\xC0\x9F0\xBE0\x9E\x97\xA5J\xF9B\xCA\x11s" +
                "\x16Gl\x92\xEC\xC0\xA7I\xDD\xBE\x18\x9C\x1C\xF3=\xAC|\x877A\xAB\x9F_\x94\x088S\x08w\xA5\x82\xCEbY" +
                "\xB37\xED\xC8\xF8B\xD4_\xDC\xE02\xE2:\x94\x0E\xF8\xAEdQ\xB6+Y\xE4\xD2A\x98\x11|\xD3\xA9c\x0Dn\xFA" +
                "\xD8\x843\x02\xE9/\xA4\xB9P&\x82\x8E/D:3T_\x18I\xF1\x11x'kt%\x81_\xF6\xE0\x08\xF3\xDFh\xC7\xF1;n\x9A" +
                "|\x94\xF4\x14\xCBDv\x08:\x0Br?b)\xCF\x17\x1D\xB4\xBF\xA8\xF0\xC5\x12\xD0_\xBC\xC5w%D\x82(\xF8\xA2" +
                "\x9B\x1D\xC2\x04Y\xB8\xCAd\x87\x925^\x0D\x94M\x10'M^\xB292\xE7\xF0\xC5\x1C3\xAD\x00|1Gv\x16\xB2w\xFE" +
                "\xF0\xB5@N\xCE'VW\x86\xE4\x97\xD9i\x02;\xFF*\x8E\xF0H\x04A\x97\xD9\x91$\x82\xC9\x147\xF8\xE9C5\x83 " +
                "\xE9`\xE7\xC2\xA2\x99\x0E\xD7\xD0\xFE\xA2f\xBE\x98\xEB\xE5\x82\x9A/4\xFD\xC5\xCB9u\x7F\xF1\x02\xEE/" +
                "\xBCN\xFE\x8F\xF7\xF9e\xD0?\xFFn\xBA\x7F\xD2\x04_\xB8\xA7N~\x92\x81\xF7y\x0A\xAFH\x16.A\x04\x1C\xB1" +
                "\x1C\x9E \xDD\x8C\xA0\x98\xC2\xBC\x7FA$\xC8\xBB\x8E\x91\x1D\x1DY\x7FA\xF2\xC5[<AN\xFC\xF8b!\x09_\xBC" +
                "F\xF9b\xCB\xCD\x91\x10\xBE`\x99\x82\xED/\x02\x99bT\xB5\xE8\x9F\x9C\x0F\xF6Y\xDA!\xFD\xB0\x9Em\x9E#" +
                "\x96\x9D\x9E\x92\xCA\x022\x11\x96\x89\x9EB\x98\x0BJ\xBE\x10M\x1F\xCA\xFEb\x09\xEF/\x16e\xFD\x859\x83" +
                "\xE0Mg?\x17\x84\x19\xC1N\x1F\xC2\x8C\xE8&\xC2\x95W8k\x08;\xCE\x97s\xA2\xFE\xE2\x05\xD7_('\x8B*ST\xF9" +
                "\xA2\xB9Z\xF0y\x11\xF6\xAC\x00,\xF3\xD1a\x84\x1Ar\xE4\x83\x8C)>8{\x90\x0F\"\xBE\xA0\xB4\xDBY\xBC\x8F" +
                "\xCB\x17\x1E\xFD\xC5\x12\xD7_\x18z\x82\xCF)o\x84\x09bf\xC7\x02\xCE\x17\x0BWl\xD6\x10\xF6\x17\xF3\x8A" +
                "\x04y9o%\x88\x9D#/e\xFD\x05\xC3\x170k\x04\xBE\xE1\x7F<\xCF\x9B\xE6\x0B\xE7\xB4\x90ofH\x97\x13\xFB" +
                "\x8E\x90\x17\xC8\x0D(\xDDM =\xC5{\x8E)\xDE+\x98\xE2\x86\x8C)\xE0\xFE\x82\xC8\x05$\x11\xA0\xFEbQ\xD6_" +
                ",\xBA\xFDE0_\xF0\xEDf7\x0B\x84|\xB1\x85\xF3\x05\xD5k\xBE\xB4\xE7\x8E-\xE9\xDCQ\xE5\x8B@\xA6h:M\xC8" +
                "\x88\xC3L\x0D}.h\xF4#\xE2)\xF5\xCF\x17\x01;\x08z\x8A\xF7)\x98B\xB4\x13\xB1\xFB\x8B\xB7\xA7\xE6->\x9B" +
                "\x10\x09r\x02&\xC8\x82\xC9\x17W9\xBE\xB8\xAA\xE0\x8By\x8A/^\xFB\xEDG\xE6\x074\xA1\xE2\x8BM\x82/^\xCA" +
                "\xF8\xE2\x85\xAC\xBF\x08\xE2\x88\x99\x9E/O&\xE6\x1B\xA2\x05xr\x14\x8A\x9D\xD2X~\xFB\xA3\xC7\xA7\x82" +
                "\x99B\xD0Y\xBA\x89`2E\x99\x11\x82\\H\xC5\x17\xD7+\xE9\xB0\x14\x97/\xD0\xA6\xF3\x8DOFT\x9AN\xBF\x1D*" +
                "\xD5_\xCC3\xFD\xC5K\x985\xCAt\x10\xCC\x1D\xDDs\xBE\xE9w\xCF\"\xF0\xCC?o\xB2/\x12&\xC5\xCE\x07\xC1" +
                "\xAC\xE1\x97&\x1F|\xD3\xE4\xBD7St,\xA6\x80\xF9\xE2\x1D\xAC%_\xBC\x93%\x08\xC2\x17\xD7\x01\xBEpX\xE3" +
                "\x84H\x10a\x7F\xB1\xA8I\x90~\x8E\xBCf\x94H\x90\xDE\x9C\xF2\x0A\xCF\x118A\xE6\x15\xFD\xC5K\x8C5\x84|1" +
                "\xE7\xF0\xC5\x1C\x9F \xCF\x1D\xFF\xDC`\x8D\x91\xE1\x0B\x888\xE83\xB3\x8Dyg\xEF\xB8\xFD\xDEx\xCFG\xF0" +
                "\xC8\xDF\xF5^\x7F\xE6+\xEC`\xA6\x80\x86#X\xA6x\x17\x81)\xAE\x0F\x98\x82\xE8/\xFA\xE7\xDF\x87/\xDE" +
                "\xA8\xF6#\xD2\\\xE0\xDBM6\x17\x88\xE9\xE3\xA5\x86/^\xE2\xFB\x11r\xE2\xD8\xF4k1\xCB\x14\x10\x9F\xF9" +
                "\xE7\x80n8\xBE\xAF3M\xF5\x05\x9D\x17\xCB\xA07\xDF\xDB\x90_\xB6=\xA6\xC0?/\xF8\xF9\xC0g\xD3\xB3\x83" +
                "\x07G\xA8\x98\xE2]z\xA6x\x8B'H/5\xA4\xFDE\x85/\xF0\x87\xDF\x8F\x9C2\xC5\xD5\xD7\xD0\x84\xF2\x8A\xE3" +
                "\x8BWs\xA0\x86\xF1E\xB5\xBFx\xA1\xE9/\x122\x052\x05\x8C\x92\x16v\xB7W\xD1\x0F\xA4\xAFS\xDF\xF3'\x1F" +
                "\xE7\x08\x88)\xC4YPe\x0Aq:\xD8\xB9\xB0D\xF1\xC5[\x8A/\xAE\xC7\xE4\x8BE\x0D_,\\y\xE35}\xBC\x92\xEDP" +
                "\x89t@\xF8b\x8B\x9A>\xAA\xAC!\x9A;\xBA\x011\x17\x99/\x9E\xC7\xE6\x8Bg\x0D\xF4\x05x\xF6\x1A\x96\x1A" +
                "\x9E\x09\x12\xA1\x9B\x80r\xA4\x9F \x82\xEC\x88\xC4\x17KL\x82T\x1Ee\x7F!z\xFA9be\xC7kQ\x7FA\xCE)\xF3" +
                "\x1A\xBE\x98\xD7\xF7\x17s\xD2\xFE\xA2\xCF\x17\x0Ckxw\x16z\xBE\xD8h\xB4/\xB83\xF3\x9E\xF4\x9CJ\xDE" +
                "\xFF\xDB\xC2\x9F\xF6N\xC7\x0B\xF8\xF9Ww\x136G\xC0L\xC1\xEEA\\\xA6X\xD20\x85p\xEE\x80\xB6\xA7o\x02zMb" +
                "\xFA`s\xE1\xD5<3}\xBC\x84\xA7\x8FM>\x1D\xA0\xFD\x08\x92\x08\x8A\xFE\xE29\x90\x08@\x16x3\x85\xFB\x0E" +
                "\x1FU-\xD8\xBC\xE8\x00\x1E\x7F\x87s\xBE\x13\xF0\x7F[\xE6N`v\x94\xFAN\xCF\x11\xD5\x9E\xA2\x9A KX\xD3" +
                "\x19\x87)\xF0\xFE\x82\xDB\x89\x08\xFA\x8BS\xA6\xB8*J\x90\x05\xB8\xBFx\xC5\xF6\x17\x10_\xBC\xE4\xF8" +
                "\xE2\xA5\x8C/^H\x13\xC4\xE4\x8BP\xA6\x88\xC1\x11\xFD\x1Cq\xFDL\xE9\x9F5\xCD\x17\x95\xB9\xBDd\xF2w" +
                "\xC0\x9C\xDF4u;\x08\xBB\x8F\x10\xA7\x80\x8C)D=\x85?_\x9C\xB8\xD3\x87p\xEEX\xD0L\x1F\xC8\xDC\xC1\xA6" +
                "\x03\x9B\x11\xAF\xB8\xFE\xE2\xA5\xDB_@\xAC\x11\xD2_\xBC\xA8\xB4\x9BL\x7F\xF1\x1CL\x87\xA4|q\x06X\xC3" +
                "\"\x8Ew\x8D\xCE\x08_\x8E\xE88\x09\xA2\xEE&p\xA6Xr\x99\x02\xEF;\xBD;\x8BE\x0D_\x88\xFB\x0B\x9B/\x164|" +
                "\xB1`%\x88\xC3\x17\xF3(_\xB8\xAC\xE1L+e\x0F\xFA\x12\xA7\x8C\x17=U\xF1\x05\xD0_<Gs\x04`\x8D\xE7\x0Ek" +
                "\xA8\xF8\xC2e\x8A\x8A\xCE\x8C\x94/\xECw\xAC\xCF[\xBA9\xFA\x16\xD8kp\xEC\xB0\x84M\x16\x1CG,\xD1\x1C!K" +
                "\x84*S\xBC\x91\xE4\x82\xE0a\xE7\x8E\xE1\xF6\x17/\xE9\\\xE8\x9E\xF99\xE9\xF4\xF1\x02\xDF\x8F<\x97\xF5" +
                "\x17\xCFg\x15L\xF1l6\x84#\xBA\x0F\xE6G\xE7)\xE4y\xD1i\x98\x17e\x07\x9E A\x1C\x01\xE4H\x85#B\x99\xE2" +
                "\x9A\x82)\x16\xB9\xECX`\x99B\xD8_\\\xF1\xEB/^\xE2|\xF1\x92n.\xCC\xFEbN\x92 \xA2\xFE\".S<s2E\xC1\x11" +
                "\x90>\x1B\x09_\xB8\xEF^^o4\xC0\x8B\xCE?\xCE\x11\xBEL\xC1\xF1\xC5\x09\xC3\x17\x9A\\\xF0\xE6\x8Bd\xFD" +
                "\x05\xC2\x17W\xB8t\xD8\xA2\xDB\xCD\x17\x9A\xFE\xE2\x05\xC0\x1AB\xBE\xE8\xA7\xC3\xAC\xBC\xD1\xC4\xE7" +
                "\x0BQ\x0A\x8C2Sp\xC4\xE1\x97\x0E\xBC\xBE\x0B\xF0\xB8\xFA\xA6\x89\xC9\x11KX\x82\xC8\x98\x02\xE5\x0B A" +
                "N8\xBE`\xB3\xE3\x8D'_\xD89\"\xE5\x8B\x80\xFE\xE2%\x9F \x9B\xDF\xFDK]\x7F\xB1%K\x10\x805\x9E3\xDAO" +
                "\x10\x93/f\xC3\xF8B\xC6\x1A\xEE\xB4\xF2l\xE4|\x01\xBC]\xAF\x93\xBE\x09zM\xCD\x0B4;\x84r\x84\x9B\x05" +
                "\xCDc\x8A\x05f\xEExE\xE5\x02\x93\x08}\x1F\xDA_\xBC\xD0\xF7\x17\xCFe\xFD\x85O\x16\xE0LA\x9E|\xD93\xBD" +
                "\xF1t\xA4}\xA1\xCA\x88%\xDE\xBF\x8B\xE4%\x7F\x97*SNhv\x88\xC9\x11\xD7\xDE\xE8\x99\xE2MZ\xA6(=\xC9" +
                "\x14W\xE0\x04\x99\x1FdG\x9C\xFE\xE2\x05\xA0^L1'I\x90\x0A_\x08s\xE4\x99\x9E)\xC4\xEF\xED\xB31\xAA\x80" +
                "\xA7\x85\xD4\xB7b\xAFU\xF9\xCF\xE7N{\x0C\x8E\xA0\xE7\x8BE\x0DS\xB8\xE9\x80\xE4\x02\xDBk\xBE\xA6\xF8" +
                "\xC2f\x0D\x1F\xBE\x98\xE7\xF8\x02\xEA/D\x19Q\xB2\x06\xC1\x17P\x7F\xE1\x91\x0E\x81\xB3\x86b\xB2\xA0" +
                "\x1E\xFA\xBD\xFDt\xA4}\xB1\x14\x98\x17\xD7\xC53\x8E\xDA\x9F\x90\xBC\xF0V\xFC\xC9\xB9d\xE9>\xD7U\x09" +
                "\xF2\xC6\xC9\x11QO\x11\xC8\x17\x0Ba|\x01\xA5\x09\xC3\x17\xF3\x11\xFA\x0B\x9C/z\xFE\x05\xB3\x1F\xE9y" +
                "\x8E/6\x19\xBE\x802E\xC5\x17\xCF\xE2\xF1\xC5\xD3Q\xF7\x85\xEE}\x8B\x9D4\xC0\xBF\x0D\xF0\xE4\xCF\xD73" +
                "\x82b\xA6\xB8\xF6&\x84#\x04L\xF1Z\xC6\x14D\"\xBC\x922\xC5\x15\x8E)\xAEHw\"\xF3\x83\x14`s\x81\xE9/" +
                "\xA8\\P%\x02\x97\x05\xCF\xA3M\x19<G8\xEF\xE4K\xE5\x9F\x00\xFEL(\x14\x1C\xD7\xE1\xA4Xr\xFD\xF5\x13" +
                "\xE1\xA4\xE0\xEB\x91\xBF\x17H\x16\xEF\xF8x\xE3\xF87!\x1C\xB1x\x95`\x0A2;\x86\xC0\x14n\x8E\x10\xB3" +
                "\xC9\xCB\x81\x12\xFB\xD4\xB0\xFE\xE2\xB9\xA6\xBF8}6\x9Fs\xFD\x85\xC3\x14\x97c0\x85\xF4\xFDl\xEB\xF4Y" +
                "\xF1E\xF5\x9C\xB8giT\x1EjvX\xF4\xE1\x08U\"\xA8r\xE1\xB5\x9E/\xC8t@\xF8b\x1E\xCC\x05a:\x08\xF9\x82" +
                "\xE9/\xA8\x8CP\xA4\x035w<\xD3\xF6\x9A\xDE|1C\xF2\xC5\x0C\xCF\x17O\xCF\x92/F</hv\xE09bQ6\x89`\x09\xB2" +
                "(d\x0A8G^\x1B9B$\xC8+\x97/\x16\xF4|1?\xE8,\xBC\xF8\xC2\xF0R\xBE\x98\x93\xF0\x85\xB0\xBF\xE0\xF8bV" +
                "\xCF\x17\xB3=\xBExf\xB0\x86\x07_<\x95\xF2\xC5\xA53\xE5\x0B\xE4\x1D{2R\xFA\x86\xE7\x05\x1Fv\xF0\xE7" +
                "\x08*\x0B\x9C\xDD\xC7p\x98\xC2\xED/\xD8\xB9\xA3\xD2_\xBC\x10\xCE\x1D\x1E\x89\x10\xD8e\xCE8\x89 `\x0A" +
                "\xFE\xCC\x1B\x1C\xE1\xBE\x87\xCF\x9D\x16\xAA\xD40\xDF\xCF\xE8;<\xB5\x8F\x98 T\x9A\xBC\x0E\xE3\x88JO!" +
                "c\x8AW8S\xBC\xF2c\x8AyY\x82\xCC\xEBw\"s\xF6ND\x98#\xC4\x84\x822\xC5,\xC6\x14\x97\xD31\x85\x07G<5\xF2" +
                "\xE5\xECgG\x01\xEE\x05\x161\xDF4\xBD\xCAr\xC4k\xD7\xEB\xB3 \x80)\x98Dp\xD3\xE1\x95\x9C/\xE6\xA3\xF1" +
                "\xC5\x0B\x96/dsGh:x\xCD\x1D$_\\\xF6\xE4\x8B\x99\xCC\x17\"\xE2hr:DJ\x93E\x87#\x16\x85\x09Bv\x13nO\x01" +
                "e\x0A\xC3\x14\x0B`\x82\x88\xF8\xE2%\xC0\x17W\xCC\xD4\x80\xF8\xA2\xD2_\xBC\x98\x97\xE4H\x95/T9\"J\x90" +
                "M\x94/f1\xBE\xB8\x8C&\x08\xC9\x1A\xBA\x9E\xC2\xD0\xA7\x0E_\x9C_-*\xEF\xD5\xB3\xA4./\xD8\xEC\x00\x9Cs" +
                "\x8E#^\xF9r\xC4kM\x16\xB0L\xF1R\xC4\x14[\xB2,\x102\xC5\xE6s\xD9N\x84I\x84(L1\x1B\x81)\x9E:L\xE1\xA1O" +
                "f.\x95~\xFA\xD2\xE9\x9F\x98\xFE\xD2\x99\xF5\x85\xFC4.\xFA\xF87J\xAF\xF8\xF9\xBE\xFA\xDA\x8F\x1D\x16*" +
                "\xEC\x00q\x84\xA0\xA7X\xE0\xE7\x91\x97\xA3\xCE\x14sn\x82P\x13J\x1A\xA6\xB8\x1C\xC2\x14O}\x99\xE2\xC9" +
                "\xF9\xF1\x85{6\x00\xC5\xDE\xDB\xC3\xF4\x1Eg\x9E\x9E#^\xCBS\x00J\x04aO\xC1\xE5\xC2\x15\xAE\xC5\x84z" +
                "\xCD9y.\xF4\xD3A\xC6\x17\x95\\`\xD2\xE12\xDB_\x08{M$\x11J\xF5\xD8\x89z\xF3\xC5\x13\x87/\x9Eh\xF9\xE2" +
                "Lj\x01e\x84\xEB\xDF\x94\xFF\x91\xF1\xB1\x14\xFF\xBB\\^\xC0\xFC\x15y\xBE\xBCr\x98\xE2\x95\x96)\x16," +
                "\xA6P\xF0\xC5K\x86/\x84\x09R\xE1\x0B\";^\xB8\x092G\xCF&x\x8E\x04\xF2\xC5,\x95#*\xBE\x902E\x18_\xD0" +
                "\xEF\xE1\xAA^:\xCB\xBE\x80O\x05|~^\x8B}\x88\xCA\xFF.\xFCT\x8By\x81g\x87\xE8\x1C\xA1\x9A2zL\xF1B\xC6" +
                "\x14/\xD22\xC5\xA6\x88)f5L1\x1B\x99)\xBC\xCF\xBF\x88# }B\xFA3\xFB\x14lF,0\xFEu\x8D\xFE\x95\x82\x11" +
                "\xAE\x86\xA4\x09\xCE\x0Eh\x8E\xBCTs\xC4\x15)G\x9C\xEA\x8B \xA6\xD8z\x01\xF5\x17j\xA6\x98\xC3\x12d3&S" +
                "\xCC\xD6\xCD\x14\x9E\xEC k\x13\x9F\x9CI_8\xA7\xC5\xF5^z5\xC0{*\xFC\xF9\xE7\xD9\x14Pr\x04\x95\x0B[" +
                "\xA6\x7F\xA9\xE9)^8|\xF1B\xC6\x17\xC0\xAC1'\xE1\x8BM?\xBEx&\xE3\x8Bg\x15\xCFL\x1CO\x8D\xFD\x88*\x1D" +
                "\x82sA\xC4\x17\xE7\x88#4\xC4!I\x8A\xAB\x0D\xF6\xE2\x0419\"\xA0\x8F\xD0\xE4H\x8F/^\xCEi\xB5\xCB\x14[/" +
                "4|\xF1\x02\xEB,\xE6\xDC\xECH\xC0\x17\x08k<3\xF6#\x02\xBE8\xCD\x8EY}\x82\xF4\x1E'GfR\xF1\x05\xFDN~r" +
                "\xE6}\x01\x9C\x07\xEC\xFC\xD0\x1Ez\x16\x94\x9E\xEF\x14\x18\xFF\xD2\xFB\x9C\xF3\xEC\xA0\x9B,*\xF3\x85" +
                "y\xF2\xBD\xA7\x0Cu\x7F\xB9i\xA5\x80\x9A)f#3\x05;q<\x0Dc\x8A'\x1A\xA6\xD0p\xC4E\x89\x7F\\\xFE\xC99" +
                "\xF0\x85{\x0E\x17\x02N\xFEB\xB0\xFA\xFC\xBD[\x18/\xBCTu\x10\xBC\xF6\x13\xC4\x93#z9\xF2b\xDEI\x90y" +
                "\x9A#(\xA6x\xAEa\x8A\xE7g\x97)\x9E\x88r\x04H\x13\x8A\x17\xF2\x83\x8E*\xFE\xA7h\xD4\xB4{z1?\x17#\x0B" +
                "\xE6,\xCF2\x85\x9B\x08[\xB2\xFE\x92\x9A5\x90D\xA0\xF8\xE2\x19\xD5k\x96|\xF1L\xD6h\xF6\xCE\xFClL\xBEx" +
                "\xA2\xE7\x8B'\x0E_<\xD1\xF3\xC5c\x92)l\x9D:7\xBE\x88y>\xB1\xF7\xBC\xD6\xD7\xA1/)\x8E\xB8\xF2r\xDEo" +
                "\x1Eq\x99b\x8Be\x0A4Ap\xBEx\xAE\xE1\x8B\xE7\x1C_<\xD3\xF3\x05\x9B#O\x1DO\xA4\xC9\xD3\xDA\xF8bF\xDCG(" +
                "\xB3\xE6\xF1y\xF3\x85\xFF\xFB\xF6\xCAK\xE3\xBD\xFD\x92~\x9F\x8B=\xF03\xE7,\x1FS_\xC8\xD9A\xD1Pr)\xA0" +
                "\x98/65SF\xA9\xCF\x9A\xC4\x14O\x9B\xC7\x14.G\xE8\xD8!k189\xF0\xFB\x16\xF5\xAF\xE6\x8D\x93o\xBF\xC3c" +
                "\xF9-\x97\x0B\x04\x9Fm+\x06/@\xEC\x80w\x13/\xFC\x12D\xCD\x11\x9B\x95\x04Q2\xC5\xB3\x04L\xF1T\xC3\x14" +
                "O\xF5L!S#Af|8\x82~\xC7>&\xF2\xE5\xDCj\x81\x9E\x16\xF4\\\xB9>\xB5\xCA?\x0Fs\xE6e\x1C!H\x81(L\xB1\xE90" +
                "\xC5\xA66\x11\x9E\xB3\x89`\xE4\xC23\x0D_Tf\x0DY\xA3\x99 \x17\x00\xBE\x10b\x85\xEE\xFC\x8B\xF9\xE2q" +
                "\xF6]_4,#\xE2f\xCA\x0B\x1DGl\x01\x1C1\x1F\x96 \xFD\xC7f\x0A\x92/\x9E;|\xF1\x9CK\x93g\x1A\xBEx\xD6" +
                "\x0C\xBEx\x12\xC4\x17\x1BO\xE2\xF1E&\x08\x0F\xE2\x80\xDF\xB1\xB0\xC7\xDE\xD5uz\xC9\xE7T\xE8\xA6\x9A" +
                "\x1D\xE6$\x04\xA1\xE7\x889\xB8\xA7x\xA6g\x0A\x9F,\xF0i.\xA3dA/\x05\xF4L\x11\xCA\x11\xEE\xBB\xF4T/" +
                "\x92>k_\x0B\xF7\xBD\xEA\x9EX\xEC\xFD<|\xBF\xC90\xC2|\x9C4y^\xF18;\x04r\x84\x93,\xCF\xE64=\x85\xC3" +
                "\x14l\x8E<\xD50\xC5S_\xA6\x10\xD2\xC4\x13\xA7\xB3P1\x85\x93#b\x8E02\xE51\xE9\xB3\x96Z\xF0\xEF\xDEQ" +
                "\xD1Mvjx.\x9C\x1D\xE6\xB4\x1C\xB1)I\x81P\xA6\x985\xB3\xC0\xCD\x85\x0DE.\xF8L\x19\xA1\xB9\xE01e\xF8" +
                "\xCF\x14\xDD\xFF~O\x83L\x91\xF9\"\"q\xF8\xE9|\x8D>R\xB2<g9B\x99)\xCF\x1D\xA6x\xEE\xC3\x14\x9BN\x82l" +
                "\x8A\x12D\x9F#O5|\xA1\xC8\x91\x19'Gfx\xBEx\xA2\xE1\x8B\xC71\xF8\xE2\xF1\xB4\xC3\x11\x98\xD7\xA5\xCC9" +
                "\xF3\x05=\xA5\xCF\x8D\x88\x9F\x0D\xE9\x1Dd\xE7\x9C\xEC&\x9E\xA5\xE2\x08\xFD|\xE1?e\xF83\x05<e\x08:" +
                "\x0B\xDD\xF9\xF7\xE7\x08[\x1F\x91\x1E\xD0\xA9\xEC\xAB\xBE\xB0\xCEaL\xDDR\xFA\x18:\x1B\x97\x17\x14" +
                "\x99\xF2\xCC\xE1\x88g\x81\x1C1\xEB\xE4\xC8\xECe5G\xCC:\x092\xBB\xA1b\x8A'\x04S\xF0\x09\xC23\xC5\xE3" +
                "\x190Gt\x99\xF2x:\x90\x1D\xA4\x99\x92\xFD\xA3>q\\\x16\x9C\x19\xF7]\xBD9$\xCF\x7FN);`\xE7\xDF\xE1\x88" +
                "\xC0\x14`\x98b\xD6\x97)\xAA|\xA1O\x84J.<\xD1\xF3\x85p\xCA\x08\x9C/\x04Y\x00\xA7\x80\x88#2Sx\xFB\xA2<" +
                "o\xB6VN\xEC\x9C\xD4\xC7\x9AA\x14\x7F/\xF0\xF9\xA3\xE5\xCB3\xC7{\xA4\xC93\x11S\\\xF6e\x8A\x0A_<u\xD2" +
                "\x84\x8D\x8F'`\x8E\x08:\x0B'A\x12\xF2\xC5c9_L3\xF3\xB9:S\xB2\xBAZ\x80'\x01y\xF7\x02>\xF8\x0D\xAF}" +
                "\xFF\x8B\xB8@t\xAA\xD5\xBC\xF0\\q\xE6\x03\xCF\xBFy\xF2/{s\x84\xAA\xB3|\xE2\xB1\xFB\x98\xF1\x9C/\x86" +
                "\xCD\x11\xEB\x8FN\xFF\xE3\xE9\x9F\xB8~\xDD\xF2Y\x01-\x90\xF7*\xED\x9B\xA0\xF2\xCF\xCC$\xCB\\\xD8\xF4" +
                "\xA1\xE9&\x9E\xD6\xC8\x11.S\xA88B\xC5\x14\x8F\x1D\xA6\xA8\x87#\x1E9\x1C\x91\xB5N\xE2\xC0\xCE\xC9\xE6" +
                "\x88\xF8\xCB\x91O\xBB\xA8\x8F\x08\xCC\x82\xD0D\xF0\x98/\x9E\xF8N\x19\x8F\xF5|\xF1X\xC2\x17\xD3\x00_" +
                "\x04\xCD\x11.ST\xF9\"\x93B<\xE20O\xE0\x9C\xEB7\xFD\xBDVC\xFE.\xF7\xF3C)\xF3,<M \xA6xj{\x8F\x04\xB9" +
                "\xFC\xD4I\x93\xA7\xFA\x9E\xE2\x89,G\x90\x04\xD1\xF1\xC5c\x19_\xA0L\x81i\x95/\x1E9|\x11\xF8\xB6|\x04" +
                "\xFA\xEEy\xC8^\xEE\x8B\xCA\xBB4\xF8\x14\x0D\xF7\xA1\x19a6\x0A#x\xB1\xC3\xAC\xF7L\xD1x\x8E\x90u\x16" +
                "\x8F\x1C\xA6Pq\xC4#\x87#\x1E\xA5\xE1\x88\x87\xD9\x0B}1;\xE2a\xE1\xF3\xB8\x8CP\xF1\x819\x02\xB3\xC3" +
                "\xAC4M\x9E\xA8rd\xC6\xE1\x88\x990\x8E\xD01\x85\x07G\\\x8A\xC5\x11.;<2\xDE\x8D\xB0\xCF\x1AK\x0B\xED" +
                "\xD90\xCF\x15~\xF6R\xF8\xA7\x91\x19Ar\xF2\xC5\x13\xC4\xAC\xB0\x8F\xF0b\x8A\x19\xCF\xC9\xE2\xB1\xC3" +
                "\x17\x8F\xF5|\xF1X\xCA\x17\x01LaO\x0DU\xA6\x98N\xCB\x0EY}\xB4p\xB2\xC0\xCE\x85Y\xCC_\x1E\x92'3\xA5" +
                "\xE27\x9EF\xEB\x1D\x00\xFF42S\xF0\x99\x020\x85\x86/\x1E\xD3j'\x8B\xDDS<\xD6\xF0\xC5#\xC7?\xD2\xF3" +
                "\x05\xCC\x14\xD3$SL\xE7\xD9\xA4\x16_\xC0\xFF\xED7\xCF\x86\xE8\x14\x0D\xD5o\x90'Y\xC0\x08>\xBC@\x9Fs" +
                "\x98#\x04\xEC\x10\xCC\x113q9\xC2<\xFF\x01'?\x80#\xF4\x8C\xB0\xDE\xF3\x93\xAC_\xCF\xDE\xD3\x17a\xA7" +
                "\xB7N\xF5\xFB\x9COyF\x10\xF0\xC2\xAC*G\x04\xEC0C\xB2\x03\xC7\x11\x8F\xFD9\xE2\x92\xC3\x11\x0A\xA6" +
                "\xA8\x9D#\xA2gJ\xD6HZX/\xD8\xD9X\xFEr\x80\x8F\xF4\x19\x90s\x1Ep\xE6\xE1n\xF2\x89\xC3\x14\x82\xF3o3" +
                "\xC5c\xBA\xA7\xE4S\xC0d\x8AK\xFE\x9D\xE5\xB4\x95\x02\xEAD\xB0\xB3@\xC0\x17\xFEL1%\xE5\x88\x87\xD9" +
                "\xC7\xF5\x85\xF9\xA6\x15\xBD\x93\xE5^\xABq?\x03\xC2\x0B\xA4\x7F\x12\x96)O\x86\xC2\x14x\xB2\x041\xC5" +
                "\xB4\x95#\x0A\xBEx\xC4\xA4\x09\xC7\x17\xD3\xE9\x98b=\xFB8\xBE`\xDE\xAB\xAEo\x82^\xF2\xF2\x14#x\xF1BT" +
                "v\x80\xBA\x09O\x8E\x80g\x0A\x05G<\x1A.G\x08x\xE1\xE1d\xD6\xA1j\xD1\xACD\xA8;k\x9E\x90\xBC\x00h(;l" +
                "\xF8\xB2CS8\xE2\x91/G\xC4`\x87\xCA{\xEF\xA1\xED{Y\xF3\xD0\xCD\x97\xEC\xA3\xFB\x82>\x0F\x88>m\x80W" +
                "\x9Cg_\x8Ex\x0Cp\xC4\x86nv\xC0R\x00\xE6\x88HL1\x1Dk\x9A`\xF8\"N71E2E\xE6\x8B\xC6\x12\x07\x9E\x0E\x1B" +
                "\x81^;S\x84\xFF\xBD\x9E*\xCB\x9A\xC7\xE1\x1CQ\xD5\xC7\x0ES<\x8E\xCB\x14\xD3\x0ESL\x873\x05\xCA\x17" +
                "\x0F\xA7\x933\x05\xF0\xE4\xF7\xFFP|Q\xFE\xF7\x98\x7F\xC7B~\x03\xF4!\xFAX\xFC\xCE\xC7Y\xC0\xF3$\xEB" +
                "\xA7\x06\xEC\x9CG\x9C#\"v\x13(G\x84\xCD\x11\xD0i\x8F\xC7\x0E\x0FJ\x7F\xC1\xF5\x0F`\x9F5\xB1\x16\xE4" +
                "\xF9\x7F\x1C8\x0B\xA4\xF4\x8F\x01\x16\xC0\xBC\x9B&\x11R\xE61\x91&3\xFE\x99\xC2\xB1\x03\xD4ML\x87$H" +
                "\x95\x1D\xA6\x07\xECP\xE1\x88\xC0]F\x04vP\xE4K\xF6\xE9}\x11\xF1\xCD\xDC|\x9D\x16\x9E\xF6d\x1CA3\x05" +
                "\xD2M<\xF2\x9C&\xAAY`\xB4\x95\xF1S \xDA\x99\xA79\"3E\x83\x88Cr\xEA6\x1A\xEC#\xE8c\xD2?\x069b&6G\xC8" +
                "\xBB\x89i\xBF>\xE2\"\xC0\x14\xD3\x0ESh\x92\xC5I\x90\x8B\x0Fa\xAF\xE3\x0B\xFA]G\xEA\x85\xECk\xF2\x05" +
                "\xF3^\x95\xF9\x19\xCB_\x0A\xF01>O\x00\x17\xE8\xCF6\xC4\x0B\x91\xD9\xE1\xA2\xC3\x0E\x15\x8E\xF0\x9E&" +
                "\xC8\x93\xEF\xC3\x11\xD1:\x88\xC9\x8A\x7F\x90}\xD3|\xA1=\xE1MP\xE9g\xBE\x18\x97\x11|2\x05a\x87G\x09" +
                "\xD9\xE1\"\x90&\xD3\xF1\xD2$\x8C\x1D\x02\x18!k\x93\xB4\xC0\xFF\xBB\xFEx\x04}L%9\xE2\xD1t8;p\xDDd\x0D" +
                "LQ\xD3\xF9\x87\x95~\xA7=`}\xD6!j!=\x93\xD0\xBBz\xA6F\x8F0\xC2p2e\xDAb\x07\xCC\xF7\x1F}\x9A<\xA4\x99" +
                "\x82\xEE&\xA6\xE9\x04\xB9H\xF6\x11<_< |P\x07\x81'K\xF6M\xF3E\xF9\xDFo\xF3]\x0A\xF8\xC7\x0D\xF6\xE8" +
                "\xE7\x9F\x8A\xCB\x05\xFAs>e\x9C\xF3\xA0\xA9A\xD3D6\x80\x1D\xC4\x8Cp\xC1\xDB\xDF/\xFFc\xF6\xB5\xFBbp" +
                "\xD2\xCE\x9A\x9A\xFF^U\xEF0\xC2\xA3\x18\x8C\x80\xE4\xC8E\x92\x17\"\xB2\xC3\xC5(\xEC\xF0\xC0\x9F\x1Dx" +
                "^\xA0t2\xFB\x91\xF2E\xFA\xB7\xF1h\xA9xF\xB8\xA8:\xED\x02\x8E\xF0\x9D &\xC9,\x088\xFF\xFC\xC9\x8F\xC4" +
                "\x17\xF2w]\xD6\xA6ha\xBDca\x7FI\xE1\xA7\x03\xFC\x94\x87\xBF\xA8\xF6\x11\xD8\xE1\"\xC9\x0EU\x8E\x901" +
                "\x85\x80#\xF4L1E2\xC5\x94O\x1F\xA1\xE3\x88\xCC\x14g\xD5\x17\xCC\x7F\xEF\xA3y\xC5;<\x96\x9F\x12O\x01" +
                "\x11\x18!\xACqL<;Db\x07\x97\x11\xD63\x17\x9Cc\xE2\xA8\xBC?\x01}\xD4`/\xD6\xF5$\x8C\x10\x8D\x17.2\xBC" +
                "0E\xF2\x82\x98\x1D\x1E\xA4g\x87\xFBS\xEBF\x8E\xD8\xFE>\xE0\xB3\x8E\xA0\x16\xC8Ix4\x82\x9E>\xC9^'\xDC" +
                "\x9F#\x1E\xC4\x99\x17(\xA6H\xD0>RL\x91T\xEF\xBB~\"\xFB\x06\xFB\x02{\xD3\xD62\xBFD\xF22u\x93\x05\xF7" +
                "\x0Fc'\xCB\x83\x8A\x878\"\x19S\x84j\x85#`\xA6\xC8\x1Cq.\x89\x83y\x97\xCA},]O\xE6q\x16\x90sA\x00/<@}" +
                "\xBC\x96\x11\xE5\x85\xF5$\x8C\x80\xBC\x97\xEEO\xACQ~\"\xFB\x11\xF7E\xE43\xDF|\xF5\xE7\x02\x8A\x11" +
                "\xA6\xFC\xB3\xE6\xC1\x10ya*r\xB2\xDC\xF7\xF2\xF9\x19\xBD\xA7\x90\x9C\x84\xAA>l\x80\x7F\x10\xFD\x0C+" +
                "\xE7\x82\x07\xA4\x8Fr\xDA]\x7F\xBF\xE2\x93L\x0A\xCC\xA9\xF6d\x8A\xACgN\x8B\xCA\x99\xBCx\x86|l\x15d" +
                "\xCD\x03\x92#\x1E\xA0\xDES\xEF\xBB\xDE`\x8A\xFB\xF1\x98\"\xF3B~\x1C\xE2\x10\xBC?\xAB~\x9D\xF0)\x14" +
                "\xFA\xBBt\x9F9\xE2Y\x15\x9D\xE7I\xCA\xDF\x8F\xCD\x0B\xF7\x93\xF0\x02\xA3\xF7H\x9F\xF5\xECk18i\xB1" +
                "\xD8\x9E\xF6S\xF5\xFD]\x0Fh/b\x81\xC8Ys\x9F\xF4\xF7\xE3\xF1B<FX\x93fM\xC5\x1B92)\xCA\x9A\xECG\xCC" +
                "\x17\xE9\xDF\xC0\xA3\xA5\xE8\xD9F\xD9\xA1&\x8E\x10=\xF2\xB3\x9D\xD9!k\x14\xE2\xD0\xBC{\x05~\xCA\xF5" +
                "\xEB\x88w\xFE\xF9\xC9\xD4>\x09/T\xD8A\xCE\x11\x1A\xA6H\xD35\x88\xB2\xE6\x9E\x98#\xB2\x9E\x0B-\xEC" +
                "\xFF\x06\xAF\x8F\xB8\x97\x9F\xCC\xE6\xB5\x86r\xFE\xAF\x8F\x11\xD60\x7F\x0F\xF4\x13\xD9\x9F\x0F_ \xEF" +
                "\xC9\x07#\xE8\x83T\x9E>\x1C#\xA4\xDFA\xACa\xBCp\x8Fd\x84\xFC\x9E\xCC\x9A\x808\x14\xBA\xDE\x00?B7\x91" +
                "h\xFE\xBF\x80\xF1\x7F]\x8A\xB0C\xDF\xDF+}\xFF\x85\x93}\xF6\x05\xF3^E\xDE\xC9\xC3\xD2\xC9`F\x80\xFC" +
                "\x8Fg\xAAQw\x16\x8CL\x99\x04\xF2\xE5\x1E\xEB\xA3\xEA\xBD\xEC\xB3\xB7|q\xEE\xEE\xAE\xACy\xB1\xC0\xD0" +
                "\xB9\xE0B\x1D\\\x90\x9F\xFC\x08\x9F\"\xDF\x81S>\xF7\xA4\\p\xE1^\xBD\x8Cp\x8FL\x99{:\x9F5+\xA9E\xE5" +
                "\xBF\xDF\x92\xF7-yfR{\xCD\xE7\xD4\x9D\xDB\xC9\xDAx!\xFC\x84\xC7d\x8A\xBB\xD9g\xEF\xE1\x0B\xF8]:\xEA," +
                "\x80y&\x9B\xEE\x11>q\x06\xC9\xE7\xCC{5pDn\x01\xB3\xA7}q\xA6\xF7F\x01\x0DP\xA4\x93\x19\xC0\x05\xF2" +
                "\xF7\x00\xA9\xAB\xD9g\x1F\xDF\x17\xDE\xEF\xD2Q\xF4\xA9\xDE\xFF\x98&\xE0\x02'e\xEE\x8A\xFD\xDD\x89" +
                "\xACY#i\xC1\xFF\xB7\xB9\xC9\xBA\x96\xCC\x87\x92\xFC]\xDA\x87\xFE\xFF\xB9\xF0\xF7\x06\xACw\xB3\xCF^" +
                "\xE2\x8B\xEAi<K;\xE7\x06$\x14\xAFw]O\xF3\x82\xC4g\xCDZ\x03q\xDC\x95\xBF'\xCF\x90O\xA6\xA1\xEF\x7Fy" +
                "\xF6\xA3:\x9E}\xF6\x89}\xC1\xBC\x15/\x8C\x88\xF7z\xB7\xA7{\xE7O\xD6\x94Aw\x19\x9F\xE9:\xFB4\xBE\xC8" +
                "\xDC\xE5\xC5\x0BwQ\xEF\xC5\x08\x99#\xB2\x1F-_\xB8\xEF\xC9Q\xD7\x89Z\xBCo\x1E\xDD\xF5\xF2Y\xB36K\x0B" +
                "\xE5\xFFM\xD3\xA8\xA9VM\x93\xDFw\x06\x7Fb\xFBU\xA1\xBF\x93}\xF65\xFB\xC2\xE7\x1D\xB8\x06\xFA\x14Z" +
                "\xFD\xBBVk\xF0w\x9B\xFF\x9E\xA73(\xFB\xECk\xF0\xC5\xF9\xE1\xABp.\x90\xF8T\\\x905k\x93\xB4\x08=\x93k" +
                "\x89\xFD\x19\xD1;\xA0\xF7\xCD\xFB;\xD9g?\\_\xE4\x99\xADa\xEF\xF6;\xD9g\xDF|_\x10\xEF\xB7\x89\x11\xF4" +
                "i\xDF\xD5\xAB\x8C\xCF\x93H\xD6s\xA2E\xFE\x7F\x85\x1A\xDF\xF9Y\xB3\x9E\x11-\x84\xEFR\xDB\x0Fk\xBEZM" +
                "\xE8ka\x84L\xB9\xD9\x9F\x05_\xE4\xEC\x1C\xE88\xEBW\xB2\xCF>\xFB.q\x00\xA7h\xD4s1k\xD6\xACi\xB5\xC8" +
                "\xD9\x89\xFB\xDBR\xBF\"\xF2\xE3\xD9g\x7FV|\x91\xB33k\xD6\xACz\xE2\xE8eI\xD6\xACY\xB3J\xB5\xE8\xBA" +
                "\xB2\x05<#\xFE\xB6\xBF_\xC9>\xFB\xEC\x19\x9F\x89#k\xD6\xACz\xE2\xC8\xD9\x99}\xF6\xD9k\xFD)qt\x9F\xD5" +
                "\xDB\xD9g\x9F}\xF6\x12_\xF4\xFEs/K\xB2\xCF>\xFB\xECyo\x10G~\xF2\x93\x9F\xFC\xC8\x9E\x01qd\xCD\x9A5" +
                "\xABT\x8B\xF6\xCA\xAD\xEF\xFF\x9F\xACY\xB3f\x95k\x1EU\xF2\x93\x9F\xFC\xE8G\x95\x9C\x9DY\xB3f\x0D!" +
                "\x8E[\xD9g\x9F}\xF6\x12_\xB4\x97\xBF\xFF\xE7[\xBD,\xC9>\xFB\xEC\xB3\x17\xF8b\xC0\x1E\xE3\x06\x87d" +
                "\x9F}\xF6\xD9\x13\xBEO\x1CY\xB3f\xCD*\xD6\x01q\xDC2\x9A\x8F\xEC\xB3\xCF>{\xCA\xFF \x8E\xB6\x91%\xD9g" +
                "\x9F}\xF6\xAC/2we\xCD\x9AU\xAB\x83\x8E\xE3\xD8\xC8\x95\xEC\xB3\xCF>{\xCAg\xE2\xC8\x9A5\xAB\x0Fq\x1C" +
                "\xFF\x18]z\x89\x92}\xF6\xD9g\xCF\xFB.q\x1Cg\xCD\x9A5\xAB\\\x0D\xE2\xC8\x9A5kV\x99\x16F\xF3q\x9C}\xF6" +
                "\xD9g/\xF1]\xE2\xC8O~\xF2\x93\x1F\xC53\x08\x8E[\xC6\x9Ff\x9F}\xF6\xD9S>\x13G~\xF2\x93\x1F\x7F\xE2" +
                "\xC8O~\xF2\x93\x1Fqp\xB4:G\x83\xFF\x90}\xF6\xD9g/\xF1\x998\xF2\x93\x9F\xFCx\x8F*F\x96d\x9F}\xF6\xD9" +
                "\xD3>\x13G~\xF2\x93\x1F\xEF\x8E\xE3T\xB3\xCF>\xFB\xEC%>\x13G~\xF2\x93\x1F\x9F\x8E\xC3\xC8\x92\xEC" +
                "\xB3\xCF>{\x817\x89\xE3(\xFB\xEC\xB3\xCF^\xE2{\x1DG\xD6\xACY\xB3\xCA\xB50v-G\xD9g\x9F}\xF6\x12_\xE4~" +
                "8\xFB\xEC\xB3\xD7\xFA\xC2\x98^\xB2f\xCD\x9AU\xA4\xDD\x8E\xE3\xC8\x98^\xB2\xCF>\xFB\xEC\x19\x9F;\x8E" +
                "\xEC\xB3\xCF^\xDFq\xE4\xEC\xCC>\xFB\xEC\xB5\xBE\xC8\xD9\x99}\xF6\xD9k\xBD\xD9qd\xCD\x9A5\xABH\x8B" +
                "\xBC[\xCA>\xFB\xEC\xB5>\x13G\xD6\xACY\xBD\x88\xE34K\x8E\xDAe\xAEd\x9F}\xF6\xD9S\xFE\x948:F\x96d\x9F}" +
                "\xF6\xD9s\xBE\x18\xB0G\xDB\xE0\x90\xEC\xB3\xCF>{\xC2\x179;\xB3\xCF>{\xAD/rvf\x9F}\xF6Z\xFF\x9D8\x0E{" +
                "Y\xF2C\xB3\xCF>\xFB\xECy_\xE4\xDDR\xD6\xACY\xB5:\xE88\x0E\x8D\x19&\xFB\xEC\xB3\xCF\x9E\xF2\xB9\xE3" +
                "\xC8>\xFB\xEC\xFD;\x8E\xACY\xB3f\x95j\x917L\xD9g\x9F\xBD\xD6g\xE2\xC8\x9A5\xAB\x07q\xE4\x968k\xD6" +
                "\xAC\xFA\xAD\xCAa\xCB\xC8\x92\xEC\xB3\xCF>{\xD6\x17=\xF6X68$\xFB\xEC\xB3\xCF\x9E\xF4\xB9\xE3\xC8\x9A" +
                "5\xABg\xC7\x91s4\xFB\xEC\xB3W\xF8n\xC7qh\xCC0\xD9g\x9F}\xF6\x8C/2we\xCD\x9AU\xABE\xCE\xCE\xEC\xB3" +
                "\xCF^\xEB3qd\xCD\x9A\xD5\x838\x96\x06Yr\x98}\xF6\xD9g/\xF1\x998\xB2f\xCD\xEA\xD9q\xE4\x1C\xCD>\xFB" +
                "\xEC\x15>\x13G\xD6\xACY\xBD;\x8E\xACY\xB3f\x15k\xD16\xB6,\xD9g\x9F}\xF6\x12\x9F\x89#k\xD6\xAC\xFE" +
                "\xC4\x915k\xD6\xACR\xCD\xC4\x915kV=qt]\xBB\x7F\xA54\xFB\xEC\xB3\xCF\x9E\xF5\x03\xE280\x12%\xFB\xEC" +
                "\xB3\xCF\x9E\xF2F\xC7\xB1t\x98}\xF6\xD9g/\xF1E?K\xB2f\xCD\x9AU\xAA\xB9\xE3\xC8>\xFB\xEC}:\x8E\x9C" +
                "\xA0Y\xB3fU\x12G\xCE\xCE\xEC\xB3\xCF^\xEB3qd\xCD\x9A\xD5\xB3\xE3\xC8{\xA6\xEC\xB3\xCF^\xE13qd\xCD" +
                "\x9A\xD5\xAF\xE3\xE8gI\xF6\xD9g\x9F\xBD\xC4\x9F\x12\xC7\x92\x91%\xD9g\x9F}\xF6\x9C/2we\xCD\x9AU\xABE" +
                "\xCE\xCE\xEC\xB3\xCF^\xEB3qd\xCD\x9A\xD5\x8F8\xF2\x93\x9F\xFC\xE4G\xF3d\xE2\xC8\x9A5k&\x8E\xFC\xE4'?" +
                "\x998\xB2f\xCD\xDAD\xE2\x183R$\xFB\xEC\xB3\xCF^\xE2\xFB\xA3Jo\xCB\x92}\xF6\xD9g\xCF\xFB\"gg\xF6\xD9g" +
                "\xAF\xF5E\xCE\xCE\xEC\xB3\xCF^\xEBs\xC7\x91}\xF6\xD9\xFBw\x1C\xC6\xAE%\xFB\xEC\xB3\xCF\x9E\xF4\xB9" +
                "\xE3\xC8>\xFB\xEC}:\x8E\x9C\xA3\xD9g\x9F\xBD\xCE\x7F\xEF8\xF6\x07)\x92}\xF6\xD97\xCD\xB7\x12{\xBF" +
                "\xCF\x96\xAF\x9C\xE7'?\xF9\xD1_9\xEF\xA7H\xD6\xACgO\xEB{o\x9F7\x9F\x89#?\xF9\x19\xC63\x8A\x1DG\x858" +
                "\x16\x8D\x84\xCE>\xFB\xF3\xE6\xB3zi\x978\xF6\x8D,\xC9>\xFB\xF3\xE0\xF3\x13\xA5\xE3\xC8\xEF\x9F\xEC3;" +
                "\x18\xDAJ\xE2\xCFf\xC7\x91\xDFE\xD9g\xBE\xC8\x8F\x908\x16\x8D\xE4\xCE\x9A\xB59\x9A\xFB\x91\x84\xEC" +
                "\x13\xA3\xE3\xA8\xE7\xF3e\x9F}\\\xCFif\x9CL\x1CY3G\xD4\xCB\x0B9\x97i_\xE4\xFF\xB7\xC8\xBE\x91\xBC" +
                "\xD0L\xA6\xC8O\x858\xF6\x8DwB\xF6\xD97\xCD\x8F\x02\xCB\x9C3~)\x06\xFF\xFE-\xE3\xFF-\xB2\xCF>\x82\xCF" +
                "\xFC2b\\\xA3\xF8\x9CE~\xA7e\xDFh\xBEH\xCC\x0Byf\x0C\xEE8\xF2{2\xFB!qD]\x9A{\x90$\x1DG\xD6\xAC\xC3" +
                "\xD2\x11\xE3\x94\xCC,E&\xE4\xECK\xBF\xE4\xE1\x87\xC6/g\x8BSF\xCCg\xE2\xC8::|\x11\xCE\x05\x0D\xE8q" +
                "\x87\x9D\x83R\xE5;\x0E\xAF\xF7L\xF6g\xD6\xB7(\x9F\x84)\x86\xADM\xEA>\x1A\xF6{7r\xC7\x915\xB3\xC9\x19" +
                "\xE4\x94\xA1w\x1CY\xB3\xEAOr\\f\xC9l\x92;\x8E\xACY\xE3\xF3\xC5\x12\xEB\x87\xB0W>\x9F\x9A\x89#+u\x92[" +
                "K\x81\x1E=\xABM\xD5\xD8\xEF\xE73\xFB\xBF\xAB\xB2\xB8\xF7\xFD\xFF\xD7\xF6\xFF\xBB\x92\xFD\x19\xF7-" +
                "\xD3\x9F;69\x18;ww\xDER\xEDY2qd\x8D\xA3\xE7\x83G\x86\xDDwt\"\xF9x\x1DG~'\x8F2;H\xFC\xD2h\xB1\x06\xC3" +
                "\x11-\xD8\x9F\x81\xFE5w\x1CY\xCF,Sx\xF2\xC5Y\xE3\x08\xFE\xDD\x1E\xD4#\xB4k\xF4\xDE\x1DG\xF7\xED\x94" +
                "\xFDh\xFA%\x95?\x03l\x92y\xA4\x11\xC4\x81\xFDw%\xFB\xE6\xFB\xC6\xF0\xC8b\xE6\x91X\xDDD\x13\xF6&\xCC" +
                "\xE7,\xF2{\xFB\x8C\xF1E\x8B\xF2r\xBE\xD8k\xD2|t \xF6g\xA0s\x1D\xBD\x8E#\xBF\xC33k\x90\x1C\xE1\xD5w" +
                "\xB4L?B\x1C!x\xF7F\xEE\x1A:\x0D\xF3\xE4g.;\x8E\xAC\xCD\xD7\xB8\x9C\"b\x93\x06\xF2\x88\x8EA\xF63\x83" +
                "\xA4!\x0E\xE9\x7F\x93\xB2\x1F\x9E\x87u\xF8\x9C\"`\x90\xFD\xD1d\x90\xB8<\xB2\xDF\x1E\xD2\xAE$\x9D\xCF" +
                "\x1D\xC7Y\xEE>\xC4\xA94|\xBE 3H\xC4\x14g]S\xDC+\x0B\xDF\xAA\xE4w{\x13\x99\"\x9C5\xA2\xF6\x1A$_\xB4l" +
                "\xEF2\xC5~\x13\xCF!\xCF\x08\x1AvP\xF6\x08\xA3\xA2\xEE\xE7\xEFv\x1C{\xC6,\x9D}s|\xD4\xBE#\x15\x8Fd" +
                "\x069\xCF\x1DG\xD6z\xB4Y\xDDG\xDA=Kf\x90\xC0\xBD\xC6p\x99\x82\xF6E~\xB77\xCA\xC7\xED;\xBC\xD2\xA7" +
                "\x81\xDD\xAA\xCB\x11\xFBg\xB9\xA7\xE8\x0C\xC9k>g\xEE8\xCER\x0F\xE2\xCF\x1A\x91z\x8D}\x92)\x86y\xDA" +
                "\xDB~\x1C1\x82}D=jv\x1C\xF9i\xCE\x93\x8AMZ\xCD\xEB8Z^\xBDF\xEB\x8C0H\x93\x7F/!\xD9qT\xFF[\x98}\\O" +
                "\x9E\xDE\xB8=H(\x8F\x9C\x0B\x06iw2\x83d\xE28\xEB|\xD1\xF2\xE2\x8B\xA8\x89\x13\x875\xBCr\x87f\x8A\xFD" +
                "&\xF2\x82\xD1\x17\xB4S\xF9X7\xB8B?O\x91\xB9 \x96o\xA1\xBE\xA1|\xD1\xF2\xE2\x0B\x92)\x86\xC3\x17m/" +
                "\xA6\xE8\xFE\x93\x99\x1D|\x89c\xC1x\xF5e\x9F\xCE\xC7f\x13\xF5d4\xEC=K\xCB\xEB\xAE\xFA\xA8qG\xFD\x0C2" +
                "\x04\xFF\xFD\xDFk\xD0q\xEC\x19\xFF-\xCC>\xDC\xFBqJ\xA2\x89#*\x83\xD0\xDC\xB18j\xDC\x91\x19$\xA8\xE3" +
                "\xC8\\\xD0<\xBE\xD0\xA4O#:\x8E\xE0\xDC9hj\x93\x1A\xA3\x9B\x18\xF1\xA4\xB0n\x82\x15\x99\x11R\xB3Fk8|" +
                "\x01\x9F\xFF\x16\xE0\xE1s\xDEjF\xAF\xD1\x962\xC5~\xE6\x88\x9A;\x8E\xDD\xF2m\x99\xBD\xD6\xD7\xCB#\xF2" +
                "iH\x9DJ\x0D\xE2\x8E\x86op\xC3\x18d\x04\xBF\xEDf|\xCE\xF2\xDF%\xAFc#\x9Ed\x1F6ax\xA4>\x06\xD9o2\x83$" +
                "\xE0\x8E\xCC Q\xB6*\x99\x1D\x14|\xB1\x9B\x8E/Z\xC3\xE7\x8B\xBDz;\xD4\x86\xB4\xA7\"^\xC8y1\xD0L\x1C" +
                "\xD19\xC2\xF6\x90\"\xAC\x91\x86/Z\xE2\x8E\xC3\x8B)\xE2\xF0\x85\x9C)\xC4\x1C\xD1\x98s\xDE\x19\xF8\xC3" +
                "\xF6\x88\xFB\xC1\xBF\xCB\xA0\xE3\xC8\xEA\xA7\xC1l\x12\x8FAZ\xC3\xEB8\"\xEDn\xEB`\x90\xA8\xDC\xB1\x7F" +
                "\xBE\x89\x03\xFD\xEF\xFAy\xF3A\xB3\xC6\x883\x88\xC3\x1D\xC3\xE85\xCE\x07w\x1C\x8C kT>\x7F&\x8EH\xACQ" +
                "\x07_\xEC\x0D\x97/\x12\xF4\xA6\xC9\xB6\xB6\x1D6qF$kF\xA3\xE3\xC8\xDC\x91\xA6\xFBh\xC9Y#\x1E_\xB4\xB4" +
                "|\x91\xB2\xD7h\x8B\x99\xA2\x8D\xF9a\x9F\xF3vT^8}\x0EGJ\xBB\xC4Q\xFE\xBB\x14\xFF2\xDE\xA2\xE7\xD9\x0F" +
                "\x8DG\xC2:\x8E\xA0mn\xEC\xDDm\xE6\x8Es\xD9q\x9C7]\xC4\xBC'\x9B\x0C\x81AB\xB9cO\xD7k\x9CK\xEEh\xC7" +
                "\xE5\x8E\xCE\xC8q\x87\xCD\x1A]\x9F;\x8E\xE8y\xA4\x9E\x83\xF4\x89\x93\x90/\x12\xF7\xA6\xB55\xA6#\xCB" +
                "\x11\x1D\xA2O=\x8C\xEB[x\xF7)\xEC8$\xEF\xE1\xF3\xE0\xE93\xBF[W\xC7\xB1\x17\x83/\xF6\x1C\xA6\xD8\x8B" +
                "\xD7k\xC0)\xD0p\xA6h\x07sD\xBB3\xD2=EL\xEDv\x1C\xBB\xC6\xCC\x7F\xDE|\xFA\xBEC\xDFq\x04ms\x1B\xCD\x1D" +
                "\x07\x99;\x9A\xC0\x1A\xE8\x9E\xB5\x93;\x8E\xF8=\x08\xC0 c\xD1\xB8#Z\x0A\xA8\xB9c\xF1\x1CsGG\xCA\x1D" +
                "\xED\xCC\x1D\x16q\x9CO\xD6\x18^\xD6\xC4\xBE-\x96\x8A/\xF6\xD2t\x19\x89\x1A\xD3F\xEDh}Y\xA0\x03\xFBt" +
                "\xAD'\xFD\xF7\xD2\x9F9\x13\x87\xA2\xFBh\x89\xFB\x0EO\xD5w\x1C-\xD2\xB7\\\xD6\x88\xD1k\xB4\xC5|!`\x8A" +
                "8\xE7_\xDE_\xB4M\xDF\xC9\x1C\x11\xD2q,\xECv\xDF\xC6g\xCF\x8F\xD9~\x18<\"\xDB\xB3$\xBC\xA5\x1Ecw;\x1C" +
                "\xEE\xE84\x94;\xC8lj>kD\xE0\x8EL\x1C\xCDc\x90\x1A\xB8c19w\xB4u]\xC6~\x943/\xEF/\x04\x9DE\xE6\x0E\xBE" +
                "\xE3\xC0\xDE\xCFg\xC2/\xBA\xDE\xE5\x8B\xDD\x9A\xFB\xD4\x847\xC4\x86\xBC\xAF=\xF0hL\xDB\xC3c\x8A\xB6W" +
                "g\xD1^:\xEF)S@'g\x14}\x1D\xAC\x81\xF0\xC5n\xC2\x8E#\xF3\xC5\x19\xEA/\xC6\x97\x09\x7F\xD8`\x0F|f\xA3" +
                "\xE38K*\xEA;\x86\xC7 \x99;<\xB7\xB31\xB9\xA3\xED\xC5\x1D$k\x1C\x9C+\xE2\xD85\xCE\xC9\xE8jz6Q0\xC89" +
                "\xE2\x8Ev];\x14\xFA\x9C\xB7\x9B\xCD\x1D#\xCB\x1A(w\x14g\x89/\xBC\xBA\x8F\xD8)\x83w\x1C-\x925\xA2'K4" +
                "\xBE\xF0\xB9\xFD\x15q\xA2\xA9a/\x9B\x9B\xD1\xF3H\x1CiX\x03\xE5\x8B]\xAC\xE3\xF0\xE5\x0BQ\"\xE0L\x81)" +
                "yw\x83b\x8A\xA1\xF1Ec\x99b\xBC\x13\xCA\x0B\xDD\xFF+\xC3\x8F\xA2V\xFE]\xBE\x13\xC7M\xE3\xED=*>\x0D" +
                "\x8F\x88R)t\x8F\xDB\x10\xEEh\xD5\xC1\x1DC\xEB2\x94{\xD9\xCC\x1D\x1E\xC4\xB1`\x9C\x99\xD1\xF1\x91\xD8" +
                "\xC4'\x0BZd\xC7\xD1\xF2c\x90D\xDC\xB1\x94\x92;\xE2\xEDP\x02X\xE3`x\xACqpnX\x03\xE0\x8Eb\xD4XC\xCA" +
                "\x1D\x91\xF8\"\x945\x1C\xBE\xD8Mt+\xAC\xA5\xCE\x17\xCFL\x19b\x97\x11\xB0\x97\x1D*G\xC0\x89s8\x82\xBE" +
                "\xFC\xFC\x05\xF0\x0Eo\xB2_\xAC\x8B5P\xBE\xD8\x8D\xC0\x178k\xB4\x06\x7F\x92\xB8\xD7h\x93|\xD1\x96\xF0" +
                "EG\xC1\x17m\xF2\xFC\x070\xC5AR\x8Epg\xFB3\xC4\x0EA:\xE88FE\xFDyd\x88\x1DG\x8B\xEC8\"\xF6\x1A5\xEFh" +
                "\xA3\xB6\xA7^\xDC\xD1\x11\xCE5C\xEA/\xCE\x0Ek\xD8\xDCQT\xCEU3}C\xFA\x0E\x94;v\xA3w\x1CA\xDC\xB14\x82" +
                "\xDCQW\x97\xA1`\x8DNf\x8D3E\x1CR\xD6\x18\x13\xB3\xC6Xl\xD6h\x91\x1DG\xC4\xC6\xB4\x86^#YK\x1A\xA9+" +
                "\xADm#+g\x87\xB3?\xE3\xF4\x89cT\xF9\")k$\xED8b\xF6\x1A$kp|\xD1\x8E\xCD\x17m\x92/\x12u\x19\xE3b\xA6" +
                "\x18ol\x7F\xB1\x0C\xFA\xA3\xF1\xFA<\xF6\x19\xCE\x14q\xC4g\x90\xC8\xD3\xCDP\xB9#\xFA\x8E6\xC1\x14\x93" +
                "h/\xDB@\xD68\x9BZ4\xEA\xFC\x8F\x19g\x9E\xF3\xB52\x08\xC9\x1D\xBB-?\x06\xA9$\xC2^X\xAF\xB1\x17\xD2k" +
                "\x00\xDC\xD1\x89\xCC\x1D\xED4]\xC6\xA8\xB2\xC6\xF0\xF9B\xCF g\x948l\xD6\xE0\xF9b\xA1\x06\xBE\xD8\x0D" +
                "\xDA\xD7\xBA\xAC\x91\x8C/\xDAu\xF1E\x02\xA68\x88\xDD\x8Cv\xFF\xC9\xBC\x8B\xE5\x88c\xAC\xF2\xCE\x1F" +
                "\x96\xE7X\xA3\xC6\xFB\x1D-\xB2\xE3\x88\xC6\x17x\xC7\x11\xD8k\xB4E|\xB1\x1F\xC2\x17m?\xBE\xE8\xA8\xF9" +
                "\x82f\x8A\xF1a0\x85\xF9NV\xBC\xC3\x97K?^\xFAQ\xD1\xCA\xE7?%\x8E\xF9\xEF\xE7\xF3f\xEF\x8D]\xB7\xDFe|" +
                "\xCD\x0C\x128\xD1\xA0wF\x1B\xC9\x1D\xDE\xDB\xD9N\x12\xEEPfMf\x8D\xDCq\xA0}\xC7\xCD\xBA\x18$\x90;v" +
                "\x87\xC3\x1DKQ\xB8\x83L\x84fv\x19\xCB$w4\x9A5\xCE\x8E\x16\x0Db\x8D\xA4=\xAB\xBA\xE3\xD0\xB1\x86\xDBq" +
                "\xB4b\xEDPz\xBDi\x1D|\x11%M\x98\xBDl\x9A.C\x99,\xC3\xEFD\xBB'p\xB4\xBC\xF9\xF9\x8BF\xF2\x05\xC5\x1Dc" +
                "\xC3`\x8DV\x8C\x1DJ\x8B\xDA\xA1\xEC\xB5BXC\xD8e\xD0\xBD\x06\xDFe\xEC\xD7\xD9e\x8C\xD7\xC5\x14r\x8E" +
                "\x18\x1F\xED\x9E\".q\xCC\xFF\x00\x81\x1E\x11\xA4\xF1\x90\xEA\xD9$\xDA~w\x94\xB8\xA3\x95\x86;\x92N1" +
                "\xEDz\xBB\x8C\xE6\xB2F\\\xBEX\xB6\xFCQ\x80\x0F\xFF<\x0D\xEE8\xFE\x15\xC8 \xF5q\xC7n<\xEE\x88\xBFOi" +
                "\xC7H\x04\x885\xA2q\x87bo\xB2\x1C\x99;\xBCX#k\x9F8\xC6\x18:\x88\xA7\x0B\x96\xC7Y#A\xC71\x16\x975P" +
                "\xBE\xD0\xB3F\x85/\xF6|\xF9boH|\x81\xCC/\xF1\xF8\"\x98)\xA2\xCF2\".8\xDBZ\x8C\x14_\xDCt\xF8\"\x1Ak" +
                "\xB4\x1C\xD6h\x85w\x1Ci{\x8D=\xDF^c_\xDFe\x04\xF1\xC58\xC6\x17\xCBI\xBA\x8Cq\x92)\xC6\x1B\xD2Y\xAC" +
                "\x1C\x9D\x1A\xDBO4\xC0;\x9FmH\x1D\x87\xB4\xFB\xA0y$\xFANwt\xB8\xA3\x95\xA6\xD7\x08\x9Cb\xA2\xDE\x01" +
                "\x0B\xBE\xFD\x95Y\xA3v\xE2\xB8it\x90\xE9}m\x0C\xE2\xA5\xAD\x14\xBB\x15\x88;Za\xDC\xD1\x0E\xDF\xA7" +
                "\xC8v(m\x97;\xE2u\x19\xE3\xB1\xBB\x8C\xE6\xB2F|\xBE8\xEA\xF9\x15\x81_\xB6|\x04\x06)j\xDF\xA7$d\x0D" +
                "\xAAC]\x1C\xA4L\xA4\x89&p\x96az\x8D=\xEF\xF9\xA56\xBEh\xC7\xE0\x8B\x80f4z'\x8A\xB1\xC3\x08q\xC4Q\xBD" +
                "\xC4\xB1@\x9Ca?\xEF\xF2\x05\xE6\xBD\xF8\"\x12k\xB4\xACD\xF0\xDC\xA1\xD8\xB9\x80\xF4\x1Az\xD6\x00\xF8" +
                "\"m\xAF\x11\xC8\x175t\x19\x02\xA68L\xCA\x14\x13+\x96\xC7\xDF\xD5\xC6;\xFF\xECi\x93:\x8E\xE4\x0C2\\" +
                "\xEE\xF0\xE85|\xB8#\xC27\xDC\x12\xDE\x01\x93\xEEM\xC6\xD3\xDC\xC5\xA0Y\xA3I|qT\xF1+\x89}@\xC7\x91n" +
                "\xE7\xAA\xE5\x91\xBA;\x8E\x96\xC5 Q\xB8\x03\xED5\xF6b\xF4\x1A{2\xD6\xD8\xD7\xEFP\x92pG\x94.\xA3\x19" +
                "\xACA\xF3\xC5\xB9`\x8D\x928N\xCF\xF3\x8E\xC1\x02Z\x9F\xB8\xEF\x10\xB7\xAA\xF8\\\x13\xC4\x1AJ\xBE\xE0" +
                "Y\x03\x99_\xBC\xF9bO\xCF\x17\xFB5\xF6\xA3\x81\xCD\xA8r\x17;D\xA6@\xDE\xE7\x13\x94\x97\xB5\x9B\xC3" +
                "\xF2\xF8\xE7/\xD2\xF3\xC5Mm\xDFQc\xC7a\xB3F\xCB\x975Z\xB1X\xA3\xC2\x17{\x0A\xBE\x00\xF6&\xFB\\\x16x" +
                "\xE6\xC2\xB8\x93\x08\xE3\xA1|\xE10E\xA7&\xA6\xA0;\x8B\x89\x15\xCB\x0FQ\x8F\x13\xF8 \xE2\xE8\xB2C\x88" +
                "\xDE\xC4<\xCD&\x89:\x8ED\xBB\x95\x1A\xF6)\x11{\x8Dv\xEC^\xC3{\x87\xA2hL\xCF\x04k\xC4\xE5\x8B\xD4\xEA" +
                "\xCD \xC5\xF0\xEE\x9BKxd\x84\xB8c\x0F\xE4\x8EV\xEC}J\xC4^\x03\xD0Fv\x19\x0Ek\xC4\xE1\x0E\x01k\x0C" +
                "\x95)Vj\xF4z\x1E\x09%\x0E\xBF\x1E$b\xC71\x96\xA6\xE3h\xC5f\x8D\x96\xC3\x1A\x8A4\xE1z\x8Dv\xDA^\xC3" +
                "\xA3\xCB8H\xD1e\x883%\xFA\x14\x03q\xC49h@\x09-\x86\xC7\x17(k$\xED8Z\x8Eo\x85\xB3\x86\xA2\xD7\xD8\xD3" +
                "\xF7\x1A{\x1A\xBE\xD8\xD7\xF3\xC5\xBE\xAC\xCB8\x88\xC5\x17n\x971\x1E\xAF\xCB\x98 \x99\"mg!x\xB7O\xAC" +
                "\x0C\xDE\xEA}\xBF2\"\xBE\xFC\xCC\x03\xE2\x9878\"\xC4\xEBx$\xD5\x9E%)wD\xB8\x1B\x96l\x9F\xE2q\xD3<" +
                "\xE2\x0E%i\x97Q\x07k\xAC\x08Y\xE3\xE8\x9C\xB3F\x8F8\x8C\x13~S\xE2\xC7(\x1F\xB3\xE3\xD0s\xC7\xCD\x98" +
                "\xDC!VA\xAF\x91x\x9FR\xE5\x0E\xD9\x0Ee?\xC2\x0E%\x06k(\xBB\x8Cf\xB2FM|\x91B\xBD?O\x91\x86/\x02XcA" +
                "\xC7\x1AT\xA6,:\xAC\xE1q\x1B=\xB0+E{\x8D=M\xAF\xB1\x17\xA5\xD7\x88\xD8\x8F\x06O.\x07\xF53\xC5\x04" +
                "\xC9\x14u\xB4\x9E+*\x7F\x8C\xF9\x89\x00\x8F\xFCL\xEDg\xEBu\x1C;\x88\xDE\x1Ck\x06k\x8C\x85\xB1F\x8B" +
                "\xD9\xA1\xEC\xC6\xB9\xBB\xB1\xA4I\x878\xBD\xC6~\xDB\xE95\xDA\xB1{\x0D%_\x1C\xF8v\x19<_\x90Lq\xE8\x9C" +
                "\xFF\xC3\x88\x9D\xC5\x84\xCB\x11\x89Y\xA0\xE1jt\x1CZ\x15\xF0\x08\xCD \x11;\x0EY\xD64\x90;\xF8}J\xDB" +
                "\xE95\xBC7\xB2\xEA^#\xF0\xF6W\xE4{_\xA3\xC6\x1AJ\xA6\x18roJ\xB1\x09\xF0\xF9\x0B\xF2\x843\xDE\x9FG" +
                "\x04{\x961\x87A\x9A\xC3\x1D\xAD\x01w(z\x0D\x9E;\xDAA\xBD\x86\x9E;\x84\xAC\xA1\xEF5\xC6\x9D^c\x04X" +
                "\x83\xE2\x8B\xA3:{\x07H\x8F\x13\xFBt\xC4!\xE8>\xC6\xA2\xB0\xC6\xF0:\x0Eh\x87\xB2\xEB3\xBF\x0C\xAD" +
                "\xD705N?\x1A\x95/\x0E\xD2u\x19\xF51\x85\xF1\xEE\xF5c\x84Q\xD7\x1Eqx\xF1E|\xD6\x18\x0Bd\x8DE\x1Dk\xB4" +
                "\x86\xCA\x1AN\xAF\xB1W\x7F\xAF1Z|1\x11c?2A2E\x1D\x8C\xB0\x0A\xFAc\x89\x9F\\-\xFF$\x82\x97\xFE\xBD" +
                "\xD8g\xEE\x11\x87\xFB\xDC\x14{\x7F\x06\xF1\xEFV\xCF:w\xB4\x1D\xEE\xD0\xF7\x1A\xFBQ\xEE\x80\x05\xEFP<" +
                "X\xE30\x905b\xF7\xA3\xC7(k\x9C\x03\xBE\xC0\xB4@O\xFB|J\x06iF\xC7as\x87\xF2\xEEFK\xBFOi\xF3\xBD\xC6^" +
                "\xCC^\xA3#\xEA5\xC6}w(\xE3\x0Ew\x8C\x87}\xC7\xA4>\xD6\xA8\xA1\x8F\x90\xF3\xC5j\x02\xA6\x08\xF6\xF4g" +
                "\xC6\x88#\x805\x16T\xAC\xE1\x91)7\xA5\xFBZ\x01k\xC0i\xA2\xDC\xA1\xB4\x9C\x1D\x8Abra\xF8bO\xD8kx\xDE" +
                "\xFB\x8A<\xB9$\xE1\x0B2M\x0Ek\xEB,\xD2v\x9C\xAB\x84?N\xEC\xA1\xBF\x97\xFB\xCC\xC5\x98\xAE\xDD\xA4Y" +
                "\xC3?\x17\xDC\x8EC\xC3\x17@\xC7\x81\xF3\xC5\xAE\xD3k\xECr\xB9\xB0\xAB\xE95\xF6|{\x8D\xBD\xF8\xBDFg_" +
                "\xC3\x17\x075\xF0\xC5\x84\x93\x08\x131\xF6#\x06S\x1C9L\x11\xDC_ \xEC\xE0\xF7>\x1Fu\x95\x10\xC7\x8E" +
                "\x92G\xBC;\x0E\xEF>\xB5a\xDC\xB1\x94\x88;j\xEA5\xA2\xDC\xFEb\xEE}E\xDE\xC2Fe\x8D\xC8=\x85\x9C/\x8E" +
                "\x1B\xECa\x1E\xE9\x07\xC7\x82\x91\x02i\xFB\x0E!w\xDC\xE4;\x8EFsG\x99\x0Ed\xAF\xC1\xEFS\xDA\x0Ew\xB4" +
                "\xF5\xBD\xC6xX\xAF\x01\xB1\xC6A\xB2.\xE3\xF0,\xB1F\x0C\xBD\x95\xD8\xFBh\x11\xCA\x1A\xE2}\xCA\xD8\xB0" +
                ":\x8EE\x9B5\xA84\x11\xEFPZ\x0Ek\xA8\xBE\xE1\x86\xF0\xC5^\xFC^\xA3\xE3\xDDk\xA8\xF8\xE2 \x02_P7\xBB" +
                "\xBC;Q\x94)\xE2p\x04\xCD\x0E\x91\xDA\xCAt\x13\x87\xB7/L\xD6\x18\x03|\xFD\x1D\xC7\xCD\xDA;\x0EA.t\xFF" +
                "D\xD1k\xEC\xF9\xECP\xA0^\xC3H\x81}a\xAF1\x1E\xD6k\x8C;^\xCC\x17\x87\xFA.\x83\xCF\x85\x09r?\x12\x91)" +
                "\xD2\x9C^\xFC\x9D\xBF:\xF8\x93\xE6{\xFB\xF3\x87t\x1C<\x83(\xA7\x1B\xB2\xE3\x88\xC6\x1D\xC2^cWw\x1F" +
                "\xCC\xA31\xF5\xD8\xA7\xF4\x93\xA5\xED\xF4\x1A\xAA\xAE4\xCA\x0E\xC5\xEB\xDE\x97xri&k$\xE3\x8B\xE6\xB7" +
                "\xA1\x96\xE7\x82#\x11\x83\xD4\xCB\x1D-\x82;\x16\x93pG\xDB\xD9\xA7\x0C\xAB\xD7\x18\x97p\x07\xBEC\x19" +
                "\xD7\xCD \x02\xD6X\x1E*k\xB8|\xB1\x92\x92/V\xBD\xF8bX\xAA\xF9\x9CEm\xAC1&d\x0Di\xA6\xA8\xD2$\x0Ek@" +
                "\xBD\xC6\xAE\xAE%\x8D\xD4k\xA8rd<\xC6\x8D/\xAF],\xB2\x85]a'\x17\x8FN4\xCA\xE4Ra\x8A4\xBC o.\xEB\x9DG" +
                "\x94\xAD*\x1A\x1Ct\xDF1\x16\x835\xC6\xA4\xACqS\xC8\x1A\xB2^\x03e\x8D\x96\xE3[\xFA\xBB\x1Bmc\x06\xF1d" +
                "\x0D\xB6\xD7\xE88^\xD5k,\x1F\xC8\xF8B\xD4kL8\xE9\x10\xB1\xCB\x08L\x84I\xB2\xBFH\xC5\x11\xA7:\xE9\xE5" +
                "5zK\xE9\xA5*\xFC\xCC\xC5\xBF\xE6\xB6#\xD5\x1C#\xC9\x1D\xF8>eW\xB7O\x09\xED5\xF6d\xBD\xC6~\xFC^\x83" +
                "\xBB\xFD\x15p\xEF+I\x97\x11\x8F5\xD0{\x0Au\xF1\xC5\xE8\xF4\xA3\xCE\xE7W\x8C*\x00\x83\xD4\xDAq4\x80;D" +
                "\xBD\xC6\x9E\x8C5\xF6\xE2\xF4\x1AR\xD68\xA8a\x87\"\xEE2\x0E\x93\xB0\xC6*\xC5\x1A\xFE\x9DE\xAD|q\xAB" +
                "\x01^\xC4#\x83\xE0\x88\xC0\x1D\x01\xC9\x92\x9C5\"\xDE\xDDhiXC\xCC\x176k |\xB1\xCF\xE6\x88\xBA\xD7" +
                "\x88\x9A#\xCA-\xAC7_\x1C\xEB\xD3\xA4{\xFE\x8Fb\xB4\xA1zvX\x8D\x935\xC3\xF5\xA6\xE2\x1D\x07\x99\x08" +
                "\x89:\x8E1\x15k\x94|Qa\x8DV\x18k\xB4\xFCXcI\xC7\x1A\x08_\xEC\xB3\xBD\xC6\xB8\xC3\x1A\xE3\x9A^c\\\xDE" +
                "k\xD8\x89\xD0,\xBE\x98t\xF8\"&SD\xE8#\xE8w\xFB\xAD\xC9\xB5\x11\xF4\xC6\xBFK\xF1\xFF\x99\x1DG\xA5\xEF" +
                "\xD8\x0E\xEB8\xBC\xB9c'\x1Aw,\xCA\xB8c\x91\xE7\x8E\xA0}J\xEA^\x03\xD8\xA1\xEC\x07~\xAB\xCDk\x17\xABj" +
                "I\xF9\xEF\xB0\xC5g\x0D\xCF\xCE\x02\xEA)j\xE5\x8BT\xB3I\xC8gSu\x1C\xF1\x18d\xB8\xDC\xE14\xA0\xDC>e" +
                "\x17g\x8D\x80}\x0A\xD3k\xEC\xC7\xED5p\xD68\xA0Y\x03\xDD\xA1\xAC\xA8w(\x08k\x1C5\x9F5\xEA\xE3\x8B&" +
                "\xA8\xE0s\x16=\xB2\x88\xC1\x1Ac\xB1Y\x83\xCC\x14\x9E5Z\x0Ek\xB4|Y\xA3e\xB1\x86\xB0%U\xEEe\x1D\xBE" +
                "\xD8\xF7\xE85\xC6}{\x0D\xE1\xCC\xE2\xB5\x85=\xD2\xE7\x88n?\x12\xD6_(8\"v\xDF\x09=\xC3\x9FD\x80\xD9" +
                "\xC4\xF2\xC2\x8E\xC3N\x87\xB1\xFAYc\xB1v\xD6X\xD2\xB3\x06\xA9\xC3\xED5\xC6\xF5}'\xD3k\xD4\xC9\x17" +
                "\xAB~|Qa\x8A8\x9DE\x00/L\x89\xFCm\xC2OE\xF2\xDC\xDF\xC5\x7F\xCEA\xC7ar\xC7\xB6\xC3\x1Da\x0CR\x0FwP" +
                "\xFB\x14\x01w8\x8Di\xAB\xA6}\x0A\xDCk\xB4\x13\xF5\x1A\xD5\xDB_1w(\xD4\xEF\xE6\x12d\x8A\xE7\xBD\x0C" +
                "\x805&\xA3\xB0FR\xBE\x88\xCB\x0B\x01\x13\x877\x8F\x14\xF2\\`\x18d\xF8\xDC\xD1\xCB\x88\xFA\xF7)m\xF9>" +
                "\xA5\xE3\xCB\x1D\x15\xD6\xD8gz\x8D\xE5\xD0^\xE3\xCC\xB3\x86\xBE\xB3P\x9F^9S\xC8x!\x85\xFA\xB1\x09" +
                "\xD0q\x04\xB1F@\x9A$d\x8D\x96\xFE\x9E\xA8\xCD\x1A\x82\x1DJ9\xB9\xA4\xEF5d|\x01\xF4\x1A\x1C_\x1C\xC8n" +
                "y\x1Dj\xBFo\"\xE82\x8E\xBC\xF7#R\x153\x85\x8E#\"5\x9D~\x93K\x0C\x0F\xFF\xBD\xAC\xCA:\x0E'\x1D\xAA" +
                "\x1D\x87\")zY`\xF81=k\xB4\xC2X\x03\xEF5v\xF5;\x94\xBDH\xBD\xC6\xBEO\xAF\x01\xECM\x0E\x82\xF9\xE2P" +
                "\x93\x0E\x87\xDC\xDCA\xA5\xC3\xA4\xC3\x17\x93*\xBE\xB0\x99\xE28>S\x08f~\x1D/\xAC\x05\xFB\x10\x0D\xFF" +
                "\x0C}\xEDw\x1Cs\x0Ew\xA0\x0C\xA2\x9AhT\xC9\xE2p\x874Y\xF4\xDC\xB1(\xE5\x0E;YT\xFB\x94%\x8E;\x98^c" +
                "\x9F\xED5\xC6}{\x0D\xD5.\xD6k\x87\x12\xA3\xCB\x08b\x0D\xA0\xBF\x88\xD1YDoF}xA\xABq\xD9d@\x1C\xA2\xD9" +
                "d\xB4\xB9c\x11\xE6\x8E\x96/w\xB4\xF5\xFB\x94\xB6g\xAF\xB1\xEF\xD1k@\xB9 \xE2\x8E\xD1d\x8DH\xFB\x11" +
                "\xE5i\x8F\xC9\x17MS\xEE3C\x1D\x87o\xDF\x01u\x1Cj\xD6\x18\xF3f\x0D\xF8\xEE\x86\x905\xD8\x1D\xCA.?\xB9" +
                "\xA8\xEE\x9B\xD7\xDBk\xA8v\xB1\xCAf\xF4H\x93#G\xB2\x9B]\xC7\xFA\x1C\xA9\xF2\x857S$l=q]k\xB0G\xB4\xC0" +
                "r\xA1\xA1\x1D\x87\x91\x0E-\x0Dk\xB4\x84\xAC\xE1dD\xDB\xF2\x82\x1DJ{\xE0;:\xD6\x18\x97\xECP\xA2\xF6" +
                "\x1A\x13X\xEBI\xF1\xC5!\x97\x0B\x91\xF9b\xD2\xE1\x0B\xA9F\xEE,\"\xB0C\xF7\x91\xF9\xDB\xAC\xD7>\xF8" +
                "\xCF\x94~\xB6\x81zt\x1C\xDB5t\x1C\xB1\xB9Cww\xA3U\xE3>\x85I\x93\x0E\xC0\x1D\xC2^\xC3\xE3\xFBl\x13" +
                "\xBE;\x94&\xB0\xC6d\xDD\xAC\x91\x9E/\x9A4\x9B\x80\xC4!\xEAAq\xEE\xD8\xA9\x85;ve\xDCA\xECS\x84\xDC" +
                "\xB1\x87qG[\xBFO\xF1e\x0D\xBE\xD7\x18\xF7\xED5<v(\x13NF\x9C\x19\xD6\x98bY#!_\xF8\xB3C\xEA\x87\xE5" +
                "\x91\xA2\x11\xAC\xA1\xCB\x11\xB6%\x15\xDE=\xDFm\xE9w(m0M\x84\xFD\xA8r\x87\xE2\xF4\x1A\xFBqz\x8D\xE0f" +
                "4\x1E_\x1CE\xE4\x0B\xBE\x13UO.\x1CG\x04\xF1\xC2m\xD0\xFB\xCD,a\xDE\x9DG0_j\x81e\xC4XJ\xD6\x18\xD3" +
                "\xB3F+\x06k\x08w(m=k\x04\xF6\x1A\xE34k,\x03\xAC1.\xCB\x08\x8E/\x0E#\xF1\xC5\x11\xCC\x17\xF6wX\x8FR" +
                "\xF3E\x1C\xA6\x00\xD8\x81\xE2\x88\xA9\x8A\xC7\x9F\x0Bb?,\x15\x7FNU\xC7\xB1\xAD\xE7\x8E\x9D\x04\xDC" +
                "\xB1\xEB\xC9\x1D\x8B\x09\xB8c\xC9g\x9F\xC2\xF6\x1A\xE3a\xBD\xC6\xB8\xE6nh\xE0\x0EeBs\x1F\xB4F\xD6" +
                "\xB8\xE5\xC7\x1AT3\x1A\x89/\xC2\x99b*I?\xAA\xE3\x11\xBA\xE3\xD8\xFEW\x13\xB8c\xD1\x97;\x86\xBEO!u" +
                "\xDC\xB9'\x1A\xB3\xD7X>\xC0w(\x87\xF2\x1D\xCA\x84\xC7\x0E\xE5|\xB1\x86/_0zgH^\xCA#E kDI\x93\xB1\xA1" +
                "\xB2\x06>\xB9\xECR\xB7\xBF\x04\xACA\xF6\x1A\xFBD\xAF\xC1\xE4\xC8\xF2\x01\xB779\x90\xF1\x85(A\xC43" +
                "\x8B\xB0\x19\x15v\xA2\x15\xBE\x90\xF5\x17\xC7\xF1\x99B\xDD}\xC6\x9BV\xD6\x9A2\x95T\xFC`T\xA9\xA1\xE3" +
                "\x18sYc\xC1\x935Z5\xB2F\xDBb\x0D\xD1\x0EeO\xF2\x9D\x94a\xF7\x1AQ\xF7&6_\x1C\xE9\xF9\xE2X\xC7\x17\x0C" +
                "S\xDC\x0Ag\x0A\xAA\xB3\x08`\x87\xE9\x9E\xBF\xE3\xEDc\xE9T\x90/;\x8E\xED\x7F\xB9M\x87\xEF\x9Eel\xBEv" +
                "\xEE\xF0\xCC\x94Z\xF7)\x09z\x8D\x03\xAE\xD7`\xB8#\xDD\x0E\xE5L\xB2FZ\xBEh\xF2\xB4\x02}\xE6B>\x9Bh" +
                "\xB8c'\"w\xB4bp\x87l*\xD9m\xEB\xB9C\xB5O\x11\xF4\x1A\xFB!\xBD\xC6\x84\xBE\xD7\x08\xDC\xA1\xD4\xC3" +
                "\x1AS\xF1Xc\x8Aa\x8D!\xF0\x05\xAC\x17\x86\xE4elR0\xAC\xC1\xF5\xA6\xC3\xEA8Za\xAC\xD1\xD2\xB3F[\xC6" +
                "\x1Am?\xD6H\xDFk\x08\x9BQq\x8E\x90[XE\x8E\xF8\xF3\x85\xA6\x0D\xF5\x9EY\xBC[O\xFA\xDDn\xEBt\x83=\xF8" +
                "\xEF\x82mU\xCC\x8Ec\x1B\x98>\xFCYcG\xCD\x1A\x8B\x1Ck\x18\xDDg+\x8C5\xDA\xE8\x0E\x05e\x8D\xB6f\x872" +
                "\xAE\xBF\x1B*\xEB5\x0E\xBC\xF6&\x87\xF2\xBD\x89\xE0\x0E\xE8\x11\xCE\x17\xC7\x09\xF8\x02\xDA\x8F L1E" +
                "\xF4\x17\xCA\xA9A\xCA\x0E\xF4\xBB\x1D\xD0;b\x1F\xA2\xB7\xBD<\xF0\xEF\xE2v\x1C\xDB\x1E\x1DGD\xEE\xE03" +
                "E\xBAO\xB9\xA9\xD8\xA7 \xDC\x91\xA6\xD7\xA8\xA6\x09\xDAk\xEC\xFB\xF7\x1A\xFD]l\xAD;\x14\xB8%eg\x96" +
                "\xA1\xB1\x86t\xCF\x1A\x89/\xFC\xDB\xD0\x94\xB3\x897\x830\x1DG2\xEE\xB8\xD9\x08\xEE\x08\xEF5\x04\xFB" +
                "\x94q\xFD=Q\x875\x0E|z\x8D\x15\xA6\xD7\x98\x90e\xC4\xA4~\x872\xB9rFXc\x9Ad\x0D%_\xA4\xE3\x88\x14\xCA" +
                "0H\xA1g\x8D\xED(\xAC1\x16\x835Z2\xD6h\xE9\xEFn\xA8XC\xD9k\xEC\x0Fv(\xA2^\xA3c\xE6\xC8A\xBA^C0\xB3" +
                "\xD4\xCE\x17k\xBE|\xA1\xEA/<w\x1C1x\xA1\xD69\xE5N\xAC9e\xBAG\x1C\xA9Yca\xC7\xB8'\xAA\xEE8ZB\xD6\xB0" +
                "\xF9\"!k\xB4+;\x94=\xBE\xD7\xF0g\x0D~\x87\x82\xA7\xC3!\xD4w:\x19a\xF3\xC5\x91voB\xF2\xC5q\x84]\xC9" +
                "\x9A\x1F_x2\x85t\xC7!>\xDB\xD3*\xBF^\xFE\xC7\xDA\xFC\x94\xE5\x05\x9F\xD3\xBB\xE3\x18\x1Aw\xB4\xA4" +
                "\xDC\xB1\xCBe\x0A\xB1O\xD9m\xA1])\xC9\x1D\x9DA\xB2h{\x0D\x98;\xC6}{\x0D\x9F\x1D\xCA\x8Ab\x87\x82\xB0" +
                "\xC6Q]\xACq\xDB\xC8\x14Q\x7F1\x15\x835\x02\xF8b\xB4\xE6\x14\x9EM$\x1D\xC7\xB67w\x8C\xF9rGkQ\xC8\x1D" +
                "\xE5lB\xF6\x1A\xBB^\xFB\x94\x0Aw\xB45\xFB\x94q\xED>e\xD9\x9DG\x0E\xBCXC\xD6k\xC8v(\x93\xFA\x1D\xCA" +
                "\x19a\x0D\xCF=HD\xA6\xB8k\xFB\xF5\x04\x1E\xF8\xBB\x04l\xD2\x0B\x8E\x922\xFCYc\xACN\xD6XL\xC5\x1Am" +
                "\x0Dk\xB4A\xD6 v(\xC2\x99E\xD9kLhXC5\xB3x\xDC\xD1pf\x16\xC1-/gW\xC2\xE5H0_(\x99\"\xA0\xA7\xB8\x13a~Y" +
                "\x17y\xEC\xB4\xEB~\x0E\xF7yL-\xE2\xB1\xC6\xCEH\xB0F\xDB\x975\xDA\x1A\xD6\x18\x8F\xCA\x1A\x13r\xD6" +
                "\xA8\xF6\x1A\x13\x9A^\xA3\xA7\xC2\xBD\xC9j\x99\x142\xBE\xE8e\x84\xF0\xDE'\xCE\x148_\x00Lq;\x06S\xF0" +
                "\xE7\x8Ag\x87\xCA;\x7F\xD4\xF548\xFE?\x9B8\xEA\xE5\x8EJ\xA6\xDC\x8C\xD3\x98\xC6\xD8\xA7\xA8\xEE\x89" +
                "\x8Eb\xAF\xC1\xCE,\x93a;\x94\xE1\xB3\x86bZI\xD2\x89N\xF90\xC5\xDDi\xA1\x8F<\xA1\xDC\x9DV\xF2HQ&E\xAD" +
                "\xDCqS\xC2\x1D-6)\x9C\x8C\xD0\xEFSv=\xF7)\x1D\xD9>\x85e\x8DN\xE4^\xA3\x9E\x1D\x8A\x8E5V\x15\xAC194" +
                "\xD6\x90v\x16C\xE4\x8B\x99H>\\\xB1\x8Ec\x9B`\x8D\xB1T\xAC\xB1\x13\x9D5ZIYC\xBCC\x89\xDAk\x1C\xA0\xBD" +
                "\xC6J\xCC^cR\xD8k\xD83Kd\xBE\x90\xDE\xE9B\xF8\x82J\x90H92\xE5\xD3n\x8E\xFC\xB4\x92\xB6\xE3\x18\xF3" +
                "\xED8\xFA\x9A\x8A5\xDA\x1Ck\xB45\xAC\x91b\x872\x84^\x03\xD2Ij\x069\x0E\xE7\x0B\xEF.\x03J\x04\x9C/" +
                "\x94\xFD\x05\xCC\x14\xEB>)`\xBF\xF3\xD7M\x7F\xD7\xF43\x96_7}b\x85>\x03\xFC\x99\x07\xC4Av\x1CI\xB8cL" +
                "\xDFq\x88\x1B\xD3\x9B^\xFB\x94]j\x9F\xB2\xE4\xB9O\x19\xB7\xF6)>\xBD\xC6AH\xAFQ\x0FkL4\x975\xEE\x84" +
                "\xB1\x06\xD7S\x9C#\xBE\x00\xD4\xAF\xE3\xD8\xF6\xE7\x8E\x05t6i\xE9\xB9\xA3\xC5\xDE\x19\xADy\x9F\xD2" +
                "\xE1\xF6)\xFE\xBD\xC6A\xDC^\x83\xDD\xA1\xA8X\xC3\xBD\xA3\xD1X\xD6\x80\xF9\xE2B\x1D|\xE10\xC5\xA8(" +
                "\xF0\xF9\xDD\x8Ec[\xCF\x1A\xDB\xFE\xAC\xB1\x10\x935Z\xBE\xAC\xD1\xD6\xB0F[\xC6\x1A\xE3\x1A\xD6H\xD1k" +
                "\xB03K\xA5\x19]e\xEE\x83N\xEA\xF7&S\xEC\xFE\xD5\x9B/\x84\xB7\xB9\x02\xFB\x8B\x04\xADg\x99,\xFDs\x88" +
                "\xF8\x1As\xE1Bef\xA1>\x9B\xF1\xF9\x99\x8EcL\xC3\x1Ac\"\xD6\xD8\x89\xC8\x1A\xADX\xAC\xB1\x84\xB3F\x07" +
                "f\x8Dq\x905:\x1Ck\xD4\xDEkL\xFA\xF6\x1A\x93\xB2\xFB\xA0F:\x1C\xF3w@C\xF9\xE2v\x85/.\xF8\xF2\x05\xD3_" +
                "\xE89\xA2\x8E>\xE2\x9E\xE9g\x06\xFE\xA2\xC0W\xFFo\xA3|\x1E\xAC\xE3\xD8\x0E\xED8\x16\xE2s\x07\x99&" +
                "\xBB\xA2L\x81\xD3\x84\xDD\xA7\xEC\xB5\xB5\xFB\x14\xC1=Q\xA7\xD78\x18\x95^Cs\xE3\x8B\xFF>k\x14\xD6" +
                "\x98\xD6\xB1\xC6\x1Dff\x09`\x0D\xE3]M\xF2\xC5(\xAA\xF1\xF9\xAD\x8Ec;\xBC\xE3\x18\x0B\xEB8\xAAw7\"q" +
                "\x87=\x95\xB0\xFB\x14\x84;\x90}\x0A{O\x14\xE95\xAAI\xB1\\\xE1\x0Ea\xAF\x91b\x872\xA9\xD9\xA1De\x8D[" +
                "\xD2.C0\x83D\xE9/\x1C\xD6\x88\xDES\x18\xEF\x7F\x86\x1D\xEE%\xF0rNq\x88#~\xC7\xC1\xB1\xC6X\\\xD6X\xAC" +
                "\x835\xDA\x11v(6k\x8Cs\xAC1A\xCF,\x01\xBD\x06\x99 F\xAF\xB1J\xE4\x08\xB8\x85\xE5\xF7&\xD2N\xD4\x83/T" +
                ";\xD78LQC\xDFy\x8F\xF7\x17\x11\xBF\xAE\xF5\x0A-L\xD6\x18\xA3:\x8E\xED\xD4\x1DG\x8BK\x8A\x96\x865\xDA" +
                "\xBE\xAC\xD1\x96\xB3F'\x02k8\xBD\x06\xCE\x1A\xB1{\x8DI\xD3s\xDF=\x99R\xB3\x06\x91\x0B\xB78\xBE\x10u" +
                "\x19\xD3N\x97\xE1q\xFF\xC2\xED/\"d\x01\xCD\x0B\xA3\xAE\xA7\xFF.\xA1\x1D\xC7X2\xEEh\x01wFo\x8E\xFA>e" +
                "\\rOtY\xC6\x1D\xFD4\x11\xF6\x1A\x93\x9A^\x83\x9CY\x88\x1B_\x82\x1DJ-\xAC\xC1\xF7\x17\x1E\xD3J\x94L" +
                "\xE1\xA6\x95\xAE\x9F)\xFD\xBD\x1A\xBD\x82GD\x1DG\x02\xEE\x80:\x0E\xD9\xF7S\xBE\xFFc\x1Cw\xB0\xFB\x94" +
                "]\xEB\xEEF[\xBFO\x19\xE7\xF6)\xE3\xFA}\xCA\x04\xF7{\xBD&\x8C\xA4\x802\xE2\xB0\x19\xBD\xC6\xED\xFEH" +
                "\x92\x8E5\xEE\xE8YC\xC8\x17w\xA2\xF0E\xEC\xF7\xFC\xBD\x04>H\x8B0\xD6\xD8fYcl\xF8\xAC\xB1\xABe\x8D" +
                "\xB6\x8C5\xC6\xF5\xAC\xD1\xCC^CpG\xE38\xFC\x8E\x06\xC5\x17k\\\x82\xC4\xE4\x0B\x15S\xF8\xF0\xC5\x0C" +
                "\xCB\x0E\xA36\xA1L[~\xFD^a\x80F\x9C\x8EcL\xD6q\xB4\x18\xD6\xB8\x89\xB1F_E\x0D(\xACvF\xF8\xEDP\x18" +
                "\xD6\x18\xC7Y#]\xAF1\xE9\xD1k\xB0|\xC1\xDD\x07\x9Db\xF7&\xC2t\x88\xD9eD\xE0\x0Bj\xEF\x10\x85\x1D\xBA" +
                "\xCF\xFA=\xD3\xCF\x82\xFEb\x02\xBF\x8Ez\xE3\xF3\xA0\xCCRS\xC7\xE1\xF1{}\xA4\xDF\xAC\xF7\xDC\xA7H\xB9" +
                "#\xC6=Q\x82;\xA8{\xA2l\xAF\xE1\xC3\x1A\x91z\x0D\x19k\xDC\x12\xB2\xC6T,\xD6X\x8F\xC8\x1A\xBAi\x05\xE3" +
                "\x8B&\xCD&1\xE7\x97\xA2\x9A\x11\xB1\xB9\x83\xC9\x88\x9D\x80;\xA37\xE3\xDD\xDD\xD8c\xF7)\xE3\xB2}J" +
                "\x82^\xE3\x10\xEF5z:\x99\xA0\xD7\x10\xEEP\xA6\xD6$;\x94\xDE\x1D\x0D~\x12I\xCD\x1A\xE2\xB9#)_\xC8\x99" +
                "\xA2N\x95\xB3I\xD7H:\x0Ea\x9AP\xAC1\xD6\x0C\xD6\x80g\x96d\xAC\xD1\xDF\xA1\xEC\xD3;\x94\x09zf\x89\xC5" +
                "\x1A\xEA^\x83\xD8\xC2F\xBB\xA3\xE1\xC1\x17A\x09\xE2\xD5_\xB8\x9DE\x04v\x80\xE6\x94\xF2\xC4\xAE'\x9BP" +
                "\\\x0F}\x06vf\x09\xED8\xC6\xD4\xACQ\xE98\x94w7\x98\x8E\xA3\x9D\x8C5\xC2{\x0D\x11k\xAC\xF8\xB0\x86" +
                "\xB0\xD7\x98T\xF5\x1A\xA2\x8C\xD0\xEDM\xA6\x89^#\x06_\xCCh\xF8\xC2\xED/\xA2q\x84\xCF;\xFF>\xE9I\xBD$" +
                "\xF0\x8C\xD2\x9F\x01\xD6\xEF\xC4qC\xD6q\xD4\xC1\x1D\xAA\xC9E\xB0\x97M\xBFO\xE9\xA4\xDF\xA7$\xED5V" +
                "\xE3\xF4\x1A\x8Df\x0D\x9F\xFE\xC2\xE9,\xFC\xF9\"\x1AS\xD4=\xA1\x90<\x12\xD6q,xsG\xF2;\xA3\xC2}J{\x18" +
                "\xFB\x94\x09n\x9F\x12\xAB\xD7\x98T\xF5\x1A\xF6\x0E\x85\xEA5\x86\xC8\x1A3qY\xE3\xA2\x865\xFC\xF9B\xC0" +
                "\x14\x97\x1A\xE6\xC9\xCFLw\x1C\xDB#\xCD\x1A\x11v(\x08kT\xB3c\x1F\xEEG\xD9\x9B\xE65\xB0\x06\xDC\x89" +
                "\x1E)\xB7\xB0\xC7\xF8\xFFN\x12\xBB7\xB9E%\x08y\xBFkz\xE0U\xD3\x8A\x92/\xF4\xFD\x05\xDAS\xE8y!\xF1" +
                "\x84\xA2\x98V\xD4\x93\x0B\xD8ql'b\x8D\x96\xB3O\x11\xB2F\xAB^\xD6\x18\x97\xB1Fu\x87R+k\x84\xF7\x1A" +
                "\xD2\xBD\x89\x865\x02\xF8\xE26vk\xCB\x83/f\x1C\xEF\xD1_\xC4`\x0A\xE0$\xCF\x0E\xFE\x84\xF3}\xBD_\xA3" +
                "\xE7?\x9BI\x1C1:\x8E\x05\x80;\xC6h\xEEX@\xB9\xA3\xA5\xE1\x0Ej/K\xA5\x89z\x9F\x92\xF8\x9Eh5Gx\xD60" +
                "\x95\xEF5\x04\xF7\xBE\x8E\xFDv(\xF8\xB42$\xD6P\xEEJ\xF4\x99\"\xEA)\x14\xC92\x02\xD3\x0A\xC0#D\xC7" +
                "\x11\x8F;\x88;\xA3B\xEE\xE0\xF7)\"\xEEh\x0Fc\x9F\"\xBC'\xCA\xB0\xC62\xDBk\x1C\x0D\xB1\xD7\xE0\xEE" +
                "\x83\xF6\xFC\xB4\xC3\x1D\xA9X\xE3\xA2\x8E5\xDC;\x0B5\xF0\x85\x8C\x05\xEAT\x05\x8F\xE8:\x8E\xB1\xB3" +
                "\xC5\x1A\xEDzY#R\xAF\xC1\xB1\x86bf!\xA6\x95c\xFC^9\xD5k\xA8\xBEo2\xCD\xEEM\xC2\xF8\xA2\xDB}z\xF7\x17" +
                ".Sx'\x88\xED\xA9L\xB9o\xF9x\x99\x02\xFF\x1C\xE8\xEF\xC5\xE7\x94\xFE\xBFKaf\xC4X/#\xD4\xAC1\xA6f\x8D" +
                "\x9D\xC8\xAC\xB1\xD4\\\xD6hZ\xAF!\xE5\x0B\x825\xCAID\xD7k\x10|\xE1\xB2F\x1D|\xA1\xEB/Xv\xB8\xA7;\xE7" +
                "\x97H/{\xE6\x04\x9E\x7F.\x8A}_%\x1DG\x83\xB8C\xB8\x97%o\x82\x11]\xE9^\xF8>e\x9C\xE6\x0E\xC1=\xD1\x09" +
                ",M\x08\xD6\x80\xD2D\xD5kD\xDA\xA1\x8C:kxt\x16\x1E|A3E\x13\x94\xE7\x11\xB0\xE3\xA8\x83;\xA0t\xA8$\x85" +
                "\xC7\x9DQ\xF6^y\x9BH\x0A\xFD>e\x1C\xDF\xA7LH\xB8c\xC5\xCD\x08\x9B;&1\xEEX=r{\x8DI!w\xAC\xA1\xB3I\xBA" +
                "\x1DJ\xA3XC\xD1_\\\x12\xB2\x86\x17_P\xEC\xF0@\xEC\x1F\x08\xBC\xFCgJy$a\xC71\xC6\xB1F\xEB,\xB1\xC6r" +
                "\x00k\xAC\xB83\x8B\x985\xAA\x09\"\xBEc~,\xEF5\xA8ieM\xB47\x99f\xF7&D\x82\x08\xEEe\xCCh\x13\xC4\xA3" +
                "\xBF\x90\xF5\x14\x89\xE7\x94\x07\x91\xBC\xEF\xCCb\xE8\x10:\x8E\x16\xF0M6\x805Z:\xD6\xD8\x8D\xC1\x1A" +
                "\xA6\xCAXc\x19f\x8D\x09o\xD6\xA8\xEEP&\xB9\xA4\x10\xF4\x1A\x86*2\xE2\x96xor\x9B\xDF\x9B\x90w@I\xBE" +
                "\xB8\xA3\xE5\x8BYO\xBE\xF0\xCD\x02\xE8\xCC\xD3\xEC\xE0\xA9\x1B\x09\xBC\x97\x0E\x88C\xD0q\xCC\xD7\xC5" +
                "\x1D\xF8\xE4R\x99Y\x16j\xDD\xA7\x8C\xE3\xFB\x14\xD5=Q\xB6\xD7\x18\xC7XcY\xD7kL\x06\xF7\x1A\xAA\x1D" +
                "\xCA\xB4\xA6\xD7h\x04kx\xF5\x17\xC9\xE6\x14\x98\x0B4\x93H\x88\xB7\xD3\x8Db\x13\xE3\xF3\xFBw\x1Cc\xB5" +
                "t\x1C\x04w\xB4\x17k\xBD\xBB1\x1Ei\x9F2\xE1\xBDOY\xAD$\x05\xDBkLiz\x0Db\x872-\xDB\xA1x\xDC\xD1\x88" +
                "\xCF\x1A\x175\xAC\x01\xF5\x17\xF8~D\xD8S(\xF9B\xCE\x08\xA5>\x88\xE4\x83\xD8d\xD0q\xDCpYc\xAC\x96\x8E" +
                "\xA35\x0C\xD6\x90%\xC8\x1E\xCB\x1A\xE3\x91X\xC3\xA7\xD7X\x19R\xAF\xC1\xDE\x07%\xB2\x83M\x10\xB6\x13" +
                "\xF5\xE2\x0Ba\x82D\x99S$-\xE6\x90'\x14\xAF\xC9\xC5\xE2\x94bL\xDFq\xF4Yc[\xC2\x1A\xADa\xB3F;=kLhX\x83" +
                "\xDD\xA1L\xAAv(\xAB(k\xC4\xEA5\xA6\x89^\x03\xC8\x88j\xAF\xD1K\x07\x11k \xDF1\xB9\x0B~\x87\xD5\x83/f" +
                "\xFD\xF8\x02\xBA\x1F1G3\x85\x8E\x17~\xE8\x9C\x97\xD7\xAA\xFE\xEF\x828e\xE3\x81\xDBq \xDC!\xEC8\x88" +
                "\xF9e\xC1\x9F;\x84{Y\xFE\xD6\xB9l\x9F2\xEE\xB7O\x01X\x83\xD9\xA7L\xC8\xEE\x89Nbw\xC0\x08\xD6X\xF1" +
                "\xEF5\x82v(z\xD6\x98\x8E\xCA\x1A\xB3\"\xD6\xB8\xAFg\x8D\xFBX\xA6\xE0\xAC\x11\xC8\x14\x0F\x12\xCC&" +
                "\x9C\xD7\xF0Ha\xB2F\xBA\x8EC\xC8\x1D-\x93;\x169\xEEX\xDAE\xF7),w$\xDA\xA7,\x0FTrO\x14\xDA\xA7\x90" +
                "\xF7D'\xB9\xD9dJ\xF6=\x14a\xAF1\x0D\xF6\x1A\xCE\x0Ee4X\x83\x9DAd\xFB\x11o\xBE\x88\xC6\x0E\x1B\x91|" +
                "\x00\x9B\xCC\xFE\x08\x8E\x1Eed\xD6\x88\xCC\x1A\x13\x1CkL\xA4`\x0DE3*b\x8D\xE9\x90^\x83M\x10\xF2~W*" +
                "\xBE\xF0\xEAAE\x09\xC2\xA7\xC9h\xCD)\x0F\x08N\xA9\xA9\xE3h\x9DW\xD6\x98\xE0XcR\xC3\x1A\xEC\x0Ee\x8A" +
                "\xDD\xA1\x04\xF4\x1A\xD3h\xAFq\x07K\x8A\x99AR\xAC\xC3*\xE2\x8Bu\x1F\xBE\x98\x95\xF1\x85g\x7F!c\x0A" +
                "\x11/\xFCx\x1E:~XZ\xFD<8\xB3X\xC4\x91\x98;\x02\xEE\x8C\xB6d\xDCA\xA4\x09\xF5\xF8\xEFS\x10\xEE`\xEF" +
                "\x89\x92\xFB\x14\x9C5z*\xBCc>\xB4^CxGc\xC8\xACq\x9F\xEED\x15\x1BV\x8A/\x1E\xA8\xF8B\x905\x0F#y\xFF9" +
                "\xE5\x07q\x04v\x1CcpF\x04q\x87x\x9F\x82&\xC5\xF7?<\x9DM\xE4\xDC\x01\xCF&\xC6\x93\xE6;)+\xFC>e\x92" +
                "\xBB':%\xFB\xFEk\x84^C\xB3Ci$k\xB0\xFD\xC5}y\x7F\xA1<\xF3\xFEL1\x9F\xD8\xFB\xF1\x08\xDFq\x8CiXcL\xC1" +
                "\x1A\xD2\x8Ec$XC\xBFC\xF1c\x0Dh\x17\xBBz$\xFE\x0D=\x8A^\x83\x9BY\xA4\xBD\xC6\x0C\xCE\x1A3\xE0\xDE" +
                "\x84\xF8\xED\xC1\xBD\x8C\xA0r\xC4\xE3.F@\x03\xEA\xC1\x0E\xD5\xF7\x7FS&\x14.)\x1CN\xF1\xEB8L\x8D\xD9q" +
                "@\x19\xD1S\x15k\xB4q\xD6\x18':\x0E=k\x84~'e\x85g\x8D\xBAz\x0D8/\x8C\x07\xEE5fd\xAC\x01?\xE4\xDE\x84" +
                "\xC9\x08U\x97\x01\xF7\x17\xF7\xE9\xFEb\xCE\xE9/<\x98\x82~\xE7\xF7\xF4\xF2w}H\xFA\x87=\x1FK\xF9\xBF" +
                "\xB7\xF2\x09\xDD\xCF/\xED8RpGK\xD8q\xE0])\x7F\x13l\x89\xE0\x0E\xC5>e<\xF5>e\xC5lI\xA9^C\xB8O\x99Z" +
                "\x95\xE7H\xAA\x1D\xCA\x8C\xBC\xD7\xA8\x835|w%A=\xA8\xCB\x17\x0F\xCF\xC6\xB4\x12\xDEql\xAB;\x8E\x80" +
                "\xEF\xC5\xB6M\xA5\xB8cO\x92\x145\xECS\x88\xDF\xB8\xE1\x7FOtU\xCA\x1DM\xE85f\xB4\xBDF\x04\xD6\xB8?+" +
                "\xD9\x95p\xFDE}|\xD1du?\xB3W\xC7\xB1\x1D\x8F5\xE0\x8E\xA35\x0C\xD6\xB0\x13\xC4a\x8D\xF1\xF4\xAC\x91l" +
                "\x87r\x1C\xB1\xD7\x98\x96\xB3\xC6:\xD5k\x08\x9BQ/\xBE\xB8\x87\xDD\xE9R&H4\xA6\x10\xA4\xC9Cc:x\x98pB" +
                "\xA1\xD2\xC1\xFD\x0C\xD4\xB4R\x8C\x19\xDFg\x13&\x05\xDAq\xF4Y\xA3\xA5f\x0D\xE9>\xC5\x975\xEC\x8E\x03" +
                "d\x8Dq\x8E5&\xA4\xACq\x80\xB3\xC6\xA1\xEF\x0E\xA5\xA7S.e\xC4f\x0Da\xAF1#\xEF5\xD8t 2\xE2R?&$\x19At" +
                "\x19\xD5t\x98\x93\xF3\x05\x97\x02@/\xA0?\xBD\xF3\xB0\x7FT\xF1\x97\x09\xDF\xFD']\x0F\xFD\xF3\xF0\xCF" +
                "\xAF|\x06V\x1B\xD0q4z\x9F\xC2s\x87\x9E5\xB4\xDC!\xEF5\x8ES\xF4\x1Aqw(\xCDg\x0D\xB4\xBFp\xEFS(\xF8b" +
                "\xD8L\x11\x97G\xFA\x1D\xC7\x8D1 #\x80\xA4\x18\x93w\x1C\x0B\x1Cw\x80wF\x17\xFC\xEF\x8C\xB6\xB9\xBCH" +
                "\xB3O9pY\x83\xD8\xA7L\xC2\xFB\x94#\x88;<\xEF\x89N\x99\xC4\x01\xE5\x05\xCB\x1AD\xAF\xA1\xDE\xA1\\\x84" +
                "\x93bV\x9E\x11A\xAC\xF1@\xC1\x1A\x1B!\xAC\xE1\xCD\x17.S`\xEC\x90FiN\xC1yD\xDEq\x00i2\x16\xD8q,\xA2" +
                "\x1D\x07\xB1\x97\xAD$\xC8\xE2\xA8\xB2\xC6$\xC6\x1A\xFD\xDF\xB5!\xEE5BY\xC3\xAF\xD7\x10|\xF7\xA4\x9A#" +
                "\xEC-/\xA2\x13\xAD~\x875\x05_\x90s\x8A0A \xA6P\xE8#\xE3|\xF6\xFD\xE5\x81\x7FD{,k\xE6\xA4\xBE\xF2\xF7" +
                "J\x94\xE88*I1&\xEF8\xD0\x06t\x07\xEF5\x04\x1D\xC7\x12\xA6=\xD6h'd\x8DJ\xC71\x01u\x1C\x13\x03\x95\xF6" +
                "\x1AD\xC7\x01\xF7\x1A\x93\xC3\xE95n\xC7\xEF5\x90\x8C\x98\x95\xECM\xAA\xDF1\x014\x80/\x02\xF7 .G\xC4f" +
                "\x87G\x09\xBC'\xA7\xC0\x1D\xC7\x98\xA6\xE3\x10rG\xD3\xEE\x8C\x8E\x8Br\xA4I\xFB\x94\xEA.\x96g\x0D8G~<" +
                "\xD3\xDD\x1CY\xA3s$\xC5\x0E\xC5\x8F5\xEE\xC5a\x0D\xC5\xCEU\xD0_\xF8\xF2\x05\xCD\x14\xC9g\x13\xC1\xCC" +
                "\"\xE1\x11a\xC7\xB1]\xB2FB\xEE\xA0\xEE\x8C\xB6#\xDD\x19\x05u\x1C\xE4\x0E\xFF}\xCA\x81\xF7>%\xAC\xD7@" +
                "\xEF\x89\xF6\xD2a\xCD\xBF\xD7H\xCA\x1A3\xC9Xc\x0Ec\x8D\xEA\x8D\xA6\xC0\xFE\"\x8C/h.x\xB4\xB0\x99\xD6" +
                "\xFB\xF1H\x01\xB1\xC6\x8D\xB8\x1DG,\xD6h\x8F\x02kL4\x815\xD6|\x9AQa\xAF\xC1\xDE\xF5\x9A\x91\xF5\x1A" +
                "\xEC\xDE\x84\xBD\xDF\x95\x82/\x98\xFEB\xCD\x14\xD1\xE7\x91XO\xE8\xFC\xD2\x90\x8E\x03\xBE\xEB\xD5\x1C" +
                "\xD6\x98\x18u\xD6\xF0\xE95\x1C\xD6X/\xF3\x82\xBD\x0F:\xAB\xE95\x88\xBD\x09\xCA\x17\x97\xB4|aw\x19" +
                "\xF3\x1A\xBEp\xEFS\xE8\x99\x02x\xE7/\x98^\xA1\x8F\x03\xBCX)N\xF1\xEC8\x00\xEE\x18\x93q\x07wgT\xCA" +
                "\x1DD\x9AP92\xF4}\x0A\xD1\x8F\x0A\xEE\x89V\x13\xE4\xD8\xA3\xD7\x98\x8A\xDEk\x80\xF7\xCA\x1B\xCB\x1A" +
                "\x1B2\xD6\xD0\xF4\x17\x00_\x04\xCD)5M(\xC8\xB4\"e\x10\xB6\xE3\xD8v;\x8E\xB1\xC6t\x1Cm6/:8w\x0C}\x9FR" +
                "a\x8D#\xED=Q\x9E5\xF0\x06t\xFA\x02\x93\x17\xB5\xEDP\x86\xC9\x1A\xF8]\xCFy\xBA\xBF\x90e\x01\xC0\x17A" +
                "\x1C\x91B\xFD\xD9\xC4&\x0E\x8F\x8E\xA3q\xAC\x01v\x1C\x9D8\x1D\x87hfi\x1Ak\\\xF0\xDF\xA1\xC0\x09\"" +
                "\xEB5\xEC\xBD\x89\x1Fk\\\xBA/L\x10\x8F.c^\xC6\x17\x95\x1C\x111E\xE5\xBD\xBD@O+\xC9\xD3$\xCE\x14c}~]" +
                "\xC71B\xAC1\xCE\xB2\xC6\xD2\xE8\xB0\xC6Z%/\xC2Y#\xA4\xD7\x98\xE1z\x8DY\x9A5\xBA\xDF=\xB9tO|\x07\xB4" +
                "\xB27\xF1\xB8\x97\xA1\xE3\x0BM\x7F\xE1\x9B\x02\x80~\xFF\x07l\xBF\x09{H\x1F#\x9E\xD2\xCA\xCFw>\xC3" +
                "\xFC&\x93D`\xC7\xD1\xE3\x0Evra\xB8c\xC1\x87;z\xBA\x98\xA4\xE3\xA0X\xC3\xCE\x91}\xE8\xDB\xF4\xFB\xEC>" +
                "e\xC2k\x9F\xC2\xE6\x08\xD1\x92\x129\"\xEB5n\x87\xF4\x1A\x09w(\xC2\xFF%$\xAF.\xA3\x92&\\\x7F\xE1\xD1" +
                "\x83j\xF8\xC2w*\xD9T\xFAPN\xA9h\xE4\x8E\xA3%\xE3\x8E\x16\xC7\x1Dm\x0Dw\x90wF\xF7|\xF6)\x9D\xD0}\xCAd" +
                "\xC0>E\xFC\xFDW /\xA6M\xE2P\xEES\xC4\xBD\xC6\x9D \xD6\xF0\xEB5R\xB2\xC6\xBC\xC9\x1A\x04_\\\x0E\xE3" +
                "\x0B\x92)d\x1C\x11\xEB\xE19\x85\xE1\x11\xAC\xE3\x18\x1BF\xC7\xD1J\xB9O\x19\xE7\xFE\xF7\x10\xC6\x99" +
                "\x8D\xAC'kL\x1A\xBF+P\xCB\x1ASX?*f\x8Da\xF5\x1AL'JL+p\xAF\x01\xF2\x05\xD1\x89>\xA4\x12$\x94/\xAA\xFD" +
                "\x85h\xAB\xFAX\x94#@\xA6<\xB6\xFCB$\x0F\xFD|\xD5\xCC\"\xEC8b\xB3F+2k\xA0\x1D\x07H\x1C\xE3\xDC>eb\xB9" +
                "\xAA\xCB0q\xA0\xAC\xB1\xD2\xCB\x8B\x88\xAC1\x15\xC0\x1A\xD3\xDD\xA4\xF0b\x8D\x90^c\x96K\x8AX{\x13" +
                "\xE1\xBD\x8C\x04|Q\xA1z\xF7\xEC\xE1\x1C!{\xB6x\xBF\xB8U\xFE\x09\xE0\xC5?G\xCB)\xE9;\x8E\x85\x80\x8E" +
                "\x03H\x13\x845\x00\xEE\x88|g\x14\x9AY\x0E\xA0}\xCAA\xE8>E\xDCk\x90\xF7Do\x09\xE6\x94\xDB\xD0o\x03" +
                "\xBC\x9D\xA8\xD7\xE8f\x87r\x87\xE2\xC7\x1A\xA2.\xC3cW\xA2\xE9,\x84s\xCA\xE3Zf\x13\xFF\xF9\xC5\xE5" +
                "\x91\xEE\x9F\xE8;\x8E\x05\x9E;Z\x91\xB8\xA3\xA7\xC4\xF7b\x83\xEF\x8C\x8E{\xDD\x19m\xD4>e:\xE0\x9E" +
                "\xA8\xB2\xD7\xB8Se\x8D\xBB\xDE;\x14a\xEB9\x1C\xD6\xD0O\x1Fxg\xA1g\x8A\x1E/<!\xFD\x13\xD0/\"\x7F^\xF5" +
                "\xD4\xCF\x97\xF3H\x9A\x8E#|\x9F\xC2\xB3FO\xDB\xE1\xFB\x14y\x824\x865\x90^\xC3\x9F5N\xF3\xE2v\xFD\xBD" +
                "\xC6\x1C\xC7\x1AL'\xCA\xB4\xA1\x11\xF8\x02J\x10h\x0F\xA2`\x0A\xFDT\xD2\xD3'\xE2d\xA1\xD3\xE1I\xD8" +
                "\xE4rJ\x1C\xA7Y\xC0\xE5\x85\xB8\xE3\x18\x12k\xECz\xECSb\xB0\x06\x90\x17\x1A\xD68\x8A\xC2\x1A\xD3\x10" +
                "kL\x07\xB0\xC6\x8C<)\"\xF6\x1A\xF6\xDE\xC4\xD02\x1D\x1Ep\xAD\xE7\x83D|\x81\xF7\x17L.,\x92\x1C\xE1" +
                "\xAF[\x01^\xAF\xEE\xE7\xF7\xEC8\xC6d\x1D\x07\xDA\x98.\xD2{Y\x98;\xDA\\\xC7\x01\xEEe{7\xC1\x149b\xB7" +
                "\xA4!\xFB\x94I\x9B;\xE4\xFB\x94c\xCF}\xCA\x85\xDB\x82\x1C\xE1z\x0D\xE3\xF7z\x89\xEE\x86\x92\xBD\x86" +
                "\xDF\x0E%!k\\\x96\xB1\x86\xAC\xBF\x88\xC3\x17\x01S\x89\xEC\xE4K\xA7\x18\x94G\xECQ\xC5\xCE\x88\x1B@F" +
                "\x84w\x1C\x8B\xD1\xB8\xA3\xCDu\x1C\xE3\xA6\xDA\xB3I\xA9`^\xD8\xFB\x14M\xC71Y\xD1\x0AqLb\xFB\x14\xF5w" +
                "R\xF0\xCD+\x98\x17\xF8T2-\x9FM\x80^\xE3.\xC6\x1A3^;\x949\xAC\xD7\xE8\xDF\xD1H\xC8\x1A\xB2]\x89t?R" +
                "\xD9w\xE8\xF9\xA2\xC2\x08Ol\xBF\x85y\x89\"?\xD3\x97G\x0A\x1F\xD6\x98\x0F`\x8D\xBE\x06\xB3\x06\xB1" +
                "\x97\xAD$\x08\xD1qx\xB1\xC6\x81/k\x1C\xAA\xEFn\xAC\x01\xDFLQ\xB3F\xD3z\x8DK\xF7\x98\xDF\xC4Cv\xA2" +
                "\x82\x04!:Q_\xBE`\xE6\x94\x04\x09\"\xC9\x91\x08\xDE\x9BY\xC8\x8Ec\xACa\x1DG\xDBhC=Y\x03\xEF8\x92\xB2" +
                "\x06\xD7k\x1Cy\xB2\xC6\x05\x1F\xD6\x00\xF3\x02\xEA5t\xAC\x11\xD2k\xCCq\xBD\xC6<\x94\x14\xAA\xEF\xB0" +
                "\xAA\xBA\x0C\x8A/\xB6\xA8\xFEBz\xFEO\xFFd\xD1 \x02\xD7\xD7\xF9,\xA0\x1E\xCD\x9A.q\xDC\xF0\xEB8\xD8" +
                "\xEF\xBC1\x93\x0B\x9A#\xFA\x8E\x83oI\xF7\xA0\x99Etg\x94\xF9\xDFC\xD0\xECSX\xD6\x98l\xC4=Q\x9A5@\xEEP" +
                "\xECP\xEAb\x0Dxo\xB2\xA0a\x0D\xE9\x9E\xD5\x9B/\x98\xD9D\xAA\xD8\xF9W\xA8\x92G\xCC\x8E\xE3F\xD2\x8E" +
                "\xA3\x85\xE5\xC5\xA2nB\xE1\xB9\x83\xBB3*K\x0A\xFB\xCE\xA8`\x9F\xD2\xBF3*\xDB\xA7L\xE1\xFB\x94\xA9" +
                "\xE0}\x0A7\xA18\xDF\x7F\x1D)\xD6\x98\x8B\xC3\x1A\x8F}X\xA3\x92\x08,kP|!}\xAE<%\xFDS\x81'\x7F\x8E\x9E" +
                "G\x16~\x04\x877k\xCC\x8F&k\x1092T\xD6\x98\x0A\xB8\xBBa\xB1\x06\xB5\x8BEw(R\xD6\xA8\xA3\xD7`\xF7&i" +
                "\xBA\x0Ci\x0F*\x9CP\xD09\xE5\x89\xEF\x9C\xF2T\x9C&n:<\x0D\x9BYl6I\xDFqtY\xA3\x9E\x8E\x83b\x0DS\x07I" +
                "\xB1/f\x8D\x83\xE8\xAC1\x85\xB3\xC6\x94\x1Fk@\xCF\x0C\xCE\x1A3\x0Db\x0DIR\x88\xF6&\x0B\xA6\x06t\x19" +
                "\x8BB\xBE\xD8z\xEC\xC9\x14.\x178\xBAT\xA3\x07\xD4e\x16\xE3in\xC7\xD1\xE6\xB8\x83\xFD\x9E\x9Bf\x9F" +
                "\xA2\xB83:\x81\xDE\x04\xA3\xF7)\x87\x1E\xFB\x94)\xBC%%\x12\xC4o\x9F\x02\xF7\xA3\xEBD\xAFQ\xCD\x91$" +
                "\xBD\x86\xE8\x8EFl\xD6@\xEFb\xF0m\xA8\x98/\xC4S\x09y\xB6\xFD\x94\x9Ebp61?\x7F1&\xEB8\xC6\"u\x1C-\xBC" +
                "\xE3h\xBB\x19\x91\xE6{\xB1\xE0>\xC5\xEB\xCE(\xBDO\xE9+\xBFO9\x92\xECS\xC8^\xE3V\xDC\xEF\xBF\x06\xB3" +
                "\xC6\xBD\x08\xBDF\x83XC\xD4_\xF0\x89\xA0d\x0AC\x9F\xC2\xFE\xCA\xD3\xF2O\x00\xFF\xC4\xF6\xD8\xCF\xD1" +
                "\xF3H\xC4\x8E\xC3\xD0\xA6\xB0\x06\x90 \xE3\x1DeK\xDA\x04\xD6X\xAB\x975d\xD3\x8A\xAC\xD7\xB0\x13d." +
                "\xA0\xD7@~\xC7\x1F\x91 A]\x86\x94/Ts\x8A\xFF\x84\xF24\x81\xE7\xA6\x95+(\x9B\xF0\x1D\xC7i\x16\x10\xDC" +
                "\x01\xB2\xC6N\x18k\xA4\xE88$\xAC\x01\xE6\x05\xFC\xFD\x94I</\x10\xD68\x82\x92B\xC2\x1A\xC7\xC1\xACq" +
                "\x9B\xD9\xA1\xC4d\x0DE\xAFA\xEEM\x18\xD6X\x90\xDD\x01\x15\xF2\x05\xBB\x1FYd\xF9\xC2=],G\xB8\x8C\xD0" +
                "\x04u\x99\x05b\x93\xB2\xE3\x18kd\xC7A|\xDB\x8D\xE0\x0E\xEA&\x18\xD5q\x88\xEF\x80\xAD\xC0\xDF\xA9Gr" +
                "\xE4H\x90 \xF0\xEF1\xE7\xEFn0\xBF\xB3'\xE1=\xD1h\xBDF\xBC\x1DJ\x10kli\xD2D\xD8_\xE8\xF8\xC2=\xABO" +
                "\x05\xF3H\xB0\xF7\xE2\x11\xA7\xE3\x98Sw\x1C-\xE3{\xF4\x89:\x8E6\xF3\xBD\xD8\xDDjRT\xB8c|\xC9\xEB\xCE" +
                "\xA8\xB5Oa\x7F\xDFW\x03\xF7)\x81\xF7D+\x19\x01r\x07\xD8k\xDC\xF3\xED5\xBCv(\x89Xc\xCBe\x0DQ\x7F\x91" +
                "\x86/\x9E-Q\xFE\x99\xC0\xD3?\xC7\x87A\x0A\x9C5\xF0\xAE\xB4\x96\x8E\xA3\xED\xD5q@\x09\"\xDD\xA7\x10" +
                "\x092.I\x10pf\x01\x13\x84g\x8Dc\xFE\xEEF\x18k\xB0;\x94Y\x0F\xD6 {\x0D0;\xE6e\xBD\x06\xC1\x17\xC4\xDE" +
                "d\xE1\xB2\xE8;&\x1E|\xE1\xD1\x80\xF2\xBD\xA6 Ah\xBF$\xF8g\xA2\xCC,U\xE2\xD0w\x1C-\xA6\xE3\xD8\x09" +
                "\xEF8\xDA\\\xC7\x11\x9F5:a\xAC\xB1\xD2|\xD6\xB0Sc\xD6\xEAA\x1D\xD6\xF8\xA1qv(\xF4wOL\x05\xF2\x82\xD8" +
                "\x9B,\x18I!\xD8\x95\xA0I\xA1\xDA\x8F,\xB1\xB9\xE0\xA8\xFB\xCE\xFF\xF1\\\xED1\x02\xECS+\xF6\xF7\x92l" +
                "\x12\xBF\xE3hq\x1D\x87\xF0\xEEyP\xC7\x11\xE5\xCE\xE8\xE8\xEFSf\x88],\x90 \xFC=\xD1Y\xFC\x7F\xBD1z" +
                "\xAF!\xFB\x8E|\x02\xD6\x10\xCE)\xAA\xCEB\xCA\x17.;8s\xC7U\xD4/\xB1\xFF\x0C3\xD7plb|\xFEh\x1DG+n\xC7!" +
                "\xDD\xA7\x08\xB8\xA3\xC3la\xB5wF\xA1}\xCA\xA1`\x9F\"\xE1\x8E\xD0}J/).HY#\xE4\x9E(\xDEktg\x13{B\x99" +
                "\x0F\xB8\xAF\xC1\xB2\xC6\xBC\x1Fklq\xACqE\xC6\x1A\xE2\x9EB\xC3\x14\xCFH\xAFU\xFAg\x0Ay\xA4\xFCw\xF1" +
                "\xEB8\x88\xC9e;\xC1>\xE5f\xC2}\x0A|\xEB\x1C\x9FYP\xD68\xAC\x9F5\xA6M\x95L+\xEB1XC\xB6Ca{\x8D\xF9\x80" +
                "^\x83\xF8v<\xD1\x89\xB2]\x867_\x08\x99\xC2e\x07\xCDT\xF2,\x81\x97M.P\x87\xE2v\x1C\xA5\xCA:\x8E\xEDV" +
                "\xFA\x8E\xA3\xA7\xE5s\xF6X\xE3\x98d\x0D>/\"\xB2\xC6l\xA5\xDD\xF0`\x8D\x07 k\xC4\xEF56\xB1\xA4\xE0[" +
                "\xCF\xC5-S\x95]\x06\xD9_\x98\xE7M\x96\x05\xCF:\x96\xBFZ\xF1\x1D\xCB\xC7R\xF7\xEF\x02>\x0F\x9A5l\xC7" +
                "\xC1\xEDV\x90\x8E\xA3\xC5u\x1C-E\xC7\x01\xFE\xDE\xC0]pf\x11\xDC\x19\xDD\x13\xB4\xA4\xA1\x1DG?A\x0E" +
                "\xC9}\xCA\x91z\x9Fr\xE1V\x9A{\xA2wf\xF8~\x14I\x10\xB8\xD7\xB8\x1F\xA9\xD7h\x16k,\x11\xACAu\x16B\xBE" +
                "\x08\x9AG\x90\x93\x1F2\xCBP\x0C\xF2\x9D8n\x88;\x0ES\xA1\x8Ecax\x1DGG\x97\x17\x13\xCB\xA6V\xF2bb\x99" +
                "\x9EP\xD4wF\xA7\xB0\xDB\xA2\xFA}\x0A1\x9B\xF8\xDD\xDD\xF0\xE95.\xE2;\xD7K\x8A^c>\xB8\xD7`w(\x0A\xD60" +
                "\xBA\x8C%5k8\xFD\x85\x92/ \xA6xN\xFA\x10\xA5\x7F>\xCB#\xBD\x7F\x97n\xC7q\xC3\xE2\x0EQ\xC7\xB1\xA0" +
                "\xEE8\x04\xAC\x11\xDCq\x80\xD9aj\x0D\xAC\x81\xCC,D\x82\xE0\x1D\x87uw\xE3V\x93Y\xA3\xCE^#\xC2\xDE\x04" +
                "\x9CS|\xF9\x02\xEE/\x84Lq\xD58\x99\xD4l\"O\x93g\x8A\xA4\xA8\xE6\x97\xFDy\x10\x1E\x89\xD5qlG\xEB8\x96" +
                "*\xEAt\x1C\xA1\xFB\x94\x89\xE5\xB2\x13\x05Y#b\xC71\x05\xCF&G$k\x1C7\x975\xF4;\x94y\x9C5*\xBD\xC6eU" +
                "\xAFa\xCF#\x8B\xC0\xC6\xE41\x9F\x11\x9A.cI\xC3\x170S\xF0)\xE0\xE8\xB5\xE7\x1D\x91\x7F\xFE]!\xAF\xF99" +
                "\xA2\xF4)3\xC5\xEC8LEs\xE4_\x92\xED,\x9C#<w\xB4e\x1D\x07\x98#\xE3f\x8E\xA4\xE88\xEC\x049 n\x82\xE9" +
                "\xEE\x8C\xEA\x7F\xEF\x86v\x9F\x02\xF7\xA3^\xF7D\xE7\xE8;\xE66w\x00\xBF7T~_\x83\xEB5\xD2\xB2\x86\xA2" +
                "\x13\x85\xFB\x0B1_\xA4\x9AJ\xC2\xA7\x18\x94A\x0A;)X\xEE\xD0t\x1C-\xAE\xE3h\x1By\xA1\xED8\xC6M\xA5" +
                "\xEE\x8C\x82\xDCq\x80\xE9\x043\xA1\x1C\x80\xAC1\x81\xB5\xA1q\xF6)\xB7\"\xEES\xA0{\xA2w\x89{\xA2s\xF6" +
                "\xCE\xF5\x1E\xDDk\xCCq\xBD\xC6\xBC_\xAF\x01\xEDP\x16\x89\xA4H\xC5\x1A\\\x7F!\xED,X\xBEx\xDE\xFB\x93" +
                "\xD2\xC7R\xF7\xE7\xAB\x19$~\xC7\xD1J\xD3q\xB0\xAC1\xA2\xFB\x14\xA2\x1F\x8D\xCD\x1Aw$\xACa\xEFb%\xAC" +
                "\xB1\x01\xEDb\xC19E\xDBk@\xF7A\xC1NT\xB87Q\xB4\xA1\x9E|\xE1\xB4\x890S<\xA7\x13\xA4\xEB\xF1\x19\xC4'/" +
                "\xEC\x9Fs\xB5\xE2\xCD\xBFW\xC2#C\xEB8\xDA\x01\x1D\xC78\xB3O\xD9\x8B\xB4O9 Y\xE3p\x02`\x8D\xC3zY\xC3" +
                "\xBAW~;6k\xDCS\xB1\x86\xAE\xD7\xD0\xB1\x86\xA4\xD7\x10\xECM\xAE<\x11\xF3\xC5S\xBC\xCB\x10\xF6\x17" +
                "\x83\xF3Y}\x9F{s\xC4\xB5\x81\x7F\x01\xFAe\xE4\xCF\xAB\xDE\x93M,\x1E\x09\xE98\xE2sG\x1B\xFB~}\xDD\x1D" +
                "\x07\x9D \xEA;\xA3S\xA7wF\xE5\xFB\x94i\xB7\xE3`\xF6)\xB7c\xEFS\x90{\xA2\xBE\xDF\x7F\xB5n\x97k{\x0Db" +
                "\xFF\xBA\xA8\xFD\xDE\x9A\x865\x96@\xD6\xB8\x8A\xB3\x86=\xA70\x13J\x87\xE4\x8B:\x15\xE2\x11\x8AAbu" +
                "\x1C0q\x94\x8F\xBE\xE3h+:\x0E\xF8{\xB1\xE3\xF2\x8Ecy\x1F\xFD\x1D\x1C\xDE\xFB\x14p\xABRa\x0D\xD1\xF7S" +
                "\xB4\xFB\x94\x99nRXyQ&\xC5\x9D\xC0{\xA2\x06kX\xB3\xC9\xFD\xF8\xDFC\x01{\x0D|\x87\x12\x8954]\x06\xC1" +
                "\x1A\xFD\xF7\xB3\x82/\\v\xB86\xF0/@/\xD1\x0E\xEA]N\x112\x88\xD1q\xA8Yc^\xCE\x1A;b\xD6\xF0\xEF8\"\xEE" +
                "S\x98i\x85\x98Y\xD0\x04\x89\xFD\xFD\x94\xA4\xACq\x09\xFA\x8D\x1B\xB5\xB1F`\xAF\xA1\xDD\x9B\xE8\xBB" +
                "\x0CU\x7FQ\xBE\xB7=g\x93\x17\x8E\x97$\x02\xE4\xA9\x9F\xA9d\x93S\xE2\x10\xB0\xC6\xBC\xBA\xE3h\xC9:" +
                "\x8Ev@\xC7\x01\xEDS\xF6\xC6K\x8Dsgt\x12\xCD\x0B\x8B5\xF8}\xCA\x94\xDD\x862\x1DG\x955n\xE9Y\xC3&\x8E" +
                "\x9AYC\xDBk,\x98S\x89\x945\xA8^c\xE9\xCA\x13\xF9\xDE\x84\x98D\x14|\xC1\xF6\x17\xF6{^\xC5\x0E/z\xFEz" +
                "\x80\xF7\xE4\x14\xFB\xDF\xE5\xB4\xE3\x98kZ\xC7q\xD3\xB7\xE3\xB0o\x82A3\x0B\x99 \xE0\x1D0\xA6\xE3\xF0" +
                "\xD8\xA7\x1C\xC1\x09\x02\xEFSn\xE9\xF7)\xB7u\xFB\x94\x8B\xF2}J\x08k\x18z\x19K\x10\x8F^C\xC2\x1AO|X" +
                "\xE3j\x04\xD6\x10\xCC)\xD5\xF7\x7F\xD8T\x12:\xB9\x88\x19$n\xC7\xB1\x1D\xBD\xE3hG\xEB8\xF6'\xF0\x09E" +
                "\xB4O\xF1\xB93z$\xBA3\x1Am\x9Fr;\xFE\xDD\x0D\xFF{\xA2V^4\xB7\xD7\xF0\xEB2Tw.\xC4)\xE02\xC2\x8B\x9E" +
                "\x87tY\xE9mU\xF2\x88\xF9\xF9\xEB\xEC8\xF0\x04\x19\xB1\x8E\xC3\xCA\x8E\xC3\xC9J\x82\xF0\xDFO!\xFAQ0A(" +
                "\xD6\xB8P\x1BkTw\xB1\x1B\xF7\x13\xB3\x86\xA2\xD7 \xBE#\xBF$\x9AS\xA2u\x19\xEC\x9C\xA2\xE4\x88\xEE" +
                "\x09\x7F^I\x10\xCCS\xE9\xE0\xFAjN\x09\xA7\x15\x83G\x0A;5\xA2v\x1C\xBE\xACa\xAAG\xC7\xB1/\xE88\xAC}" +
                "\xCA>\xDF\x86\xC6d\x8D2/\xA6\xDD\xBCX\x93\xB0\xC6\xEDs\xCC\x1At\xAFaeD\xA9K\xE0o\xCD\xB0\xBEc\"\xE2" +
                "\x0B$#\xAA\xFD\x05\xA3\x1C;8\xFA\x92\xF4}\xBDn\xFD\x09\xFD\x7F\x0B(\xCC)\xCE\xE7Ww\x1Cc\xE7\xB1\xE3" +
                "\x80\x12$\xF0\xCE(\xD2\x8F\x06\xDF\x19E\xF7)\xB3\x17\xD9\xDFK\xCC\xDF\x13\x9D\xC3\x12\x04\xF9\xFE" +
                "\xEB\xBC2A\x9C~T\xC4\x1A\x0B8k,\xA6a\x0D\xD1\xAE\x04\xDA\x83\x08\xF8\x82\xE2\x88\xE5H\x9Ec\x13\x9EA" +
                "\xCEh\xC7\xD1\x01\x88c\xA2\x13vgt\xD9\x9AM\x0E\x89\xAD\xCA\x942/\xA0}\xCA\xAD\xEA>\xE5V\xEA}\xCA\x9C" +
                "u[\x14\xDE\xA7\xE8\xEF\x89\x96I\xF1\xB0\x9A\x14N^\x84\xF5\x1AKV\xA3\x11\x955\xC8\xFE\xE2\xB9u\xE7" +
                "\x02\xE5\x8Bk4_T\xB9\xE0:\xC2\x11\xD7\x83U\xCA&\x08w\x9Cz\xB7\xE3\xE8\xAB\xF1{}\xC6(\xEE\x08\xEC8v" +
                "\x12u\x1C\xC4\xCC\x82\xB0\x064\xB3\xC8\xEE\x8CF\xD8\xA7\x0C\x995\x90\x9B\xE6\xB2],8\xAD\xC8z\x8DP" +
                "\xD6\xF0\xEF5\xC8\xBD\x89O\x97!\xEA/\x84\x1C\x01M\"\xD7\x13x')(6\xA9v\"t\xC7a*\xC0\x1D^\x1D\xC7N\xFD" +
                "\x1D\xC7\x04N\x1C\x13\xCB\xA6\xD6\xB8O\xF1\xFE~\xCA\xFA\xED*k\xDC\xD6\xB0\xC6\xDDY\xA8\x0D\x9DS\xE6" +
                "\xC5<\x96\x17\x1E\xAC\xB1\x19\x855\xC0^\x03\xDD\x9Bt\x8C\xDF\x9A\xE1s/C\xC8\x17lg\x01q\xC4\x8A\xED_" +
                "\x9A>X\xDD\x9F\x09\xFC\xBD8\x8F\x94\xFA\x9D8\xAE\x8B;\x8E\x1B\xDE\x1DG+\xA0\xE3hc\x93\x8B\xE0\xDBn" +
                "\xE3K\xC4>E\xF7{\x03'\xD1\x99\x05\xBE\x09\x06\xDE:\xE7\xF6)\xC7\x8D\xDC\xA7\xA0w7\xE6\xB1\x99\x05" +
                "\xB9'\xEA\xB0\xC6C\x925\x1E)\xF6\xAF\xE9XC\xD0e(\xFA\x0B\x94/^2|\xC1\xE8K\xC4{\xCC,\"\x06)\xA09\x05" +
                "\x99M\x88-l\x92\x8E\xE3f\xA4\x8E\xC3\xF3{\xB1\xF8\x9DQ\xE31\xBE\x17;\x85\xDF1w\xF2\xE2\xB8\xBAO\x11" +
                "\xDD\x19\x95\xEDS\xEE\xA0\x13\x8Ad\x9FB\xB1\x069\xA1 \xF7D\x17L\xE2\xD8\xC4\xF2\xC2\xFE\xFD\x1A\x8B" +
                "\x9BQ{\x0D\x875\xA0^\x83g\x0Da\x97\x81\xF6\x172\xBE\x00\xF4\x06\xE9%J\xFF\x1C\x01\x8F\xB8\xF9\x82w" +
                "\x1Csv\xC71v\xA6;\x8E\x89eI\x82\x88\xF6)\xC47\xDC\xC0~tZy\xDF\x1C\xBC\xFD5\xA3\xFC_x\x0C\xBC\xBB\x01" +
                "\xB2\x06q\xC7\\\xC9\x1A\xEA\xBB^\xE0\xB4\xB2$\x99V\xC8\xBD\x09\xD1e \x13\x0A\xCC\x17hg\x01\xB1\xC3" +
                "\x8A\xEDe\x09r\xDD#)\xDC\xBF\x8Bd\x13\x83G\x86\xD5q\xEC\xB4\xB1\xBC`:\x8E\xDD\xE0\x8E\xE3\x80\xCD" +
                "\x8BIf6\xA1Y\xC3\x9AM\x00\xE2\xE0X\xC3\xDE\xA7hX\xE3\x8E\x17kT\x88c\x0E\xDF\xBC\xCE\xA7f\x8D\xD0\x1D" +
                "\x0A\x9D\x14\xF0\xEF\xE6\x12\xECM\x18\xBE@\xFB\x8B\xEB._T\xDE\xED\x1C;\xBC2\xFDJ\xF9'\xE1\xDE\xFD" +
                "\xF9\x08\xA7\xD8\x9F\xB9\xF7\xEF\x82u\x1C\xD5\xDD\x0A\x98#\xEA\x8Ec'Q\xC71Nt\x1C\x9D\xB0\x8E\x83\xFB" +
                "^\xEC$\xFF\xCD\xFA\xE3T\x1D\x87\xE0w\x8B\xCEJ\xFAQ\xC9>Erw\x03\xB9'\x8A$\x08\xFA{z\x16\xA1vC\xDBk" +
                "\x10\xBFG#\x01k\x08\xFA\x0B\x86/d\x13\x0A\x94&J/\x98b\xCAi\x85b\x10I\xC7\x01pG\xCB\xE2\x8E\x85t\xF7G" +
                "+y1\xEEnU\x96R|/V\xD2q@\x13\x8A\xF4\xCE(\xC2\x1D\x17\x14wFgL\x15L(\x01\xFB\x14\xE6\xEE\xC6<\xB5O\xE1" +
                "\xBF\xFF\xBA\x88\xE6\x05\xCD\x1AOT\xBD\x86\x805\x9E\xC5e\x0D\xB4\xBF\xC0\xF9\xC2e\x84\x9E\xDEH\xE0" +
                "\x11\x1E\x112Hx\xC7\x01M.\xC4\xEF\xF5\xD1t\x1C\xC4\xCCB$H\xD4\x8E\xA3\x91\xFB\x14\xC1wa\x89\xBB\x1BU" +
                "\xD6\xB8\xEB\xC5\x1A\xF7\xBDY\x83\xDA\xA1\x04\xB2\x86\xA8\xD7\xB0oyu$\xDF\x88GXC\xC8\x17Lg\x812\x02>" +
                "kx\xE5\xC52\x9F\x17\xAFd<\x02\x10\xC7p;\x8E\x9B\x11:\x0E\xE0\xCE\xE8\x1Eygt?\xF1>\xE5\xA8\xAE}\x0A" +
                "\xCD\x1A6q\x04\xDE\xDD\x98\x1F\x19\xD6\xC0\xEF\x83\"{\x93e7)\xA2\xF1E\xA5_\x00\x98\xA2\xA7\xAF\x1C" +
                "\x8F>\xAB\x02/xX6\xB1\xD3M\xD6q\xCC\xE1\x1D\xC7\xBC\xA2\xE3hy}GV\xCA\x1D\x82\x8Ec\"]\xC7\xE1ug\x94H" +
                "\x10pf\x01\x13\x04\xFE]\x81\xD2\x8E\xC3k\x9F\xB2!\xD8\xA7H\xEE\x89Z\xAC\xC1\xDF\x13E\x9A\xD1\xADX;" +
                "\x14\x8E5\xAEc9\x02\xB2F\xB5\x07e:\x0B\x8E)\xF4\x99\x82\xFC\xF3R\x1E\xA1\x18$Z\xC7Q\xCF\xFD\xD1\xA5" +
                "\x98\x1D\xC7\x84\x7F\xC7q\x14\xD4q\xAC\xC1\x13\xCA4D\x1C\xD5\xA4\x80\xEE\x8C\xA2\x13\xCA\x1DrB\xB1" +
                "\xDA\xD0{\xC4>e^\xB8O\xB1\xEF\x89Z\x13\xCAC\xE1=\xD1*k<\xD6\xB0\xC6S}\xAF\x11\x8D5VD\xAC\x01\xCE\x11" +
                "L\x16T8b\xBB\xFC\x93\xD5\xED\xD7J\xAF\xE2\x11\xA6\x13\xF9A\x1C\xA7yq=A\xC7\xB1]\xDD\xA7$\xEE8:\x81" +
                "\x1D\x87\xC5\x1A\x07\xFA}\x0A\x95 \x81\x1D\x07\xC2\x1A\xE8\x0D\x8E`\xD6\xB8\xE7\x7Fw\xE3\xB2\xE0\xEE" +
                "\x060\xAD\x18\xD9!\xDF\xC2n\x85\xF7\x1A\x16_<\x97\xECMzz\x1DK\x10\xB8_\xC4\x99B\xC4\x11n\x82\xAC\x18" +
                "\xE9\x00y\x8F\xC9\xC5\xF8\x0C\x14\x8F\xB8\xC41_N(\xFA\x8E\xC3\xCE\x8B\xD3\\\xD8\x89\xD2q\x8C\xF7\xF2" +
                "\x02\x98P\xC6M\xE2\xE8\x00M\x07\xB9O\x89\xD4qx\xEFS@\xD6\x00\xF7)\xEB\xD4>eV\x92\x17 k\\4Y\xE3\x9E" +
                "\x8C5\xE0\xBC\xB0Xc\x01g\x8D\xC5\xC8\xAC!\xE85\xAE\xC5\xE954]\x061kT\x13\xC1\xE5\x88a\xA9\x938\x18" +
                "\x83\x0C:\x8E\xEB!\xBB\x95\x16\xB7[!:\x8Ev,\xEE\x00~_1\xDCq\xC8\xBF_\xEF\xDC\x04\x83rDrg\x14\x99Y" +
                "\xC4\xFD(\xC9\x1D\xD2\xFB\xE6\xF7\xC0\x99\xC5\x9AV\x86\xB3O\x11|\xFF\xD5N\x10\xAF^\xA3v\xD6x\xE5\x91" +
                "#\x18S\xC4N\x87\xD72\x1E\x81g\x16\xB0\xE3\xB8\x91\xB4\xE3h\xA3\xDC\x81w\x1CKt\xC7\xB1\x8Bu\x1C\x13" +
                "\xC0V\xA5\xD2q8\xDF\x8B-\xD5\xCA\x8BI\xC9\x8D/\x83;\xA6\xA0\xADJ\xCDwFk\xDB\xA7,\xE0\xDF\x82] \xDA" +
                "\xD0\xCAlbO(`R\xD8yq\xB5\xD4\x0E\x9A\x17qz\x8DX\xACQ\x9D8^\x97\xC4!;\xF9\xDD\xA7\xEA_#\xFE\x15\xE1I" +
                "\xE5\x93\x85\xEE8n@\xACq\xA3q\x1DG\x07\xEF8\x04\x09\x12\xDAqH\xFAQ\xD9>eZ\xB9\x91\xE5\xBE\x9Fr\x07" +
                "\xBDo~\x91d\x0D\xC9\xEF\xDD\xB8\xFC\xE0\x0C\xB1\x06zG\x03\xDC\x9Bp]\x86\x94/VoxO(\xC6\xF9\xC7r\xA1" +
                "\x92\x11\xAF5?\x9FM\x0D\x9C8\xA8\xD9\xC4\xB3\xE3\xD8iN\xC71A\x10G\x8C\x8Ec\x0A\xBB\xC1\xB1\xE6N(\xC7" +
                ">\xFB\x94u~\x9F\"`\x8D{\xECwa\x0D\xD6\xB8\xAF`\x0D\xC9\xDD\x8DT\xAC\x11\xB1\xD7@\xF6&P\xDF\xC9\xF2" +
                "\x05\x9B\x0E.\x17\x0C\xEB\x11N:V\xC7q=A\xC7\xB1-\xE98\xDA\xF1\xB8C\xDBqTs\x84\xEF8&\xD1\x04\xC1\xBF" +
                "\xE7\xB6\x06\xE7\x88`\x9FB\xFD\x16\x1F\xF9\x9D\xD1Y\xC5o'\xA67\xB2\x01w7\xD4\xFD(\xF2\xBFr`}\x9F\x0D" +
                "\xDC\xC2\x06\xF4\x1A^\xAC\x01v\x19D\x7F\xA1`\x0A`\x06\xD1f\xC165\xCB\xF0<\x02qG\x01\xE7\x05\xB7[i" +
                "\x05\xECV\xDA\x1E\xDF\x91-;\x0EI^\xC8:\x0E\xE8w\x7FM\xAE\x98\xCAw\x1C\xD0\xF7b\x13v\x1C\xC8>\xC5\xDA" +
                "\xAA\xE0wF/\x01\x1D\x07\xB3O\xB9D\xEES.?\x90\xEFS|\xEF\x89\x0EX\x03\x98PR\xF5\x1A<k\x08\xBA\x8Cm\x05" +
                "k\x90\xCF\x9B\xD2\xEF\xBC)\xFF\xC4\xF0k\x88\x87\xFEy\xE7g\xC2\xDC\xC10\xC8i\xC7\xD1%\x0E\xFC\xFE(" +
                "\xD4q\xDCh`\xC71\x8E\xDF=\xD7v\x1C`v\xE0\xFB\x94Cyv\x00\xD3\x8A|\x9F\xB2~[\xC6\x1AwH\xD6P\xECS\x04" +
                "\xACA\xDF4\xF7\xDB\xC5b\xBD\x86\xE0\xC6\x97G\xAFq\x9D\xCA\x0E\x825\xA4]\x86\xB0\xEFT%\xC86\x9D\x0E" +
                "\x8E\xDF\x16\xA5\xC6\x8Apf\xD1t\x1C}\xAD$\x85\xA9\xA3\xD2q\xECk;\x0E\xF8Qv\x1C\xD3L^\x88\xF6)\xF0m" +
                "\xD1\xB0}\x8Au[t\x1E\xCB\x8B\x1Ek<\xA0\xDBP%k<\x96|'\xC5\x875\xB8^cy\xA0T\xAFQ\xEEM*\xDF1Qv\x19\xAB<" +
                "_\x94'\xB9\xC7\x0B;%; \xFA&\xC0W\xD4\xFC\xBB\xC4<\"\xEA8x\xEE\x18\x91\x8Ec\x8F\xEA8\x96k\xEE8\xA2" +
                "\xDC\x19\xBD\xEDwg\x94I\x90K\xE0>\xE5~\xF8>\xC5\xFF\x9E(\xFE\xBFu\x80\xB2\x06\x98 \xF2^\xC3\x975Vy" +
                "\xD6\xB0g\x012M\x90\xA9d\xC7\xC7\xCBx\x04\x98Y\xDC\x1E\xA4\x18\x9B\xF3\xD9\xC5\xB6\x02v+m</\xDA4w,A" +
                "\xDC1\xAC\x8Ec5Z\xC7\xC1oa\x13\xDD\x19\xBDDv\x1C\xBA}\xCACr\x9F2`\x0Dg\x9F\xB2E\xEES\xAE\x80\x13\xCA" +
                "3U^\x04\xF4\x1A\xC8\x9EU\xC9\x1A\xAB\x04k8\x89@\xF2\xC2\xA9\xEE\x04x@!\x06\x01:\x11\xFB);\x0E\xE2" +
                "\xFEhx\xC7\xC1\xDC@\x07g\x96\xF8\xACAw\x1C\xFBl\xC71)\xF9f\xBD\x95\x1D\x01\xFB\x94\x19sfY\xA7\x7F" +
                "\x7F\x8Ft\x9Fb\xB3\x86\xD5\x8FZ786\x04\xF7\xCD\xD5\xAC\xF1\xC8f\x0D\xEA\xEE\x06\xF5}6A\xAF\x81\xB3" +
                "\x86\xB4\xD7xI\xB2\x06ts\x1C\xBF\xCD\xC53\x850;\xB6c\xE5\xC5\x1BhZa\x19\xA4K\x1Cg\xB4\xE3\x980\xF3B" +
                "\xD0qL\x9A*\xE88\xA6\xCA\xBC\xA8\xA3\xE3\x90\xEDS\xEE\xC4\xD9\xA7l@\xB7E\x8D\xBC Y\xE3\xA1\xF4\xEE" +
                "\x86\x9E5:a\xAC\xE1\xD7k\xF0{\x13()\xC0\x87\xEC/\x9C3\x7F\xAAk\xA5?Y+\xFF\xE4\xC4K+?\xA7\xF2\xF3+Y" +
                "\x03t\"n\x0Fbt\x1C\x01\xBB\x95\xD1\xEE8\x96\xEB\xE98\x8C\x04qf\x96i\xF4\x9B\xF5\xB75-)v\x07\xEC\xAE" +
                "\xC7\xF7S\xE6\xB1\xFB\xE6\x97\x1F\x92\xDFpK\xB4O!\xEF\x89\xD2\x09r\x0D\x9EV\xC2v( k\x80w\xBA\x98\xFE" +
                "bM\x98#N\xA6tS\xC08\xFF\x80\x07\x14\xE5\x11\xA01%\xA6\x15\xBF\x8E\xE3F+\x80;\xD8\x8E\xA3\x1D\x87;" +
                "\xF6I\xEE\x08\xE88V\xC5\x1D\xC7\x1A\xD3q\x80y\x01M(U\xEE\xA8\xDE\x1C\x0D\xBE3z\x8F\xBC3\x0A\x10\x07" +
                "\xC0\x1D\xC1w7\x96\xB6\xC8\xBC\xB8\x8AN(\x1DhB\x09\xEC5\x12\xB1\x06\xFC>7\xCE\xB0\xC3\x05\x8E\xDE" +
                "\x8C\xE4Q\x1E\xE13\xA5\xAB`\xC7q]\xF1\x9D70A\xF8\x8Ec\xA7\xFA\xBDXxr!Yc7\xBC\xE3 \xF6\xB2\x8D\xE98nG" +
                "\xED8D\xD9\xE1\xB0\xC6},;\xC8\x8D,5\xAD\x04\xDC\xDDxFe\x87\x845\x9C\xECXa;QhoB\xDC\xEC\x92\xF1\x05" +
                "\xCF\x14\xD2\x19\xC43)N\x006\xC1y\xC4b\x10\xF3\xE6(\x98\x177|;\x0E\xE6\xB7r\xB4\xB1\xBC\xB0Y\xE3f-" +
                "\x1D\xC7\xFE\xA4</bt\x1C\xD3\x18qX\x9D\xA8\xA4\xE3\x18\xB0F7)\xAA\x1D\xC7\x9C\xD5n\\\x8A\xBDO\xB1X" +
                "\xA3lC\xC5yA\xDF\xDD\x80Y\xE3i\x9D\xACQM\x8AW\xD5\x8C0\xB5\xBA+\x01\xDF\xD5N\xBF\xC0\xA5\xC0I\xF7O." +
                "\x94\xFE\xC4\xF5\x98\xAEQ\x9EM\x19\xA8\x07\xE9\xE7H\xB7\xE3\xB8.\xE7\x8E\xE8\xBB\x956\xDD\x95\xA6" +
                "\xE88\xAC\x1Cif\xC7\xC1\xFC\x0E\x0Ez#{\x07\xEBG\xBD~c rg\x94\xFE-\x81\x92}\xCA\x16\xBFO\xE1\x12\x04" +
                "\xBD'\xBA\\\xE9G\xC3\xEEk\xA4f\x0D\x96/\xCASm\x9Ey\xD7\x9F \x7F^\xF5xR\xA0\x0C\xE2\xEC_\xCC\x8E#\x05" +
                "w\x0C\xB1\xE3\xD8\x8B\xD6q\xACH;\x8E\xF2Y\x13t\x1C\x17\x08\xE2\xB8\x0Dw\x1C\xEBQ:\x0Ex\xFF*\xBD3z" +
                "\x19\xDA\xAA\xF0\x13\xCA#\xE1>eI\xB7O\xA9\xB2\xC6Ul6y^e\x8D\x17\xEE\xF7P\x9A\xC1\x1A(_\x94z\x13\xF4o" +
                "\x11_\xFD\xE7\x19\x1E!\xD2\xC4\xE6\x8Er\xABB\xB1\x06\xC1\x1DD\x82\xCC\x9B3\xCB\xB6\xA0\xE3\xD8!;\x0E" +
                "\xFE&X\xC3;\x8Eixf\x11\xFE\xA6b\xF8\xCE\xE8,8\xB3\xA4\xDF\xA7\x90\xBB\xD8\x87|v\xD0\xBFw#\x09k<g\xBE" +
                "\xC3v]\xDDk\xAC\xDE\x80\xB2\x83hC\x09\xBE@\x98\x82\x9FJ\xEC\x8CxK\xE4\x85\xFB3Q\x1E\xA9\xA6\x86\xCB " +
                "\xFA\x8E\xC3\xD9\xC2\x92\x1D\x07\xF9\x1DY0/\x96\xC0\xBC\xB8\x19\xBB\xE3\xD8\x1Fv\xC7q\xCBM\x8D\x19" +
                "\xE5\xBD/\x9C5\xEE\x92\xFB\x94{\x16q\xCC[\xC41\xE88\xE0\xEF\xA7\xF8\xECS$\xBFwc\xC9\xE3\xEE\x86\xC5" +
                "\x1AW\x13\xB1\x86\xF7\xDE\x84\xEB2\x0C\xBE\xB0\xB3\xE0\xE6\x80\x1D\x00\xBD\x10\xE0\x1D%x\x04\xED>Rt" +
                "\x1C\xE0nE0\xB9\x0Ck\xB7\"\xEF8V\x0E\xC8\x04\x11w\x1Ckd\xC7\xA1\xFF=\xA3\xF8\xF7b\xAD\x04\x11\xCD,?" +
                "\x14\xDE\xA7h\xEE\x8C\xD2\xBF\xC7\\\xBFO\xB1\x9AQ\xDD\xBD\xAF\xEB\xF0\xBD/\xEF^\x83\xB8K\xEE\xC9\x1A" +
                "\x04_\xD8\x1C\xF16H9\x1E!v1\xE6\xBFE\xF1\xAF\xB4\x1D\xC7\xB6\xA0\xE3\xD89\xDB\x1D\xC74\x96\x17\xB2" +
                "\x8Ec\xA6\xD4\xB2\xDD\x98\x85\xBF\x17\xAB\xEF8D\xFB\x14\xF2\xCE\xA8\xD5n\\\x1E\xECS\x1E\x01\xDFO\xD9" +
                "\xAA\xA4\x86n\x9F\xF2\xFFWw\xEE=MeQ\x14\xE7\x1B\x8C\xD6\x8C\xD2\x96\x96\xA2\xBDE4\xB6th\xE5\x11#Q" +
                "\x9C\x19\xC6\x8C\x94\xCE\xF7\xFF0\x03\xB4\xB7\xBDg\x9F\xB5\x1F\xE7q/\x90\x90\x9DcR\x8C\xFC\xE1r\xED" +
                "\xDFZ\xE7\xF8)\xAC\xBB\x01\xF5\x02\xBE\xAF\x11\xCE5\xD2\xBD\x06\xDC>\x16\x9C\xD7\x18n\xE6l\xF1p \xE7" +
                "\x85\xE1\xBC\xFA\xBC\xE0An\xA0\x07\xE1|\x87\x89q\x04\xF5G!\xE3x\x81\x14D\xED\x8F\xB6\xB8t\xB6\x8F" +
                "\x15\xE4\x95\xA9\x09\xA6\xE4\xB2\x82\x82<!\xC6A\x15D\xDCY\x80\xD7\xB8\xEC\x98\xDB_\x99\xF3\x94\x8F" +
                "\xFA+\x81\x96m%Z;R\xBD\xC6\x94MOx\xED\x08\xF7\x17\xCAn\xB2\xD8\xA8\x80\xA6\x1A7\x9B_\x1Av\x96\x85" +
                "\xD9\x83lR\x95N\x04\xE38~\x09\x1C\xC7\x143Q\xE8;$\xC6q\"2\x0E\xC2Dg\xCF\x92q\x0CE\xC6!vF\xDB\xB1\x8C" +
                "C\xCCS\x1C\xD5 \x1B\xCA\x9E9O\xF1\xBC\xC6\x95\xEF5L\x8C#\xB6\xBBa\xF1\x1A\x07ux\x0D\xB8\x8F\xD8X\x06" +
                "\xD5\x85\xAA\x0A\x88\xB3\x98\xDD\xAAgeV\x1D\x0D\xF0 7\xD0\x83l\x19Gr\xB6r\x9C\x92\xAD\xB4\xD2\xB3" +
                "\x95'\xC28\xB6\x0BK\xC0m7\xC28v\xD9\x9D%\xE0\x7F~D\xDB\xCAW\xF9N}\x97\xDBY\x8E\x94;\xF5\xCC\xFF\xBDt" +
                "\xC5\xE4)?j\xCCS\x02z\xA2\xEC\xFB\x1A\x09\x19J\x80\xD7@y\xAA\xE0/\x02\xD4\xC4\xA0\x14\xA2\x07q\xFFl" +
                "\xD0w\xAC\x85#![\xF1|\x87\x96\xAD\xB4\xF8l\xA5%o(y\xFB\xA3\x03\xEB\x86\xE21\x8E3nCIb\x1C\xC3Z\x18" +
                "\x87E/\xF2tF?\xE0\xCE(\xD4\x0B\xD7k\xFC\xC9\xE4)\xFA\xCD\x94\x81DC7^C\xD6\x0BoCq\xEF\xA1\xC0\xBEF" +
                "\x9A\xD7\x10\xF9\x85\xEA/fk7\xB1=s\xD3\xFF\xBCYYX\x0ER\xFE\x14U\xC71q\xEF\xC8\x06g+\xD0k\xA4\xDC\x91" +
                "\x8De\x1C\xF2\xE6\xF2\xCC\x19G\x11\xBC\xB3t\x0ECv\x16\x8D\x8FF\xDFO\xE9Y\xF2\x94\xC8w7\x1E\xC5k\x18" +
                "\xB4C\xF1\x1A\x9Ev(\x9E\xE2v=g\x1B\x15\x08=\xAB\xAA!z\x90\xF5\xBC\xFFYv\x18\xA5\x98lv\x93\x17\xBC" +
                "\xEFHe\x1C!\xFDQ\xC48f.\xE3p\xF4\"\x92q\xA4\xBD\xC7\x017\x947\xDC]\x15\x8Dq\xEC\x82\x0D\xE5KZ\x9Er" +
                "\xC9x\x0D\x8Fn\xE0<\xE5\x9B\xBB\x9B\xD0\x0D\x85\xE4)=\xDA\x16\xFDQ&)\x8A\xE3(\xBD\xC6_\x0C\xDD\xF8" +
                "\xBB\xF4\x1A\x84n\\\x93\xEEF\xE95\xFEQ\xEF\xA4\xBC\x8D\xF5\x1A07QY\x86\xE0/\xCC\x9E\xE2\xD6<\x17\xDE" +
                "\x99\xF1&PGf\xD8w\xEC\xFC\xD6\x9E\x10\xD3\x816\x97I\x96l%\x1F\xE38\xC9\xC98\xF4tV\xD2\x91\xDA\x19G" +
                "\x11\xCC8\xDA\xF2\xDB_\xE4^\xEC\xFB0\xC6\xB1g\xE8\x80\xF5\x0C}\xF3\xBE\x81\x8F\xEE\x1B\xF8\xE8\xC0" +
                "\xC0G\x0F\xCC\xBD/\xF8\xBE\x86\xD6\xD7H\xF3\x1A3\xCEkP\xBF`\xD0\x11\x93F\x18<\x88\xEE;v\xC4\x0D\xA5" +
                "\x16\xDF\xD1\xE2\xB3\x95VX\xB62\xCF\x90\xAD\xB8\xA4\xC3\xF6\x1E\x07a\x1Cgyz\x1C\x09\x8C\xA3]\x9D`C" +
                "\xC9\xC4DS:\xA3\x8F\x95\xA7\x04\xF5D7^\x03\xE9\x05\xE4\x1A\xEFX\xAE\x91\xE05\x04\x7F1\xBF?8g~\xE2" +
                "\xCFc?\x12\xEC;\xE2\x18\xC7\xB1\xC1k\xC4\xBC\xCD\x81\xBC\xC6I\x12\xE3\xE87\xC98\xCE\xF20\x0E/U\xD9" +
                "\x05\x89l\xA9 \xA3p>:\x12[\xE7\xEF\xC5D\xD6\x96\xA7\xF4\x0Cy\x0Ai\x7F1\xDA\xE1(\xC8>\xC7G\x9B\xD2" +
                "\x0E\xAA ,\xD7\xB0e\xAE\x82\xBFPw\x93\xF9\xFA\\\x18\xCECrV\xFC\x08\xD05\xEF\xCF\x7F\xCF8Vz1\xA9\xD3k" +
                "L\x9Bf\x1C\xFD;\x8D`\x1D\x87\x81q\x10\xBD8U\x19\xC7k\xB4\xA1\xBC\xC9\xC88\x8A`\xC6\xD1\x09b\x1CA\x9D" +
                "\xD1\x0F\xDF\x9B\xCCS\xAC^c\x9CO/\xAC\\\xE3W4\xD7\x10\xFE\xF62\x9Eb\x99uV~\xE7P\x0F\xF2\xF0\xB3\xDC1" +
                "\x8E1`\x1C\xD9\xB2\x15\x91\x95V6\x97V\xAEl\x85\xD9Y\x9Ac\x1C\x07\x1C\xE38\xAF\x83qxo\xF9\xC41\x0E" +
                "\xF3\xBDXo[i\xA83J\xFA\xE6\x19\xF3\x14\xD2\x13\xA5\xBD\xAF\xE0\xBE\xC6Pk\x822\x0D.\x83\xBFp\x14\xE4" +
                "\xD6\xAC\x0EK\xBA\xBFH\x0CU\xF7\x1D\xAB\xB9a\x1C\x0D\xF8\x8E\xB0\x1Bn\xE6\xFE(\xF2\x1DY\x19\xC7\xEF" +
                "\x98q\x9C=3\xC6\x01\xEE\xC5^v\x0D\x8Cc/\x94\x89\x8A\x9DQ\x99\x89\xC2<\x8548\x06\xA8\xC11P\xF3\x14.I" +
                "\xC1\x8E\xA3T\x0A\x85\x83\xFE\x02M\x8Dh\xAFQ\xFE\xFB_\xC8^c\xBE\x9E\xA3\xFB\xB94\x9C\xBD\xEF\x15|" +
                "\xC7\xDC\xEA;|\xC6\xC1*\x88\xC78\xA0\x82\x84\xF4\xC14\x05iq\x944\x89q(;\x8B\xC88\xC0m7\xBE{~\x1E\xC1" +
                "8v\x1B`\x1C\x87`g\xC9\xC58z\x02\xE3\x88\xCBS>\xB9|t\xCC\xBD\xDC\x83\xDF\xDD0\xDCj\x8B\xF2\x1Ar\x0Ak" +
                "\xE9w1\x14\xA3\xC0\xFE\x02i\xC7\xFA\xBC\xDC\xAA\x83{\xE6\xF5\x02x\x90B& ^\xE6\"3\x8E\x89\xCCD+JA\xF5" +
                "\x021\x8E\xA9\xAB\x14l\x16\xCB3\x8E\x93p\xC6\x01T\xC3\xCC8N]\xBD8\xB51\x8Es\x91q\\\xD4\xC18\xA8\xD7" +
                "\xB00QY/23\x8E\x9Cy\x0A\xC8_\xB7^\xE3Z\xEFn\xAC\xBD\x06\xEDn\x10\xBAQz\x8D\x7F\x85$e\x98\xEA5\x14" +
                "\x961\xAA\xB8\x86\xD1V\x17\xDC\xF9\xD9p\xC6\xD3\xF3#\xC0\x83\xB0\x0A\xC21\x8E\x899[\xB1m.\xC1osd\xCD" +
                "V\xEA\xEC\x8F\xBEfsY\x99q\\$2\x0E\x8B\x82@\xC6\xD1\x91[\xE7\x87b\xEB\xFC\xC8\xF8Rqt\"\x8B;\xA3\x86<" +
                "\xE5\x9A\xB9\xDB\xA6n+\x1E\x1Fu{_T;P\xEF\x0B)\x08\xDF\x07\x15\xBD\x06P\x10\xE0/\x96\xC5\\\xD5\x05gn?" +
                "o\xF6 \xB2\xEF\xC8\xC58\xA0\xEF\xF8\xC3\xE0;\xC2\xDE\xE6\x08\xEF\x8F\xCE\xDD\x0DE\xCBV\x0E\x90\xE3" +
                "\xC0Y\xAC\xE8;\xA2\x18\x07|\x01,\x17\xE3\xE8\x98\x19G\xD7}\xFB\xABB7\xBE\xE1\x0D\xE5\xE8;\xB3\xA1\\" +
                "\x81\xCEh\x99\xC2\xF6\x0D\x9D\xD1}\xCEq\x10\xBD\x18'\xDC\x85\x8D\xCBS\xC8=\x94\\^\xC3\xE5\x17\xAC" +
                "\xBFX\xCF\xFFF\x0FS>\xD3\xEFJ\xF4\x1D%\xEF\xB8\x13\x8E\xB1\x99q@\x1D\xD1\x18G7\x8Eq\xB8;\x0BT\x10z" +
                "\xE7m\x16\xC28\xC8\xCE\xF29\x8Aq\xC8\xDDs#\xE3\xB8\xB01\x8E/\x16\xC6\xD1\xB6\xDCUIa\x1CG\xCA\xCE\x82" +
                ";\xA3\x1F\xFDDVq\x1C\x86\xF6W\x88\xD7\x98T\xB5\xE3\xA7Q;\xDEM\x93\xBD\x86\xC45\x18\x961\xAFN\xDEG8" +
                "\xBA \xCE\xEA\xE7\x99\x9D\xC5\xF5 0\x7F\xA1\xBE\xC3e\x1CB\x7F\x14}\xBD\\\xE9E\x97c\x1CS\xA1\xCD\xD1" +
                "\"\xA4\x033\x8E\xED|\xC5\x91\x8E\xA7\xCE8\xCEE\xC6q\xF1X\x8C\xA3kf\x1C{\x06\xC6!w\xCC\xFB\xB1y\x0Aq" +
                "\x1C\x84n\x0C\xA4<\xC5\xF7\x1A?\xB9\xF7D\x9B\xF4\x1A^nBX\x06U\x07\xDFG\x80\xB9\xFA\x92\xCF\xDE\xE4" +
                "\xD5\x84x\x10\xCCM\xFF\x07\x18\x94\xF8\xE0\xC7\xF0\xCA\xF4\x00\x00\x00\x00IEND\xAEB`\x82" }
        };
    }

})(this);
