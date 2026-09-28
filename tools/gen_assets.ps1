# BeatDrop - Copyright (C) 2026 Amirhossein Asadi - SPDX-License-Identifier: GPL-3.0-or-later (see LICENSE)
param([string]$Out)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

public static class AdmiralAssets {
    static Color H(string hex, int a) { Color c = ColorTranslator.FromHtml(hex); return Color.FromArgb(a, c.R, c.G, c.B); }
    static Color H(string hex) { return H(hex, 255); }

    static LinearGradientBrush Gold(RectangleF r) {
        LinearGradientBrush b = new LinearGradientBrush(new PointF(0, r.Top - 0.5f), new PointF(0, r.Bottom + 0.5f), H("#FFF3C4"), H("#9A6D22"));
        ColorBlend cb = new ColorBlend();
        cb.Colors = new Color[] { H("#FFF3C4"), H("#EBC76A"), H("#C8952F"), H("#9A6D22") };
        cb.Positions = new float[] { 0f, 0.40f, 0.74f, 1f };
        b.InterpolationColors = cb;
        return b;
    }

    static GraphicsPath SpacedPath(string text, FontFamily fam, FontStyle style, float em, float spacing) {
        GraphicsPath all = new GraphicsPath();
        float x = 0;
        foreach (char ch in text) {
            GraphicsPath p = new GraphicsPath();
            p.AddString(ch.ToString(), fam, (int)style, em, new PointF(0, 0), StringFormat.GenericTypographic);
            RectangleF b = p.GetBounds();
            Matrix m = new Matrix(); m.Translate(x - b.Left, 0); p.Transform(m);
            all.AddPath(p, false);
            x += b.Width + spacing;
        }
        return all;
    }

    static void Sparkle(Graphics g, float cx, float cy, float R, Brush br) {
        float r = R * 0.17f;
        g.FillPolygon(br, new PointF[] {
            new PointF(cx, cy - R), new PointF(cx + r, cy - r), new PointF(cx + R, cy), new PointF(cx + r, cy + r),
            new PointF(cx, cy + R), new PointF(cx - r, cy + r), new PointF(cx - R, cy), new PointF(cx - r, cy - r) });
    }

    static void FadeLine(Graphics g, float x0, float x1, float y, float thick, Color c) {
        LinearGradientBrush b = new LinearGradientBrush(new PointF(x0 - 1, 0), new PointF(x1 + 1, 0), Color.FromArgb(0, c), Color.FromArgb(0, c));
        ColorBlend cb = new ColorBlend();
        cb.Colors = new Color[] { Color.FromArgb(0, c), c, c, Color.FromArgb(0, c) };
        cb.Positions = new float[] { 0f, 0.3f, 0.7f, 1f };
        b.InterpolationColors = cb;
        g.FillRectangle(b, x0, y - thick / 2, x1 - x0, thick);
    }

    // Draws letter-spaced text with hinted anti-aliasing; segments share one baseline.
    static float DrawSpaced(Graphics g, Font font, string text, Color color, float x, float y, float spacing) {
        StringFormat fmt = StringFormat.GenericTypographic;
        using (SolidBrush br = new SolidBrush(color)) {
            if (spacing == 0) {
                g.DrawString(text, font, br, x, y, fmt);
                return x + g.MeasureString(text, font, PointF.Empty, fmt).Width;
            }
            foreach (char ch in text) {
                float cw = (ch == ' ') ? font.Size * 0.30f : g.MeasureString(ch.ToString(), font, PointF.Empty, fmt).Width;
                if (ch != ' ') g.DrawString(ch.ToString(), font, br, x, y, fmt);
                x += cw + spacing;
            }
        }
        return x;
    }

