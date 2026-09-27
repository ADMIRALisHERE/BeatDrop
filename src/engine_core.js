/* BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE) */
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
