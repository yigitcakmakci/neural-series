// Pages and flow of the install and uninstall wizard.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace NeuralSetup
{
    enum Page { Welcome, Apps, Windows, Work, Done, Fail, UWelcome, UWork, UDone }

    class Wizard
    {
        // Text drawn straight onto the screen panel (controls only for what can be clicked).
        class Item
        {
            public string Kind, Text, Code, Sub; public Rectangle R;
        }

        readonly NeuralForm f;
        readonly Options o;
        readonly Payload payload;
        readonly bool uninstallMode, existing;
        readonly List<Item> items = new List<Item>();
        readonly Dictionary<string, NCheck> appChecks = new Dictionary<string, NCheck>();
        readonly List<string> logLines = new List<string>();
        NCheck cStart, cPad, cTerm, cWeb, cView, cDeck, cNavMenu, cNavDefault, cNavWatch, cIcons, cOpenWeb, cRemoveData;
        PathBox pathBox;
        NProgress bar;
        LogView logView;
        Page page;
        bool busy;
        string failMessage = "", workStep = "";
        int X, Y, W;
        bool previewing; // a page opened with /onizle: nothing is installed or deleted when it closes

        public Wizard(NeuralForm form, Options options, Payload pack, bool uninstall, bool existingInstall)
        {
            f = form; o = options; payload = pack; uninstallMode = uninstall; existing = existingInstall;
            page = uninstall ? Page.UWelcome : Page.Welcome;
            f.Screen.PaintContent = Paint;
            f.Back.Click += delegate { Go(-1); };
            f.Next.Click += delegate { Go(+1); };
            f.CloseRequested += OnClose;
            var spin = new System.Windows.Forms.Timer { Interval = 60 };
            spin.Tick += delegate { if (bar != null && busy) bar.Tick(); };
            spin.Start();
            f.Disposed += delegate { spin.Dispose(); };
            // Before the window exists Focus() does nothing, and WinForms would give the first page's first control
            // (a language button) the focus: Enter must start the wizard.
            f.Shown += delegate { if (f.Next.Visible && f.Next.Enabled) { f.ActiveControl = f.Next; f.Next.Focus(); } };
            Retext();
        }

        // Puts every text of the window into the current language and builds the page again with it.
        void Retext()
        {
            f.Steps = uninstallMode ? L.UninstallSteps : L.InstallSteps;
            f.BandTitle = uninstallMode ? L.BandUninstall : L.BandSetup;
            f.Text = uninstallMode ? L.WindowUninstall : L.WindowSetup;
            f.Back.Text = L.Back;
            Show(page);
        }
        // The language buttons of the first page: the wizard changes at once; the choice is written when installing.
        void SetLanguage(string id)
        {
            if (busy || going || id == L.Lang) return;
            L.Lang = id;
            Retext();
        }

        /* ------------------------------------------------------------ navigation */
        bool going;
        void Go(int dir)
        {
            // One step at a time: while a step waits (a dialog, or programs closing with the window kept responsive),
            // another click must not start a second installation in parallel with the first.
            if (going || busy) return;
            going = true;
            try { Step(dir); }
            finally { going = false; }
        }
        void Step(int dir)
        {
            switch (page)
            {
                case Page.Welcome: Show(Page.Apps); break;
                case Page.Apps:
                    if (dir < 0) { ReadApps(); Show(Page.Welcome); }
                    else if (ReadApps() && CheckTarget()) Show(Page.Windows);
                    break;
                case Page.Windows:
                    ReadWindows();
                    if (dir < 0) Show(Page.Apps);
                    else if (CloseRunning()) { Show(Page.Work); Run(false); }
                    break;
                case Page.Done:
                    if (cOpenWeb != null && cOpenWeb.Checked && !o.Test && !previewing) TryStart(new Engine(o, null, null).ExePath("NeuralWeb"));
                    f.Close();
                    break;
                case Page.Fail: f.Close(); break;
                case Page.UWelcome:
                    o.RemoveData = cRemoveData.Checked;
                    if (o.RemoveData && NDialog.Ask(f, L.DlgDataTitle, L.DlgDataText, L.DlgDataYes, L.Cancel) != 0) return;
                    if (CloseRunning()) { Show(Page.UWork); Run(true); }
                    break;
                case Page.UDone:
                    if (!previewing) new Engine(o, null, null).ScheduleSelfDelete();
                    f.Close();
                    break;
            }
        }
        void OnClose()
        {
            if (going) return;
            if (busy && !previewing) { NDialog.Ask(f, L.DlgWaitTitle, L.DlgWaitText, L.Ok); return; }
            if (page == Page.Done || page == Page.Fail || page == Page.UDone || previewing)
            {
                if (page == Page.UDone && !previewing) new Engine(o, null, null).ScheduleSelfDelete();
                f.Close();
                return;
            }
            string text = uninstallMode ? L.DlgExitUninstall : L.DlgExitSetup;
            if (NDialog.Ask(f, L.DlgExitTitle, text, L.DlgExitYes, L.Cancel) == 0) f.Close();
        }

        bool ReadApps()
        {
            o.Apps.Clear();
            foreach (var kv in appChecks) if (kv.Value.Checked) o.Apps.Add(kv.Key);
            if (pathBox != null) o.Root = pathBox.Box.Text.Trim();
            return true;
        }
        void ReadWindows()
        {
            if (cStart == null) return;
            o.StartMenu = cStart.Checked; o.PadOpenWith = cPad.Checked; o.TermCommands = cTerm.Checked; o.WebRegister = cWeb.Checked; o.ViewOpenWith = cView.Checked; o.DeckAutostart = cDeck.Checked;
            o.NavMenu = cNavMenu.Checked; o.NavDefault = cNavDefault.Checked; o.NavWatch = cNavWatch.Checked && cNavDefault.Checked; o.WindowsIcons = cIcons.Checked;
        }
        bool CheckTarget()
        {
            if (o.Apps.Count == 0) { NDialog.Ask(f, L.DlgAppsTitle, L.DlgAppsText, L.Ok); return false; }
            string root = o.Root;
            try { root = Path.GetFullPath(root); } catch { root = null; }
            if (string.IsNullOrEmpty(root) || !Path.IsPathRooted(root) || root.TrimEnd('\\').Length <= 3)
            {
                NDialog.Ask(f, L.DlgFolderTitle, L.DlgFolderInvalid(Environment.UserName), L.Ok);
                return false;
            }
            try
            {
                Directory.CreateDirectory(root);
                string probe = Path.Combine(root, ".yazma-denemesi");
                File.WriteAllText(probe, "");
                File.Delete(probe);
            }
            catch
            {
                NDialog.Ask(f, L.DlgFolderTitle, L.DlgFolderReadOnly, L.Ok);
                return false;
            }
            o.Root = root;
            long need = Need(), free = long.MaxValue;
            try { free = new DriveInfo(Path.GetPathRoot(root)).AvailableFreeSpace; } catch { }
            if (free < need)
                return NDialog.Ask(f, L.DlgDiskTitle, L.DlgDiskText(Size(need), Path.GetPathRoot(root), Size(free)), L.DlgDiskYes, L.Cancel) == 0;
            return true;
        }
        long Need()
        {
            if (payload == null) return 0;
            long runtime = payload.SizeOf("electron/"), exe = payload.SizeOf("base/");
            return runtime + o.Apps.Sum(a => exe + payload.SizeOf("apps/" + a + "/"));
        }
        static string Size(long b)
        {
            return b >= (1L << 30) ? (b / (double)(1L << 30)).ToString("0.0", L.Culture) + " GB" : (b >> 20) + " MB";
        }

        // Programs from this installation must be closed first; the Explorer watcher is stopped by the engine itself.
        bool CloseRunning()
        {
            while (true)
            {
                var running = Engine.RunningIn(o.Root).Where(p => !Engine.IsBackground(p)).ToList();
                if (running.Count == 0) return true;
                string names = string.Join(", ", running.Select(p => p.ProcessName).Distinct());
                int a = NDialog.Ask(f, L.DlgRunningTitle, L.DlgRunningText(names), L.DlgRunningRetry, L.DlgRunningClose, L.Cancel);
                if (a == 2 || a < 0) return false;
                if (a == 1)
                {
                    foreach (var p in running) { try { p.CloseMainWindow(); } catch { } }
                    string status = f.Status;
                    f.Next.Enabled = f.Back.Enabled = false;
                    f.Status = L.StatusClosing;
                    f.Invalidate();
                    var until = DateTime.Now.AddSeconds(8);
                    while (DateTime.Now < until && Engine.RunningIn(o.Root).Any(p => !Engine.IsBackground(p))) { Application.DoEvents(); Thread.Sleep(200); }
                    f.Next.Enabled = f.Back.Enabled = true;
                    f.Status = status;
                    f.Invalidate();
                }
            }
        }

        void Run(bool uninstall)
        {
            if (busy) return;
            busy = true;
            logLines.Clear();
            var th = new Thread(() =>
            {
                Exception err = null;
                try
                {
                    var engine = new Engine(o, (v, s) => Ui(() => { if (bar != null) bar.Value = v; workStep = s; f.Status = s; f.Invalidate(); }), line => Ui(() => { logLines.Add(line); if (logView != null) logView.Add(line); }));
                    if (uninstall) engine.Uninstall(); else engine.Install(payload);
                }
                catch (Exception ex) { err = ex; }
                Ui(() =>
                {
                    busy = false;
                    WriteLog();
                    if (err != null) { failMessage = err.Message; logLines.Add(L.LogError + err); Show(Page.Fail); }
                    else Show(uninstall ? Page.UDone : Page.Done);
                });
            });
            th.SetApartmentState(ApartmentState.STA);
            th.IsBackground = true;
            th.Start();
        }
        void Ui(Action a) { if (!f.IsDisposed) { try { f.BeginInvoke(a); } catch (InvalidOperationException) { } } }
        void WriteLog()
        {
            try { File.WriteAllLines(Path.Combine(Path.GetTempPath(), "neural-kurulum.log"), logLines); } catch { }
        }
        static void TryStart(string exe) { try { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true }); } catch { } }

        /* ------------------------------------------------------------ pages */
        public void Show(Page p)
        {
            page = p;
            items.Clear();
            foreach (Control c in f.Screen.Controls.Cast<Control>().ToList()) { f.Screen.Controls.Remove(c); c.Dispose(); }
            appChecks.Clear();
            cStart = cPad = cTerm = cWeb = cView = cDeck = cNavMenu = cNavDefault = cNavWatch = cIcons = cOpenWeb = cRemoveData = null;
            pathBox = null; bar = null; logView = null;
            X = T.P(36); Y = T.P(30); W = f.Screen.Width - T.P(72);
            f.Back.Visible = false; f.Next.Visible = true; f.Next.Enabled = true; f.Next.Danger = false; f.Next.Primary = true;
            switch (p)
            {
                case Page.Welcome: BuildWelcome(); break;
                case Page.Apps: BuildApps(); break;
                case Page.Windows: BuildWindows(); break;
                case Page.Work: BuildWork(false); break;
                case Page.Done: BuildDone(); break;
                case Page.Fail: BuildFail(); break;
                case Page.UWelcome: BuildUninstall(); break;
                case Page.UWork: BuildWork(true); break;
                case Page.UDone: BuildUDone(); break;
            }
            f.Step = p == Page.Welcome ? 0 : p == Page.Apps ? 1 : p == Page.Windows ? 2 : p == Page.Work ? 3 : p == Page.Done || p == Page.Fail ? 4
                : p == Page.UWelcome ? 0 : p == Page.UWork ? 1 : 2;
            // Enter always means the main button of the page, never an extra one such as "Varsayılan tarayıcıyı seç…" (choose the default browser).
            // Focus() as well: after the work page disabled Next, Windows has no focus at all while WinForms still
            // counts Next as the active control, so setting ActiveControl alone would change nothing.
            if (f.Next.Visible && f.Next.Enabled)
            {
                f.ActiveControl = f.Next;
                if (f.Next.CanFocus) f.Next.Focus();
            }
            f.Invalidate();
            f.Screen.Invalidate();
            f.Next.Invalidate();
        }

        void Add(string kind, string text, Font font, int gap) { Add(kind, text, font, gap, W); }
        void Add(string kind, string text, Font font, int gap, int width)
        {
            int h = T.TextHeight(text, font, width);
            items.Add(new Item { Kind = kind, Text = text, R = new Rectangle(X, Y, width, h) });
            Y += h + T.P(gap);
        }
        void Title(string s) { Add("title", s, T.Display(19f), 10); }
        void Lead(string s) { Add("lead", s, T.Body(10.5f), 14); }
        void Note(string s) { Add("note", s, T.Body(9f), 10); }
        void Label(string s) { Add("label", T.Spaced(s.ToUpper(L.Culture)), T.Mono(8.5f), 8); }
        void Box(string kind, string s)
        {
            int h = T.TextHeight(s, T.Body(9.5f), W - T.P(36)) + T.P(24);
            items.Add(new Item { Kind = kind, Text = s, R = new Rectangle(X, Y, W, h) });
            Y += h + T.P(14);
        }
        NCheck Check(string title, string sub, bool on, int x, int y, int w)
        {
            var c = new NCheck { Text = title, Sub = sub, Checked = on };
            c.Location = new Point(x, y);
            c.Size = new Size(w, c.Measure(w));
            f.Screen.Controls.Add(c);
            return c;
        }
        // A button sized to its text, at least the given width.
        NButton Button(string text, int minWidth)
        {
            var b = new NButton { Text = text };
            b.Size = new Size(Math.Max(T.P(minWidth), TextRenderer.MeasureText(text, b.Font).Width + T.P(34)), T.P(36));
            return b;
        }

        // Türkçe / English in the top right corner of the first page, the chosen one lit; returns the width it takes.
        int LanguageButtons()
        {
            int x = X + W;
            for (int i = L.Ids.Length - 1; i >= 0; i--)
            {
                string id = L.Ids[i];
                var b = new NButton { Text = L.NameOf(id), Primary = id == L.Lang, AccessibleName = L.LanguageChoice + ": " + L.NameOf(id) };
                b.Size = new Size(TextRenderer.MeasureText(b.Text, b.Font).Width + T.P(30), T.P(32));
                x -= b.Width;
                b.Location = new Point(x, Y);
                x -= T.P(6);
                b.Click += delegate { SetLanguage(id); };
                f.Screen.Controls.Add(b);
            }
            return X + W - x;
        }

        void BuildWelcome()
        {
            f.Status = payload != null ? L.StatusPackage(Size(new FileInfo(Process.GetCurrentProcess().MainModule.FileName).Length), Engine.Version) : "";
            int languages = LanguageButtons();
            Add("title", L.WelcomeTitle, T.Display(19f), 10, W - languages - T.P(10));
            Lead(L.WelcomeLead);
            foreach (var a in Apps.All)
            {
                items.Add(new Item { Kind = "app", Code = a.Code, Text = a.Id, Sub = a.Summary, R = new Rectangle(X, Y, W, T.P(30)) });
                Y += T.P(32);
            }
            Y += T.P(12);
            if (existing)
                Box("info", L.WelcomeExisting(o.Root));
            else
                Note(L.WelcomeNote);
            f.Next.Text = L.WelcomeStart;
        }

        void BuildApps()
        {
            f.Back.Visible = true;
            f.Next.Text = L.Next;
            Title(L.AppsTitle);
            Lead(L.AppsLead);
            int colW = (W - T.P(14)) / 2, y0 = Y, rowH = 0, i = 0;
            foreach (var a in Apps.All)
            {
                long size = payload != null ? payload.SizeOf("base/") + payload.SizeOf("apps/" + a.Id + "/") : 0;
                int col = i % 2, x = X + col * (colW + T.P(14));
                var c = Check(a.Id + "  " + a.Code, a.Summary + (size > 0 ? " · " + Size(size) : ""), o.Apps.Contains(a.Id), x, Y, colW);
                c.Changed += delegate { UpdateNeedStatus(); };
                appChecks[a.Id] = c;
                rowH = Math.Max(rowH, c.Height);
                if (col == 1 || i == Apps.All.Length - 1) { Y += rowH + T.P(10); rowH = 0; }
                i++;
            }
            Y += T.P(10);
            Label(L.AppsFolder);
            pathBox = new PathBox { Location = new Point(X, Y), Size = new Size(W, T.P(36)) };
            pathBox.Box.Text = o.Root;
            pathBox.Browse.Click += delegate
            {
                using (var d = new FolderBrowserDialog { Description = L.AppsBrowse, ShowNewFolderButton = true })
                {
                    string parent = Path.GetDirectoryName(pathBox.Box.Text.TrimEnd('\\'));
                    if (Directory.Exists(parent)) d.SelectedPath = parent;
                    if (d.ShowDialog(f) == DialogResult.OK)
                    {
                        string sel = d.SelectedPath.TrimEnd('\\');
                        pathBox.Box.Text = Path.GetFileName(sel).Equals("Neural", StringComparison.OrdinalIgnoreCase) ? sel : Path.Combine(sel, "Neural");
                    }
                }
            };
            pathBox.Box.TextChanged += delegate { UpdateNeedStatus(); };
            f.Screen.Controls.Add(pathBox);
            Y += pathBox.Height + T.P(10);
            Note(L.AppsNote);
            UpdateNeedStatus();
        }
        void UpdateNeedStatus()
        {
            var keep = new HashSet<string>(o.Apps);
            o.Apps.Clear();
            foreach (var kv in appChecks) if (kv.Value.Checked) o.Apps.Add(kv.Key);
            string free = null;
            try { free = Size(new DriveInfo(Path.GetPathRoot(Path.GetFullPath(pathBox.Box.Text))).AvailableFreeSpace); } catch { }
            f.Status = L.StatusNeed(Size(Need()), free);
            if (page != Page.Apps) { o.Apps.Clear(); foreach (var a in keep) o.Apps.Add(a); }
            f.Invalidate();
        }

        void BuildWindows()
        {
            f.Back.Visible = true;
            f.Next.Text = existing ? L.Update : L.Install;
            f.Status = L.WinStatus;
            Title(L.WinTitle);
            Lead(L.WinLead);
            int colW = (W - T.P(14)) / 2, x1 = X, x2 = X + colW + T.P(14);
            bool pad = o.Apps.Contains("NeuralPad"), nav = o.Apps.Contains("NeuralNav"), term = o.Apps.Contains("NeuralTerm"), web = o.Apps.Contains("NeuralWeb"), view = o.Apps.Contains("NeuralView"), deck = o.Apps.Contains("NeuralDeck");
            Func<NCheck, NCheck, int> row = (a, b) => Math.Max(a.Height, b == null ? 0 : b.Height) + T.P(10);
            cStart = Check(L.OptStart, L.OptStartSub, o.StartMenu, x1, Y, colW);
            cWeb = Check(L.OptWeb, L.OptWebSub, web && o.WebRegister, x2, Y, colW);
            Y += row(cStart, cWeb);
            cPad = Check(L.OptPad, L.OptPadSub, pad && o.PadOpenWith, x1, Y, colW);
            cView = Check(L.OptView, L.OptViewSub, view && o.ViewOpenWith, x2, Y, colW);
            Y += row(cPad, cView);
            cTerm = Check(L.OptTerm, L.OptTermSub, term && o.TermCommands, x1, Y, colW);
            cNavMenu = Check(L.OptNavMenu, L.OptNavMenuSub, nav && o.NavMenu, x2, Y, colW);
            Y += row(cTerm, cNavMenu);
            cNavDefault = Check(L.OptNavDefault, L.OptNavDefaultSub, nav && o.NavDefault, x1, Y, colW);
            cNavWatch = Check(L.OptNavWatch, L.OptNavWatchSub, nav && o.NavDefault && o.NavWatch, x2, Y, colW);
            Y += row(cNavDefault, cNavWatch);
            cIcons = Check(L.OptIcons, L.OptIconsSub, o.WindowsIcons, x1, Y, colW);
            cDeck = Check(L.OptDeck, L.OptDeckSub, deck && o.DeckAutostart, x2, Y, colW);
            Y += row(cIcons, cDeck);
            cPad.Enabled = pad; cTerm.Enabled = term; cWeb.Enabled = web; cView.Enabled = view; cDeck.Enabled = deck; cNavMenu.Enabled = nav; cNavDefault.Enabled = nav;
            cNavWatch.Enabled = nav && cNavDefault.Checked;
            cNavDefault.Changed += delegate { cNavWatch.Enabled = cNavDefault.Checked; if (!cNavDefault.Checked) cNavWatch.Checked = false; };
        }

        void BuildWork(bool uninstall)
        {
            f.Next.Text = uninstall ? L.Removing : L.Installing;
            f.Next.Enabled = false;
            Title(uninstall ? L.WorkTitleUninstall : existing ? L.WorkTitleUpdate : L.WorkTitleInstall);
            Lead(uninstall ? L.WorkLeadUninstall : L.WorkLeadInstall);
            items.Add(new Item { Kind = "step", R = new Rectangle(X, Y, W, T.P(22)) });
            Y += T.P(28);
            bar = new NProgress { Location = new Point(X, Y), Size = new Size(W, T.P(18)) };
            f.Screen.Controls.Add(bar);
            Y += bar.Height + T.P(18);
            logView = new LogView { Location = new Point(X, Y), Size = new Size(W, f.Screen.Height - Y - T.P(28)) };
            foreach (var l in logLines) logView.Add(l);
            f.Screen.Controls.Add(logView);
        }

        void BuildDone()
        {
            f.Next.Text = L.Finish;
            f.Status = o.Root;
            Title(existing ? L.DoneTitleUpdate : L.DoneTitleInstall);
            Lead(L.DoneLead(o.Root));
            bool web = o.Apps.Contains("NeuralWeb"), view = o.Apps.Contains("NeuralView");
            if (web)
            {
                cOpenWeb = Check(L.DoneOpenWeb, L.DoneOpenWebSub, !o.Test, X, Y, W / 2);
                Y += cOpenWeb.Height + T.P(14);
            }
            // Windows lets only the user choose a default app; each button opens that program's page in Settings.
            var defaults = new List<NButton>();
            Func<string, string, int, NButton> settingsButton = (text, app, width) =>
            {
                var b = Button(text, width);
                b.Click += delegate { TryStart("ms-settings:defaultapps?registeredAppUser=" + app); };
                return b;
            };
            if (web && o.WebRegister) defaults.Add(settingsButton(L.DoneDefaultBrowser, "NeuralWeb", 250));
            if (view && o.ViewOpenWith) defaults.Add(settingsButton(L.DoneDefaultPictures, "NeuralView", 290));
            if (defaults.Count > 0)
            {
                int x = X;
                foreach (var b in defaults) { b.Location = new Point(x, Y); f.Screen.Controls.Add(b); x += b.Width + T.P(12); }
                Y += defaults[0].Height + T.P(10);
                Note(L.DoneDefaultsNote(defaults.Count > 1));
                Y += T.P(8);
            }
            Note(L.DoneNote);
            Note(L.DoneLog(Path.Combine(Path.GetTempPath(), "neural-kurulum.log")));
        }

        void BuildFail()
        {
            f.Next.Text = L.Close;
            Title(L.FailTitle);
            Box("warn", failMessage);
            Note(L.FailNote(Path.Combine(Path.GetTempPath(), "neural-kurulum.log")));
            logView = new LogView { Location = new Point(X, Y), Size = new Size(W, Math.Max(T.P(80), f.Screen.Height - Y - T.P(28))) };
            foreach (var l in logLines) logView.Add(l);
            f.Screen.Controls.Add(logView);
        }

        void BuildUninstall()
        {
            f.Next.Text = L.UninstallButton;
            f.Next.Primary = false; f.Next.Danger = true;
            f.Status = o.Root;
            Title(L.UninstallTitle);
            var installed = Apps.All.Where(a => Directory.Exists(Path.Combine(o.Root, a.Id, "Program"))).Select(a => a.Id).ToList();
            Lead(L.UninstallLead(installed.Count > 0 ? string.Join(", ", installed) : null, o.NavDefault));
            cRemoveData = Check(L.UninstallData, L.UninstallDataSub, false, X, Y, W);
            Y += cRemoveData.Height + T.P(16);
            Note(L.UninstallNote);
        }

        void BuildUDone()
        {
            f.Next.Text = L.Finish;
            Title(L.UDoneTitle);
            Lead(o.RemoveData ? L.UDoneLeadData : L.UDoneLead);
            Note(L.UDoneNote);
        }

        /* ------------------------------------------------------------ painting */
        void Paint(Graphics g)
        {
            foreach (var it in items)
            {
                switch (it.Kind)
                {
                    case "title": T.Text(g, it.Text, T.Display(19f), it.R, T.Ink, TextFormatFlags.WordBreak); break;
                    case "lead": T.Text(g, it.Text, T.Body(10.5f), it.R, T.Ink, TextFormatFlags.WordBreak); break;
                    case "note": T.Text(g, it.Text, T.Body(9f), it.R, T.Dim, TextFormatFlags.WordBreak); break;
                    case "label": T.Text(g, it.Text, T.Mono(8.5f), it.R, T.Dim, TextFormatFlags.Left); break;
                    case "app":
                        {
                            var chip = new Rectangle(it.R.X, it.R.Y + T.P(3), T.P(54), T.P(22));
                            using (var b = new SolidBrush(T.Yellow)) g.FillPolygon(b, T.CutTopRight(chip, T.P(6)));
                            T.Text(g, it.Code, T.Display(9f), chip, T.Dark, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                            T.Text(g, it.Text, T.Display(11f), new Rectangle(chip.Right + T.P(14), it.R.Y, T.P(130), it.R.Height), T.Ink, TextFormatFlags.VerticalCenter);
                            T.Text(g, it.Sub, T.Body(9.5f), new Rectangle(chip.Right + T.P(150), it.R.Y, it.R.Width - T.P(210), it.R.Height), T.Dim, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                            break;
                        }
                    case "info":
                    case "warn":
                        {
                            Color bar = it.Kind == "warn" ? T.Red : T.Cyan;
                            using (var b = new SolidBrush(T.Panel2)) g.FillRectangle(b, it.R);
                            using (var p = new Pen(T.Line)) g.DrawRectangle(p, it.R.X, it.R.Y, it.R.Width - 1, it.R.Height - 1);
                            using (var b = new SolidBrush(bar)) g.FillRectangle(b, it.R.X, it.R.Y, T.P(3), it.R.Height);
                            T.Text(g, it.Text, T.Body(9.5f), new Rectangle(it.R.X + T.P(18), it.R.Y + T.P(12), it.R.Width - T.P(36), it.R.Height - T.P(20)), it.Kind == "warn" ? T.Ink : T.Ink, TextFormatFlags.WordBreak);
                            break;
                        }
                    case "step":
                        {
                            string pct = bar != null ? ((int)Math.Round(bar.Value * 100)) + "%" : "";
                            T.Text(g, workStep, T.Mono(10f), new Rectangle(it.R.X, it.R.Y, it.R.Width - T.P(60), it.R.Height), T.Cyan, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                            T.Text(g, pct, T.Display(12f), it.R, T.Yellow, TextFormatFlags.Right | TextFormatFlags.VerticalCenter);
                            break;
                        }
                }
            }
        }

        /* ------------------------------------------------------------ previews for screenshots (test mode only) */
        // Nothing runs: the work pages show sample lines, and closing a preview installs or deletes nothing.
        public void Preview(string which)
        {
            previewing = true;
            switch (which)
            {
                case "programlar": Show(Page.Apps); break;
                case "windows": Show(Page.Windows); break;
                case "kurulum":
                case "siliniyor":
                    bool remove = which == "siliniyor";
                    Show(remove ? Page.UWork : Page.Work);
                    busy = true;
                    workStep = remove ? L.ProgressDeleting("NeuralWeb") : L.ProgressStamping("NeuralWeb");
                    bar.Value = 0.62;
                    var lines = remove
                        ? new[] { L.LogUninstalling(o.Root), L.LogUnregistered, L.LogShortcutDeleted(Apps.Get("NeuralCalc").ShortcutName + ".lnk"), L.LogProgramDeleted("NeuralCalc"), L.LogProgramDeleted("NeuralPad"), L.LogProgramDeleted("NeuralNav") }
                        : new[] { L.LogInstallFolder(o.Root), L.LogRuntime, "NeuralCalc KX-9 → ...\\NeuralCalc\\Program", L.LogLinks(72), L.LogExeReady("NeuralCalc"), "NeuralWeb NW-1 → ...\\NeuralWeb\\Program" };
                    foreach (var l in lines) logView.Add(l);
                    break;
                case "tamam": Show(Page.Done); break;
                case "kaldirildi": Show(Page.UDone); break;
                case "hata": failMessage = L.SampleError; Show(Page.Fail); break;
            }
        }
    }
}