    public static Bitmap Crop(Bitmap src, int pad) {
        int minX = src.Width, minY = src.Height, maxX = -1, maxY = -1;
        BitmapData d = src.LockBits(new Rectangle(0, 0, src.Width, src.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        byte[] buf = new byte[d.Stride * src.Height];
        System.Runtime.InteropServices.Marshal.Copy(d.Scan0, buf, 0, buf.Length);
        int stride = d.Stride;
        src.UnlockBits(d);
        for (int y = 0; y < src.Height; y++)
            for (int x = 0; x < src.Width; x++)
                if (buf[y * stride + x * 4 + 3] > 6) {
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
        if (maxX < 0) return src;
        minX = Math.Max(0, minX - pad); minY = Math.Max(0, minY - pad);
        maxX = Math.Min(src.Width - 1, maxX + pad); maxY = Math.Min(src.Height - 1, maxY + pad);
        Bitmap o = src.Clone(new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1), PixelFormat.Format32bppArgb);
        src.Dispose();
        return o;
    }

    public static Bitmap Logo() {
        Bitmap bmp = new Bitmap(640, 190, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

            // Emblem: a serif A standing on a waveform, a sparkle on its apex.
            float cx = 92;
            GraphicsPath a = new GraphicsPath();
            a.AddString("A", new FontFamily("Georgia"), (int)FontStyle.Bold, 120f, new PointF(0, 0), StringFormat.GenericTypographic);
            RectangleF ab = a.GetBounds();
            Matrix m = new Matrix(); m.Translate(cx - (ab.Left + ab.Width / 2), 150 - ab.Bottom); a.Transform(m);
            ab = a.GetBounds();

            using (Pen ring = new Pen(H("#D4A849", 55), 1.2f))
                g.DrawEllipse(ring, cx - 74, ab.Top + ab.Height * 0.55f - 74, 148, 148);

            float waveY = ab.Top + ab.Height * 0.62f;
            int[] hs = { 60, 44, 66, 36, 52, 28, 40, 20, 30, 14, 20, 9 };
            for (int side = -1; side <= 1; side += 2)
                for (int k = 0; k < hs.Length; k++) {
                    float x = cx + side * (16 + (k + 1) * 5.6f) - 1.5f;
                    int alpha = (int)(235 * (1f - k / 13f));
                    using (SolidBrush br = new SolidBrush(H("#D9AE55", alpha)))
                        g.FillRectangle(br, x, waveY - hs[k] / 2f, 3f, hs[k]);
                }

            g.FillPath(Gold(ab), a);
            using (Pen p = new Pen(H("#4E3710", 170), 1.2f)) g.DrawPath(p, a);
            using (SolidBrush s = new SolidBrush(H("#FFF6D6"))) Sparkle(g, cx, ab.Top + 3, 17, s);

            // Wordmark.
            GraphicsPath w = SpacedPath("ADMIRAL", new FontFamily("Palatino Linotype"), FontStyle.Bold, 70f, 3.5f);
            RectangleF wb = w.GetBounds();
            m = new Matrix(); m.Translate(196 - wb.Left, 58 - wb.Top); w.Transform(m);
            wb = w.GetBounds();
            g.FillPath(Gold(wb), w);
            using (Pen p = new Pen(H("#4E3710", 150), 1.1f)) g.DrawPath(p, w);

            float wcx = wb.Left + wb.Width * 0.5f;
            FadeLine(g, wcx - 70, wcx + 70, wb.Top - 13, 1.2f, H("#E2B85A", 200));
            using (SolidBrush s = new SolidBrush(H("#FFF1C2"))) Sparkle(g, wcx, wb.Top - 13, 12, s);

            // Rule with a small waveform under the wordmark.
            float ry = wb.Bottom + 10;
            FadeLine(g, wb.Left, wb.Right, ry, 1.3f, H("#D4A849", 220));
            int[] mini = { 4, 7, 11, 6, 14, 8, 12, 6, 10, 5, 3 };
            for (int i = 0; i < mini.Length; i++)
                using (SolidBrush br = new SolidBrush(H("#E2B85A")))
                    g.FillRectangle(br, wcx - mini.Length * 2f + i * 4f, ry - mini[i] / 2f, 2f, mini[i]);

            // Tagline.
            using (Font f = new Font("Segoe UI Semibold", 13f, FontStyle.Regular, GraphicsUnit.Pixel)) {
                string tag = "BEAT MARKERS FOR EDITORS";
                float spacing = 5.2f, tw = 0;
                StringFormat fmt = StringFormat.GenericTypographic;
                foreach (char ch in tag) tw += ((ch == ' ') ? f.Size * 0.30f : g.MeasureString(ch.ToString(), f, PointF.Empty, fmt).Width) + spacing;
                tw -= spacing;
                DrawSpaced(g, f, tag, H("#C9D1DE"), wcx - tw / 2, ry + 11, spacing);
            }
        }
        return Crop(bmp, 2);
    }

    // Compact header: a small emblem beside the wordmark and tagline, about 60 px tall.
    public static Bitmap LogoCompact() {
        Bitmap bmp = new Bitmap(420, 100, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

            float cx = 42;
            GraphicsPath a = new GraphicsPath();
            a.AddString("A", new FontFamily("Georgia"), (int)FontStyle.Bold, 54f, new PointF(0, 0), StringFormat.GenericTypographic);
            RectangleF ab = a.GetBounds();
            Matrix m = new Matrix(); m.Translate(cx - (ab.Left + ab.Width / 2), 66 - ab.Bottom); a.Transform(m);
            ab = a.GetBounds();

            float waveY = ab.Top + ab.Height * 0.62f;
            int[] hs = { 26, 18, 28, 14, 20, 10, 12, 6 };
            for (int side = -1; side <= 1; side += 2)
                for (int k = 0; k < hs.Length; k++) {
                    float x = cx + side * (9 + (k + 1) * 3.6f) - 1f;
                    int alpha = (int)(225 * (1f - k / 9f));
                    using (SolidBrush br = new SolidBrush(H("#D9AE55", alpha)))
                        g.FillRectangle(br, x, waveY - hs[k] / 2f, 2f, hs[k]);
                }
            g.FillPath(Gold(ab), a);
            using (Pen p = new Pen(H("#4E3710", 170), 0.9f)) g.DrawPath(p, a);
            using (SolidBrush s = new SolidBrush(H("#FFF6D6"))) Sparkle(g, cx, ab.Top + 2, 8, s);

            GraphicsPath w = SpacedPath("ADMIRAL", new FontFamily("Palatino Linotype"), FontStyle.Bold, 34f, 2.2f);
            RectangleF wb = w.GetBounds();
            m = new Matrix(); m.Translate(90 - wb.Left, ab.Top + 4 - wb.Top); w.Transform(m);
            wb = w.GetBounds();
            g.FillPath(Gold(wb), w);
            using (Pen p = new Pen(H("#4E3710", 150), 0.8f)) g.DrawPath(p, w);

            using (Font f = new Font("Segoe UI Semibold", 10f, FontStyle.Regular, GraphicsUnit.Pixel))
                DrawSpaced(g, f, "BEAT MARKERS FOR EDITORS", H("#AEB8C8"), wb.Left + 1, wb.Bottom + 6, 2.6f);
        }
        return Crop(bmp, 1);
    }

    // The glass-look header: the product's name, "BeatDrop", in mixed case
    // (the user's choice, 1.2.1; it said "ADMIRAL" before) in Georgia, flat
    // brass, letters spaced 4 px, over "BEAT MARKERS FOR EDITORS" in small
    // spaced capitals - no emblem.
    // Narrower panels get a smaller rendering (tagPx 0: the name alone),
    // never a scaled-down one: ScriptUI scales without smoothing.
    public static Bitmap LogoWordmark(float px, float spacing, float tagPx, float tagSpacing) {
        Bitmap bmp = new Bitmap(460, 90, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            float bottom;
            using (Font f = new Font("Georgia", px, FontStyle.Regular, GraphicsUnit.Pixel)) {
                DrawSpaced(g, f, "BeatDrop", H("#D4A849"), 10, 10, spacing);
                bottom = 10 + f.GetHeight(g);
            }
            if (tagPx > 0)
                using (Font f = new Font("Segoe UI", tagPx, FontStyle.Regular, GraphicsUnit.Pixel))
                    DrawSpaced(g, f, "BEAT MARKERS FOR EDITORS", H("#C9B27A"), 11, bottom - 1, tagSpacing);
        }
        return Crop(bmp, 1);
    }

    public static Bitmap Label(string[] texts, string[] colors, string fontName, float px, float spacing) {
        Bitmap bmp = new Bitmap(900, 80, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (Font f = new Font(fontName, px, FontStyle.Regular, GraphicsUnit.Pixel)) {
                float x = 10;
                for (int i = 0; i < texts.Length; i++) x = DrawSpaced(g, f, texts[i], H(colors[i]), x, 20, spacing);
            }
        }
        return Crop(bmp, 1);
    }
}
"@

function Save($bmp, $name) {
    $path = Join-Path $Out "$name.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    [pscustomobject]@{ name = $name; w = $bmp.Width; h = $bmp.Height; bytes = (Get-Item $path).Length }
    $bmp.Dispose()
}

$navyText = "#1B1407"; $light = "#DCE2EC"; $gold = "#D9B25A"
$rows = @()
# Pictures that can meet a narrow panel also come smaller ("_m", "_s"); the
# panel draws the largest that fits.
$rows += Save ([AdmiralAssets]::LogoWordmark(29, 1.2, 11, 3)) "logo"
$rows += Save ([AdmiralAssets]::LogoWordmark(24, 1, 9.5, 1.6)) "logo_m"
$rows += Save ([AdmiralAssets]::LogoWordmark(21, 0.8, 0, 0)) "logo_s"
$rows += Save ([AdmiralAssets]::Label(@("Add Beat Markers"), @($navyText), "Segoe UI Semibold", 16, 0)) "btn_add"
$rows += Save ([AdmiralAssets]::Label(@("Add Markers"), @($navyText), "Segoe UI Semibold", 16, 0)) "btn_add_s"
$rows += Save ([AdmiralAssets]::Label(@("Working..."), @($navyText), "Segoe UI Semibold", 16, 0)) "btn_working"
$rows += Save ([AdmiralAssets]::Label(@("Remove Markers"), @($light), "Segoe UI", 13, 0)) "btn_remove"
$rows += Save ([AdmiralAssets]::Label(@("Remove"), @($light), "Segoe UI", 13, 0)) "btn_remove_s"
$rows += Save ([AdmiralAssets]::Label(@("Help"), @($light), "Segoe UI", 13, 0)) "btn_help"
$rows += Save ([AdmiralAssets]::Label(@("Reset to Defaults"), @($light), "Segoe UI", 12, 0)) "btn_reset"
$rows += Save ([AdmiralAssets]::Label(@("Advanced settings" + [char]0x2026), @($light), "Segoe UI", 13, 0)) "adv_label"
$rows += Save ([AdmiralAssets]::Label(@("Done"), @($light), "Segoe UI", 13, 0)) "btn_done"
$rows += Save ([AdmiralAssets]::Label(@("Modified"), @("#C9A452"), "Segoe UI", 11, 0)) "adv_modified"
$rows += Save ([AdmiralAssets]::Label(@("MARK"), @($gold), "Segoe UI Semibold", 12, 3)) "title_mark"
$rows += Save ([AdmiralAssets]::Label(@("AMOUNT"), @($gold), "Segoe UI Semibold", 12, 3)) "title_amount"
$rows += Save ([AdmiralAssets]::Label(@("made by  ", "Admiral"), @("#7E899E", "#D4A849"), "Segoe UI Semibold", 11, 1.4)) "footer"
$rows | Format-Table -AutoSize | Out-String
$rows | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $Out "manifest.json")
