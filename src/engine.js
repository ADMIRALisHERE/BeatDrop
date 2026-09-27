/* BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE) */
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
