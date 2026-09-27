/* BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE) */
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
