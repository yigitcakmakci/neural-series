// Neural serisi görünümü WinForms ile: pahlı köşeli pencere, sarı bant, tarama çizgili ekran, kendi çizdiğimiz denetimler.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace NeuralSetup
{
    static class T
    {
        static Color C(int rgb) { return Color.FromArgb(255, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }
        public static readonly Color Panel = C(0x0c0d15), Panel2 = C(0x141725), Panel3 = C(0x1c2033), Screen = C(0x05070c);
        public static readonly Color Yellow = C(0xfcee0a), Cyan = C(0x00f0ff), Red = C(0xff2a4f), Ink = C(0xebe8d8), Dim = C(0x7d84a0), Line = C(0x262b3f), Dark = C(0x0a0a0c);
        public static float S = 1;
        public static int P(float v) { return (int)Math.Round(v * S); }

        static string display, displayBold;
        static bool Has(string family) { using (var f = new InstalledFontCollection()) return f.Families.Any(x => x.Name.Equals(family, StringComparison.OrdinalIgnoreCase)); }
        public static void Init()
        {
            using (var g = Graphics.FromHwnd(IntPtr.Zero)) S = g.DpiX / 96f;
            display = Has("Bahnschrift") ? "Bahnschrift" : "Segoe UI";
            displayBold = Has("Bahnschrift SemiBold") ? "Bahnschrift SemiBold" : "Segoe UI Semibold";
        }
        static readonly Dictionary<string, Font> cache = new Dictionary<string, Font>();
        static Font Get(string family, float pt, FontStyle st)
        {
            string key = family + pt + st;
            Font f;
            if (!cache.TryGetValue(key, out f)) { f = new Font(family, pt, st, GraphicsUnit.Point); cache[key] = f; }
            return f;
        }
        public static Font Display(float pt) { return Get(displayBold, pt, FontStyle.Regular); }
        public static Font DisplayLight(float pt) { return Get(display, pt, FontStyle.Regular); }
        public static Font Body(float pt) { return Get("Segoe UI", pt, FontStyle.Regular); }
        public static Font BodyBold(float pt) { return Get("Segoe UI Semibold", pt, FontStyle.Regular); }
        public static Font Mono(float pt) { return Get("Consolas", pt, FontStyle.Regular); }

        // Top-right and bottom-left corners cut, as on every Neural window.
        public static Point[] Chamfer(Rectangle r, int cutTopRight, int cutBottomLeft)
        {
            return new[] {
                new Point(r.Left, r.Top), new Point(r.Right - cutTopRight, r.Top), new Point(r.Right, r.Top + cutTopRight),
                new Point(r.Right, r.Bottom), new Point(r.Left + cutBottomLeft, r.Bottom), new Point(r.Left, r.Bottom - cutBottomLeft),
            };
        }
        public static Point[] CutBottomRight(Rectangle r, int cut)
        {
            return new[] { new Point(r.Left, r.Top), new Point(r.Right, r.Top), new Point(r.Right, r.Bottom - cut), new Point(r.Right - cut, r.Bottom), new Point(r.Left, r.Bottom) };
        }
        public static Point[] CutTopRight(Rectangle r, int cut)
        {
            return new[] { new Point(r.Left, r.Top), new Point(r.Right - cut, r.Top), new Point(r.Right, r.Top + cut), new Point(r.Right, r.Bottom), new Point(r.Left, r.Bottom) };
        }
        public static void Text(Graphics g, string s, Font f, Rectangle r, Color c, TextFormatFlags extra)
        {
            TextRenderer.DrawText(g, s, f, r, c, TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | extra);
        }
        public static int TextHeight(string s, Font f, int width)
        {
            return TextRenderer.MeasureText(s, f, new Size(width, int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding).Height;
        }
        public static string Spaced(string s) { return string.Join(" ", s.ToCharArray()); }
    }

    /* ================================================================ the window */
    class NeuralForm : Form
    {
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);

        public readonly ScreenPanel Screen;
        public readonly NButton Back, Next;
        readonly ChromeButton minimize, close;
        public string[] Steps = new string[0];
        public int Step;
        public string Status = "";
        public string BandTitle = "NEURAL KURULUM";
        public event Action CloseRequested;
        readonly Timer timer;
        readonly int band, side, foot;

        public NeuralForm(int width, int height, bool sidebar)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = T.Panel;
            DoubleBuffered = true;
            ClientSize = new Size(T.P(width), T.P(height));
            Font = T.Body(9.5f);
            Text = "Neural Kurulum";
            KeyPreview = true;
            band = T.P(46); side = sidebar ? T.P(220) : 0; foot = T.P(64);

            Screen = new ScreenPanel { Location = new Point(side + T.P(2), band + T.P(2)), Size = new Size(ClientSize.Width - side - T.P(4), ClientSize.Height - band - foot - T.P(2)) };
            Controls.Add(Screen);
            Back = new NButton { Text = "‹  Geri", Size = new Size(T.P(112), T.P(36)) };
            Next = new NButton { Text = "İleri  ›", Primary = true, Size = new Size(T.P(150), T.P(36)) };
            Next.Location = new Point(ClientSize.Width - T.P(30) - Next.Width, ClientSize.Height - foot + (foot - Next.Height) / 2 - T.P(2));
            Back.Location = new Point(Next.Left - T.P(10) - Back.Width, Next.Top);
            Controls.Add(Back); Controls.Add(Next);

            close = new ChromeButton { Glyph = 'x', Size = new Size(T.P(30), T.P(24)) };
            minimize = new ChromeButton { Glyph = '_', Size = new Size(T.P(30), T.P(24)) };
            close.Location = new Point(ClientSize.Width - T.P(30) - close.Width, (band - close.Height) / 2 + T.P(1));
            minimize.Location = new Point(close.Left - T.P(5) - minimize.Width, close.Top);
            close.Click += delegate { if (CloseRequested != null) CloseRequested(); else Close(); };
            minimize.Click += delegate { WindowState = FormWindowState.Minimized; };
            Controls.Add(close); Controls.Add(minimize);

            var path = new GraphicsPath();
            path.AddPolygon(T.Chamfer(new Rectangle(0, 0, ClientSize.Width, ClientSize.Height), T.P(24), T.P(24)));
            Region = new Region(path);

            timer = new Timer { Interval = 50 };
            timer.Tick += delegate { Screen.Tick(); };
            timer.Start();
            Disposed += delegate { timer.Dispose(); };
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Left && e.Y < band) { ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); }
        }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.KeyCode == Keys.Escape) { e.Handled = true; close.PerformClick(); }
            if (e.KeyCode == Keys.Enter && Next.Visible && Next.Enabled && !(ActiveControl is TextBox) && !(ActiveControl is NButton)) { e.Handled = true; Next.PerformClick(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var all = new Rectangle(0, 0, ClientSize.Width, ClientSize.Height);
            using (var frame = new LinearGradientBrush(all, T.Yellow, T.Red, 35f))
            {
                var blend = new ColorBlend { Colors = new[] { T.Yellow, T.Yellow, T.Red }, Positions = new[] { 0f, 0.58f, 1f } };
                frame.InterpolationColors = blend;
                g.FillPolygon(frame, T.Chamfer(all, T.P(24), T.P(24)));
            }
            var inner = Rectangle.Inflate(all, -T.P(2), -T.P(2));
            using (var b = new SolidBrush(T.Panel)) g.FillPolygon(b, T.Chamfer(inner, T.P(23), T.P(23)));
            g.SmoothingMode = SmoothingMode.None;

            // band: model code, name, hazard stripes
            var bandRect = new Rectangle(inner.Left, inner.Top, inner.Width, band - T.P(2));
            using (var gp = new GraphicsPath())
            {
                gp.AddPolygon(T.Chamfer(inner, T.P(23), T.P(23)));
                g.SetClip(gp);
                using (var b = new SolidBrush(T.Yellow)) g.FillRectangle(b, bandRect);
                g.ResetClip();
            }
            T.Text(g, "NS-1", T.Display(15f), new Rectangle(T.P(16), 0, T.P(80), band), T.Dark, TextFormatFlags.VerticalCenter);
            T.Text(g, T.Spaced(BandTitle), T.Display(7.5f), new Rectangle(T.P(70), T.P(3), T.P(300), band), T.Dark, TextFormatFlags.VerticalCenter);
            int hx = minimize.Left - T.P(60), hy = band / 2 - T.P(6);
            using (var b = new SolidBrush(T.Dark))
                for (int i = 0; i < 6; i++)
                    g.FillPolygon(b, new[] { new Point(hx + i * T.P(8), hy + T.P(12)), new Point(hx + i * T.P(8) + T.P(4), hy + T.P(12)), new Point(hx + i * T.P(8) + T.P(12), hy), new Point(hx + i * T.P(8) + T.P(8), hy) });

            // sidebar: the steps
            if (side > 0)
            {
                var sideRect = new Rectangle(inner.Left, band, side, inner.Bottom - band);
                using (var b = new SolidBrush(T.Panel2)) g.FillRectangle(b, sideRect);
                using (var p = new Pen(T.Line)) g.DrawLine(p, sideRect.Right - 1, sideRect.Top, sideRect.Right - 1, sideRect.Bottom);
                int y = band + T.P(28);
                for (int i = 0; i < Steps.Length; i++)
                {
                    var row = new Rectangle(T.P(16), y, side - T.P(30), T.P(34));
                    bool on = i == Step, past = i < Step;
                    if (on) using (var b = new SolidBrush(T.Yellow)) g.FillPolygon(b, T.CutTopRight(row, T.P(9)));
                    Color fg = on ? T.Dark : past ? T.Cyan : T.Dim;
                    T.Text(g, (i + 1).ToString("00"), T.Mono(9f), new Rectangle(row.Left + T.P(10), row.Top, T.P(26), row.Height), fg, TextFormatFlags.VerticalCenter);
                    T.Text(g, Steps[i].ToUpper(new System.Globalization.CultureInfo("tr-TR")), T.Display(8.5f), new Rectangle(row.Left + T.P(38), row.Top, row.Width - T.P(40), row.Height), on ? T.Dark : past ? T.Ink : T.Dim, TextFormatFlags.VerticalCenter);
                    if (past) T.Text(g, "✓", T.BodyBold(9f), new Rectangle(row.Right - T.P(22), row.Top, T.P(18), row.Height), T.Cyan, TextFormatFlags.VerticalCenter);
                    y += T.P(40);
                }
                T.Text(g, "Yalnızca senin Windows hesabına kurulur; yönetici izni gerekmez.", T.Body(8f), new Rectangle(T.P(18), inner.Bottom - T.P(78), side - T.P(40), T.P(40)), T.Dim, TextFormatFlags.WordBreak);
                T.Text(g, "SÜRÜM " + Engine.Version, T.Mono(8f), new Rectangle(T.P(18), inner.Bottom - T.P(34), side - T.P(40), T.P(16)), T.Dim, TextFormatFlags.Left);
            }

            // footer: status text left of the buttons
            var footRect = new Rectangle(side + T.P(2), ClientSize.Height - foot, ClientSize.Width - side - T.P(4), foot - T.P(2));
            using (var p = new Pen(T.Line)) g.DrawLine(p, footRect.Left, footRect.Top, footRect.Right, footRect.Top);
            int textRight = (Back.Visible ? Back.Left : Next.Left) - T.P(16);
            T.Text(g, Status, T.Mono(8.5f), new Rectangle(footRect.Left + T.P(24), footRect.Top, Math.Max(10, textRight - footRect.Left - T.P(24)), footRect.Height), T.Dim, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }

    /* ================================================================ the "screen": scanlines, glow, a beam gliding down */
    class ScreenPanel : Panel
    {
        public Action<Graphics> PaintContent;
        readonly DateTime start = DateTime.Now;
        public ScreenPanel() { DoubleBuffered = true; ResizeRedraw = true; BackColor = T.Screen; SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true); }
        public void Tick() { Invalidate(false); }
        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(T.Screen)) g.FillRectangle(b, ClientRectangle);
            int step = Math.Max(3, T.P(3));
            using (var p = new Pen(Color.FromArgb(14, T.Cyan)))
                for (int y = 0; y < Height; y += step) g.DrawLine(p, 0, y, Width, y);
            // glow along the edges
            int glow = T.P(40);
            using (var lb = new LinearGradientBrush(new Rectangle(0, 0, glow, Height), Color.FromArgb(18, T.Cyan), Color.FromArgb(0, T.Cyan), 0f)) g.FillRectangle(lb, 0, 0, glow, Height);
            using (var rb = new LinearGradientBrush(new Rectangle(Width - glow, 0, glow, Height), Color.FromArgb(0, T.Cyan), Color.FromArgb(18, T.Cyan), 0f)) g.FillRectangle(rb, Width - glow, 0, glow, Height);
            // the beam: one pass every nine seconds
            double t = ((DateTime.Now - start).TotalSeconds % 9) / 9 / 0.78;
            if (t <= 1)
            {
                int h = T.P(150), y = (int)(t * (Height + h)) - h;
                using (var beam = new LinearGradientBrush(new Rectangle(0, y, Width, h + 1), Color.FromArgb(0, T.Cyan), Color.FromArgb(22, T.Cyan), 90f))
                {
                    beam.InterpolationColors = new ColorBlend { Colors = new[] { Color.FromArgb(0, T.Cyan), Color.FromArgb(22, T.Cyan), Color.FromArgb(0, T.Cyan) }, Positions = new[] { 0f, 0.75f, 1f } };
                    g.FillRectangle(beam, 0, y, Width, h);
                }
            }
            if (PaintContent != null) PaintContent(g);
        }
    }

    /* ================================================================ controls */
    class NButton : Control
    {
        public bool Primary, Danger;
        bool hover, down, keyDown;
        public NButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable, true);
            Cursor = Cursors.Hand; TabStop = true; Font = T.Display(9.5f);
        }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); Focus(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { keyDown = false; Invalidate(); base.OnLostFocus(e); }
        protected override bool IsInputKey(Keys k) { return k == Keys.Space || k == Keys.Enter || base.IsInputKey(k); }
        // Clicks only when the key also went down on this button: the release of an Enter that already moved the
        // wizard on (or opened a dialog) must not press the button that has focus now.
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter) keyDown = true; base.OnKeyDown(e); }
        protected override void OnKeyUp(KeyEventArgs e)
        {
            if ((e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter) && keyDown) { keyDown = false; OnClick(EventArgs.Empty); }
            base.OnKeyUp(e);
        }
        public void PerformClick() { if (Enabled && Visible) OnClick(EventArgs.Empty); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(Parent != null ? Parent.BackColor : T.Panel)) g.FillRectangle(b, ClientRectangle);
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            Color bg, fg;
            if (!Enabled) { bg = T.Panel2; fg = T.Dim; }
            else if (Danger) { bg = hover ? Color.FromArgb(255, 255, 80, 110) : T.Red; fg = T.Dark; }
            else if (Primary) { bg = hover ? Color.FromArgb(255, 255, 246, 90) : T.Yellow; fg = T.Dark; }
            else { bg = hover ? T.Panel3 : T.Panel2; fg = hover ? T.Cyan : T.Ink; }
            if (down) bg = ControlPaint.Dark(bg, 0.05f);
            var poly = T.CutBottomRight(r, T.P(9));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var b = new SolidBrush(bg)) g.FillPolygon(b, poly);
            if (!Primary && !Danger || !Enabled) using (var p = new Pen(Focused ? T.Cyan : T.Line)) g.DrawPolygon(p, poly);
            else if (Focused) using (var p = new Pen(T.Cyan)) g.DrawPolygon(p, T.CutBottomRight(Rectangle.Inflate(r, -2, -2), T.P(8)));
            g.SmoothingMode = SmoothingMode.None;
            T.Text(g, Text, Font, ClientRectangle, fg, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }

    // The minimize and close buttons in the band: dark tiles with a yellow mark.
    class ChromeButton : Control
    {
        public char Glyph;
        bool hover;
        public ChromeButton() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true); Cursor = Cursors.Hand; TabStop = false; }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        public void PerformClick() { OnClick(EventArgs.Empty); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(T.Yellow)) g.FillRectangle(b, ClientRectangle);
            Color bg = hover ? (Glyph == 'x' ? T.Red : T.Panel3) : T.Dark, fg = hover ? (Glyph == 'x' ? T.Dark : T.Cyan) : T.Yellow;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var b = new SolidBrush(bg)) g.FillPolygon(b, T.CutBottomRight(new Rectangle(0, 0, Width - 1, Height - 1), T.P(6)));
            int cx = Width / 2, cy = Height / 2, s = T.P(5);
            using (var p = new Pen(fg, Math.Max(1.5f, T.S * 1.6f)))
            {
                if (Glyph == 'x') { g.DrawLine(p, cx - s, cy - s, cx + s, cy + s); g.DrawLine(p, cx + s, cy - s, cx - s, cy + s); }
                else g.DrawLine(p, cx - s, cy + s - 1, cx + s, cy + s - 1);
            }
        }
    }

    class NCheck : Control
    {
        bool isChecked, hover, keyDown;
        public string Sub = "";
        public event Action Changed;
        public bool Checked { get { return isChecked; } set { if (isChecked != value) { isChecked = value; Invalidate(); if (Changed != null) Changed(); } } }
        public NCheck()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable, true);
            Cursor = Cursors.Hand; TabStop = true;
        }
        public int Measure(int width)
        {
            int text = width - T.P(56);
            int h = T.P(12) + T.TextHeight(Text, T.BodyBold(10f), text);
            if (!string.IsNullOrEmpty(Sub)) h += T.P(3) + T.TextHeight(Sub, T.Body(8.75f), text);
            return h + T.P(12);
        }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnClick(EventArgs e) { if (Enabled) { Focus(); Checked = !Checked; } base.OnClick(e); }
        protected override bool IsInputKey(Keys k) { return k == Keys.Space || base.IsInputKey(k); }
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Space) keyDown = true; base.OnKeyDown(e); }
        protected override void OnLeave(EventArgs e) { keyDown = false; base.OnLeave(e); }
        protected override void OnKeyUp(KeyEventArgs e) { if (e.KeyCode == Keys.Space && keyDown && Enabled) { keyDown = false; Checked = !Checked; } base.OnKeyUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(T.Screen)) g.FillRectangle(b, ClientRectangle);
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            var poly = T.CutTopRight(r, T.P(10));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var b = new SolidBrush(hover && Enabled ? T.Panel3 : T.Panel2)) g.FillPolygon(b, poly);
            using (var p = new Pen(Focused ? T.Cyan : isChecked && Enabled ? Color.FromArgb(90, T.Yellow) : T.Line)) g.DrawPolygon(p, poly);
            var box = new Rectangle(T.P(16), T.P(13), T.P(18), T.P(18));
            g.SmoothingMode = SmoothingMode.None;
            using (var b = new SolidBrush(T.Screen)) g.FillRectangle(b, box);
            using (var p = new Pen(isChecked && Enabled ? T.Yellow : T.Line)) g.DrawRectangle(p, box);
            if (isChecked)
            {
                var fill = Rectangle.Inflate(box, -T.P(3), -T.P(3));
                using (var b = new SolidBrush(Enabled ? T.Yellow : T.Dim)) g.FillRectangle(b, fill.X, fill.Y, fill.Width + 1, fill.Height + 1);
            }
            int x = T.P(48), w = Width - x - T.P(10), y = T.P(11);
            Color title = Enabled ? T.Ink : T.Dim;
            int th = T.TextHeight(Text, T.BodyBold(10f), w);
            T.Text(g, Text, T.BodyBold(10f), new Rectangle(x, y, w, th), title, TextFormatFlags.WordBreak);
            if (!string.IsNullOrEmpty(Sub))
                T.Text(g, Sub, T.Body(8.75f), new Rectangle(x, y + th + T.P(3), w, Height - y - th), Enabled ? T.Dim : Color.FromArgb(120, T.Dim), TextFormatFlags.WordBreak);
        }
    }

    class NProgress : Control
    {
        double value; int phase;
        public double Value { get { return value; } set { this.value = Math.Max(0, Math.Min(1, value)); Invalidate(); } }
        public NProgress() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true); }
        public void Tick() { phase = (phase + 1) % 1000; Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(T.Screen)) g.FillRectangle(b, ClientRectangle);
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var b = new SolidBrush(T.Panel2)) g.FillRectangle(b, r);
            using (var p = new Pen(T.Line)) g.DrawRectangle(p, r);
            int w = (int)((Width - 4) * value);
            if (w > 0)
            {
                var fill = new Rectangle(2, 2, w, Height - 4);
                using (var b = new SolidBrush(T.Cyan)) g.FillRectangle(b, fill);
                g.SetClip(fill);
                int stripe = T.P(14), off = (phase * 2) % (stripe * 2);
                using (var b = new SolidBrush(Color.FromArgb(60, T.Dark)))
                    for (int x = -stripe * 2 + off; x < w + stripe; x += stripe * 2)
                        g.FillPolygon(b, new[] { new Point(x, Height), new Point(x + stripe, Height), new Point(x + stripe * 2, 0), new Point(x + stripe, 0) });
                g.ResetClip();
            }
        }
    }

    // The last lines of the install log, newest at the bottom.
    class LogView : Control
    {
        readonly List<string> lines = new List<string>();
        public LogView() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true); }
        public void Add(string line) { lines.Add(line); if (lines.Count > 400) lines.RemoveAt(0); Invalidate(); }
        public IEnumerable<string> All { get { return lines; } }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(T.Panel)) g.FillRectangle(b, ClientRectangle);
            using (var p = new Pen(T.Line)) g.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
            using (var b = new SolidBrush(T.Cyan)) g.FillRectangle(b, 0, 0, T.P(3), Height);
            int lh = T.P(17), n = Math.Max(1, (Height - T.P(16)) / lh), first = Math.Max(0, lines.Count - n);
            for (int i = first; i < lines.Count; i++)
            {
                bool last = i == lines.Count - 1;
                T.Text(g, lines[i], T.Mono(8.5f), new Rectangle(T.P(14), T.P(8) + (i - first) * lh, Width - T.P(24), lh), last ? T.Ink : T.Dim, TextFormatFlags.EndEllipsis);
            }
        }
    }

    // A path field with a dark frame and a "Değiştir" button next to it.
    class PathBox : Control
    {
        public readonly TextBox Box;
        public readonly NButton Browse;
        public PathBox()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Box = new TextBox { BorderStyle = BorderStyle.None, BackColor = T.Panel2, ForeColor = T.Ink, Font = T.Mono(10f) };
            Browse = new NButton { Text = "Değiştir…" };
            Controls.Add(Box); Controls.Add(Browse);
        }
        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            Browse.Size = new Size(T.P(110), Height);
            Browse.Location = new Point(Width - Browse.Width, 0);
            Box.Location = new Point(T.P(12), (Height - Box.Height) / 2);
            Box.Width = Browse.Left - T.P(24);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(T.Screen)) g.FillRectangle(b, ClientRectangle);
            var r = new Rectangle(0, 0, Browse.Left - T.P(8), Height - 1);
            using (var b = new SolidBrush(T.Panel2)) g.FillRectangle(b, r);
            using (var p = new Pen(Box.Focused ? T.Cyan : T.Line)) g.DrawRectangle(p, r);
        }
    }

    /* ================================================================ a small Neural dialog */
    static class NDialog
    {
        public static int Ask(IWin32Window owner, string title, string text, params string[] buttons)
        {
            int result = -1;
            using (var f = new NeuralForm(520, 270, false))
            {
                f.BandTitle = title;
                f.StartPosition = FormStartPosition.CenterParent;
                f.ShowInTaskbar = false;
                f.Back.Visible = false; f.Next.Visible = false;
                int bodyH = f.Screen.Height;
                f.Screen.PaintContent = g => T.Text(g, text, T.Body(10.5f), new Rectangle(T.P(26), T.P(24), f.Screen.Width - T.P(52), bodyH - T.P(40)), T.Ink, TextFormatFlags.WordBreak);
                int x = f.ClientSize.Width - T.P(30);
                for (int i = buttons.Length - 1; i >= 0; i--)
                {
                    int index = i;
                    var b = new NButton { Text = buttons[i], Primary = i == 0, Size = new Size(Math.Max(T.P(110), TextRenderer.MeasureText(buttons[i], T.Display(9.5f)).Width + T.P(34)), T.P(36)) };
                    x -= b.Width;
                    b.Location = new Point(x, f.Next.Top);
                    x -= T.P(10);
                    b.Click += delegate { result = index; f.Close(); };
                    f.Controls.Add(b);
                    if (i == 0) f.Shown += delegate { b.Focus(); };
                }
                f.CloseRequested += delegate { result = buttons.Length - 1; f.Close(); };
                f.ShowDialog(owner);
            }
            return result;
        }
    }
}
