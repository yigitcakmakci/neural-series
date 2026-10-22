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
        NCheck cStart, cPad, cTerm, cWeb, cView, cNavMenu, cNavDefault, cNavWatch, cIcons, cOpenWeb, cRemoveData;
        PathBox pathBox;
        NProgress bar;
        LogView logView;
        Page page;
        bool busy;
        string failMessage = "", workStep = "";
        int X, Y, W;
        static readonly string[] InstallSteps = { "Hoş geldin", "Programlar", "Windows", "Kurulum", "Tamam" };
        static readonly string[] UninstallSteps = { "Kaldır", "Siliniyor", "Tamam" };

        public Wizard(NeuralForm form, Options options, Payload pack, bool uninstall, bool existingInstall)
        {
            f = form; o = options; payload = pack; uninstallMode = uninstall; existing = existingInstall;
            f.Steps = uninstall ? UninstallSteps : InstallSteps;
            f.BandTitle = uninstall ? "NEURAL KALDIRMA" : "NEURAL KURULUM";
            f.Text = uninstall ? "Neural serisini kaldır" : "Neural serisi kurulumu";
            f.Screen.PaintContent = Paint;
            f.Back.Click += delegate { Go(-1); };
            f.Next.Click += delegate { Go(+1); };
            f.CloseRequested += OnClose;
            var spin = new System.Windows.Forms.Timer { Interval = 60 };
            spin.Tick += delegate { if (bar != null && busy) bar.Tick(); };
            spin.Start();
            f.Disposed += delegate { spin.Dispose(); };
            Show(uninstall ? Page.UWelcome : Page.Welcome);
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
                    if (cOpenWeb != null && cOpenWeb.Checked && !o.Test) TryStart(new Engine(o, null, null).ExePath("NeuralWeb"));
                    f.Close();
                    break;
                case Page.Fail: f.Close(); break;
                case Page.UWelcome:
                    o.RemoveData = cRemoveData.Checked;
                    if (o.RemoveData && NDialog.Ask(f, "VERİLER SİLİNECEK", "Yer imlerin, geçmişin, kayıtlı şifrelerin, notların ve bütün ayarların kalıcı olarak silinecek. Bu geri alınamaz.\n\nDevam edilsin mi?", "Verileri de sil", "Vazgeç") != 0) return;
                    if (CloseRunning()) { Show(Page.UWork); Run(true); }
                    break;
                case Page.UDone:
                    new Engine(o, null, null).ScheduleSelfDelete();
                    f.Close();
                    break;
            }
        }
        void OnClose()
        {
            if (going) return;
            if (busy) { NDialog.Ask(f, "BEKLE", "İşlem sürüyor; yarıda kesilirse programlar eksik kalır. Bitmesine birkaç saniye kaldı.", "Tamam"); return; }
            if (page == Page.Done || page == Page.Fail || page == Page.UDone)
            {
                if (page == Page.UDone) new Engine(o, null, null).ScheduleSelfDelete();
                f.Close();
                return;
            }
            string text = uninstallMode ? "Neural serisi kaldırılmadan çıkılsın mı?" : "Kurulum yapılmadan çıkılsın mı?";
            if (NDialog.Ask(f, "ÇIKIŞ", text, "Çık", "Vazgeç") == 0) f.Close();
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
            o.StartMenu = cStart.Checked; o.PadOpenWith = cPad.Checked; o.TermCommands = cTerm.Checked; o.WebRegister = cWeb.Checked; o.ViewOpenWith = cView.Checked;
            o.NavMenu = cNavMenu.Checked; o.NavDefault = cNavDefault.Checked; o.NavWatch = cNavWatch.Checked && cNavDefault.Checked; o.WindowsIcons = cIcons.Checked;
        }
        bool CheckTarget()
        {
            if (o.Apps.Count == 0) { NDialog.Ask(f, "PROGRAM SEÇ", "Kurmak için en az bir program seç.", "Tamam"); return false; }
            string root = o.Root;
            try { root = Path.GetFullPath(root); } catch { root = null; }
            if (string.IsNullOrEmpty(root) || !Path.IsPathRooted(root) || root.TrimEnd('\\').Length <= 3)
            {
                NDialog.Ask(f, "KLASÖR", "Geçerli bir kurulum klasörü seç (ör. C:\\Users\\" + Environment.UserName + "\\Neural).", "Tamam");
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
                NDialog.Ask(f, "KLASÖR", "Bu klasöre yazılamıyor. Yönetici izni gerektirmeyen bir yer seç; kişisel klasörün en güvenli seçenek.", "Tamam");
                return false;
            }
            o.Root = root;
            long need = Need(), free = long.MaxValue;
            try { free = new DriveInfo(Path.GetPathRoot(root)).AvailableFreeSpace; } catch { }
            if (free < need)
                return NDialog.Ask(f, "DİSK ALANI", string.Format("Kurulum için yaklaşık {0} gerekiyor, {1} sürücüsünde {2} boş.\n\nYine de devam edilsin mi?", Size(need), Path.GetPathRoot(root), Size(free)), "Devam et", "Vazgeç") == 0;
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
            return b >= (1L << 30) ? (b / (double)(1L << 30)).ToString("0.0", new System.Globalization.CultureInfo("tr-TR")) + " GB" : (b >> 20) + " MB";
        }

        // Programs from this installation must be closed first; the Explorer watcher is stopped by the engine itself.
        bool CloseRunning()
        {
            while (true)
            {
                var running = Engine.RunningIn(o.Root).Where(p => !p.ProcessName.Equals("nvwatch", StringComparison.OrdinalIgnoreCase)).ToList();
                if (running.Count == 0) return true;
                string names = string.Join(", ", running.Select(p => p.ProcessName).Distinct());
                int a = NDialog.Ask(f, "AÇIK PROGRAMLAR", "Devam etmeden önce şunları kapat: " + names + ".\n\n\"Benim yerime kapat\" pencerelerine kapatma isteği gönderir; kaydedilmemiş bir şey varsa program sorar.", "Yeniden dene", "Benim yerime kapat", "Vazgeç");
                if (a == 2 || a < 0) return false;
                if (a == 1)
                {
                    foreach (var p in running) { try { p.CloseMainWindow(); } catch { } }
                    string status = f.Status;
                    f.Next.Enabled = f.Back.Enabled = false;
                    f.Status = "Programlar kapatılıyor…";
                    f.Invalidate();
                    var until = DateTime.Now.AddSeconds(8);
                    while (DateTime.Now < until && Engine.RunningIn(o.Root).Any(p => !p.ProcessName.Equals("nvwatch", StringComparison.OrdinalIgnoreCase))) { Application.DoEvents(); Thread.Sleep(200); }
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
                    if (err != null) { failMessage = err.Message; logLines.Add("HATA: " + err); Show(Page.Fail); }
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
            cStart = cPad = cTerm = cWeb = cView = cNavMenu = cNavDefault = cNavWatch = cIcons = cOpenWeb = cRemoveData = null;
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

        void Add(string kind, string text, Font font, int gap)
        {
            int h = T.TextHeight(text, font, W);
            items.Add(new Item { Kind = kind, Text = text, R = new Rectangle(X, Y, W, h) });
            Y += h + T.P(gap);
        }
        void Title(string s) { Add("title", s, T.Display(19f), 10); }
        void Lead(string s) { Add("lead", s, T.Body(10.5f), 14); }
        void Note(string s) { Add("note", s, T.Body(9f), 10); }
        void Label(string s) { Add("label", T.Spaced(s.ToUpper(new System.Globalization.CultureInfo("tr-TR"))), T.Mono(8.5f), 8); }
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

        void BuildWelcome()
        {
            f.Status = payload != null ? "Paket: " + Size(new FileInfo(Process.GetCurrentProcess().MainModule.FileName).Length) + " · Neural serisi " + Engine.Version : "";
            Title("Neural serisine hoş geldin");
            Lead("Bu sihirbaz Neural serisinin altı programını bilgisayarına kurar. Hepsi aynı Neural tasarımını ve tek bir ortak Electron çalışma klasörünü paylaşır.");
            foreach (var a in Apps.All)
            {
                items.Add(new Item { Kind = "app", Code = a.Code, Text = a.Id, Sub = a.Summary, R = new Rectangle(X, Y, W, T.P(30)) });
                Y += T.P(32);
            }
            Y += T.P(12);
            if (existing)
                Box("info", "Bilgisayarında bir Neural kurulumu var: " + o.Root + "\nKurulum onu güncelleyecek. Ayarların, yer imlerin, şifrelerin ve notların olduğu gibi kalır.");
            else
                Note("Ayarlar ve kişisel veriler programlardan ayrı tutulur; güncelleme ya da yeniden kurulum onlara dokunmaz.");
            f.Next.Text = "Başla  ›";
        }

        void BuildApps()
        {
            f.Back.Visible = true;
            f.Next.Text = "İleri  ›";
            Title("Programlar ve konum");
            Lead("Kurulacak programları ve kurulum klasörünü seç. Seçmediğin programlar bilgisayarında zaten kuruluysa oldukları gibi kalır.");
            int colW = (W - T.P(14)) / 2, y0 = Y, rowH = 0, i = 0;
            foreach (var a in Apps.All)
            {
                long size = payload != null ? payload.SizeOf("base/") + payload.SizeOf("apps/" + a.Id + "/") : 0;
                int col = i % 2, x = X + col * (colW + T.P(14));
                var c = Check(a.Id + "  " + a.Code, a.Summary + (size > 0 ? " · " + Size(size) : ""), o.Apps.Contains(a.Id), x, Y, colW);
                c.Changed += delegate { UpdateNeedStatus(); };
                appChecks[a.Id] = c;
                rowH = Math.Max(rowH, c.Height);
                if (col == 1 || i == Apps.All.Length - 1) { Y += rowH + T.P(10); rowH = 0; }
                i++;
            }
            Y += T.P(10);
            Label("Kurulum klasörü");
            pathBox = new PathBox { Location = new Point(X, Y), Size = new Size(W, T.P(36)) };
            pathBox.Box.Text = o.Root;
            pathBox.Browse.Click += delegate
            {
                using (var d = new FolderBrowserDialog { Description = "Neural programlarının kurulacağı yeri seç. Seçtiğin klasörün içinde bir Neural klasörü açılır.", ShowNewFolderButton = true })
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
            Note("Programlar ortak Electron dosyalarını sabit bağlantıyla paylaşır; aynı dosyalar diskte bir kez durur.");
            UpdateNeedStatus();
        }
        void UpdateNeedStatus()
        {
            var keep = new HashSet<string>(o.Apps);
            o.Apps.Clear();
            foreach (var kv in appChecks) if (kv.Value.Checked) o.Apps.Add(kv.Key);
            string free = "";
            try { free = " · boş: " + Size(new DriveInfo(Path.GetPathRoot(Path.GetFullPath(pathBox.Box.Text))).AvailableFreeSpace); } catch { }
            f.Status = "Gereken alan ≈ " + Size(Need()) + free;
            if (page != Page.Apps) { o.Apps.Clear(); foreach (var a in keep) o.Apps.Add(a); }
            f.Invalidate();
        }

        void BuildWindows()
        {
            f.Back.Visible = true;
            f.Next.Text = existing ? "Güncelle" : "Kur";
            f.Status = "Sonradan kurulumla değiştirebilirsin.";
            Title("Windows ile bağlantılar");
            Lead("Hangi Windows özelliklerinin Neural programlarını kullanacağını seç. Kutuyu kaldırırsan o bağlantı geri alınır.");
            int colW = (W - T.P(14)) / 2, x1 = X, x2 = X + colW + T.P(14);
            bool pad = o.Apps.Contains("NeuralPad"), nav = o.Apps.Contains("NeuralNav"), term = o.Apps.Contains("NeuralTerm"), web = o.Apps.Contains("NeuralWeb"), view = o.Apps.Contains("NeuralView");
            Func<NCheck, NCheck, int> row = (a, b) => Math.Max(a.Height, b == null ? 0 : b.Height) + T.P(10);
            cStart = Check("Başlat menüsü kısayolları", "Programlar Başlat menüsünde ve Windows aramasında görünür.", o.StartMenu, x1, Y, colW);
            cWeb = Check("NeuralWeb'i tarayıcı olarak tanıt", "Varsayılan tarayıcıyı yine sen Windows Ayarlar'dan seçersin.", web && o.WebRegister, x2, Y, colW);
            Y += row(cStart, cWeb);
            cPad = Check("NeuralPad: .txt için \"Birlikte aç\"", "Varsayılan not defterin değişmez.", pad && o.PadOpenWith, x1, Y, colW);
            cView = Check("NeuralView: resimler için \"Birlikte aç\"", "Varsayılan resim uygulaman değişmez.", view && o.ViewOpenWith, x2, Y, colW);
            Y += row(cPad, cView);
            cTerm = Check("NeuralTerm: nt komutu ve sağ tık", "Win+R'de nt; klasörlerde \"NeuralTerm'de aç\".", term && o.TermCommands, x1, Y, colW);
            cNavMenu = Check("NeuralNav: \"NeuralNav ile aç\"", "Klasörlerin ve sürücülerin sağ tık menüsüne eklenir.", nav && o.NavMenu, x2, Y, colW);
            Y += row(cTerm, cNavMenu);
            cNavDefault = Check("NeuralNav varsayılan klasör açıcı", "Klasörlere çift tıklayınca NeuralNav açılır. Kaldırınca Windows Gezgini geri gelir.", nav && o.NavDefault, x1, Y, colW);
            cNavWatch = Check("Gezgin pencerelerini yakala", "Küçük bir izleyici, Win+E dahil açılan Gezgin pencerelerini NeuralNav'a çevirir.", nav && o.NavDefault && o.NavWatch, x2, Y, colW);
            Y += row(cNavDefault, cNavWatch);
            cIcons = Check("Windows simgelerini değiştir", "Bu Bilgisayar, Geri Dönüşüm Kutusu, Ağ ve kullanıcı klasörü Neural simgelerini alır.", o.WindowsIcons, x1, Y, colW);
            Y += row(cIcons, null);
            cPad.Enabled = pad; cTerm.Enabled = term; cWeb.Enabled = web; cView.Enabled = view; cNavMenu.Enabled = nav; cNavDefault.Enabled = nav;
            cNavWatch.Enabled = nav && cNavDefault.Checked;
            cNavDefault.Changed += delegate { cNavWatch.Enabled = cNavDefault.Checked; if (!cNavDefault.Checked) cNavWatch.Checked = false; };
        }

        void BuildWork(bool uninstall)
        {
            f.Next.Text = uninstall ? "Siliniyor…" : "Kuruluyor…";
            f.Next.Enabled = false;
            Title(uninstall ? "Kaldırılıyor" : existing ? "Güncelleniyor" : "Kuruluyor");
            Lead(uninstall ? "Programlar, kısayollar ve Windows bağlantıları kaldırılıyor." : "Dosyalar açılıyor, her programa kendi simgesi basılıyor ve Windows'a tanıtılıyor. Bu bir iki dakika sürebilir.");
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
            f.Next.Text = "Bitir";
            f.Status = o.Root;
            Title(existing ? "Güncelleme tamamlandı" : "Kurulum tamamlandı");
            Lead("Neural serisi hazır. Programlar Başlat menüsünde; hepsi " + o.Root + " klasöründe.");
            bool web = o.Apps.Contains("NeuralWeb");
            if (web)
            {
                cOpenWeb = Check("NeuralWeb'i şimdi aç", "Bitir'e basınca tarayıcı açılır.", !o.Test, X, Y, W / 2);
                Y += cOpenWeb.Height + T.P(14);
                if (o.WebRegister)
                {
                    var b = new NButton { Text = "Varsayılan tarayıcıyı seç…", Location = new Point(X, Y), Size = new Size(T.P(250), T.P(36)) };
                    b.Click += delegate { TryStart("ms-settings:defaultapps?registeredAppUser=NeuralWeb"); };
                    f.Screen.Controls.Add(b);
                    Y += b.Height + T.P(18);
                }
            }
            Note("Seçenekleri değiştirmek için kurulumu yeniden çalıştırman yeterli. Kaldırmak için: Windows Ayarlar › Uygulamalar › Neural serisi.");
            Note("Kurulum günlüğü: " + Path.Combine(Path.GetTempPath(), "neural-kurulum.log"));
        }

        void BuildFail()
        {
            f.Next.Text = "Kapat";
            Title("İşlem tamamlanamadı");
            Box("warn", failMessage);
            Note("Ayrıntılar kurulum günlüğünde: " + Path.Combine(Path.GetTempPath(), "neural-kurulum.log") + ". Kurulumu yeniden çalıştırmak yarım kalan işi tamamlar.");
            logView = new LogView { Location = new Point(X, Y), Size = new Size(W, Math.Max(T.P(80), f.Screen.Height - Y - T.P(28))) };
            foreach (var l in logLines) logView.Add(l);
            f.Screen.Controls.Add(logView);
        }

        void BuildUninstall()
        {
            f.Next.Text = "Kaldır";
            f.Next.Primary = false; f.Next.Danger = true;
            f.Status = o.Root;
            Title("Neural serisini kaldır");
            var installed = Apps.All.Where(a => Directory.Exists(Path.Combine(o.Root, a.Id, "Program"))).Select(a => a.Id).ToList();
            Lead("Şunlar silinecek: " + (installed.Count > 0 ? string.Join(", ", installed) : "Neural programları") + ", ortak Electron dosyaları, Başlat menüsü kısayolları ve Windows bağlantıları."
                + (o.NavDefault ? " Klasörleri yine Windows Gezgini açacak." : ""));
            cRemoveData = Check("Ayarlarımı ve kişisel verilerimi de sil", "Yer imleri, geçmiş, kayıtlı şifreler, notlar ve bütün program ayarları. Bu geri alınamaz.", false, X, Y, W);
            Y += cRemoveData.Height + T.P(16);
            Note("Kaynak kodlarla çalışıyorsan programların Kaynak klasörlerine dokunulmaz.");
        }

        void BuildUDone()
        {
            f.Next.Text = "Bitir";
            Title("Neural serisi kaldırıldı");
            Lead(o.RemoveData ? "Programlar ve bütün verileri silindi." : "Programlar silindi. Ayarların ve kişisel verilerin duruyor; Neural serisini yeniden kurarsan kaldığın yerden devam eder.");
            Note("Görev çubuğuna sabitlediğin simgeler varsa Windows onları bir sonraki oturumda temizler.");
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
        public void Preview(string which)
        {
            switch (which)
            {
                case "programlar": Show(Page.Apps); break;
                case "windows": Show(Page.Windows); break;
                case "kurulum":
                    Show(Page.Work);
                    busy = true;
                    workStep = "NeuralWeb simgesi basılıyor";
                    bar.Value = 0.62;
                    foreach (var l in new[] { "Kurulum klasörü: " + o.Root, "Ortak Electron çalışma dosyaları → Ortak\\Electron", "NeuralCalc KX-9 → ...\\NeuralCalc\\Program", "  ortak dosyalara 72 sabit bağlantı", "  NeuralCalc.exe kendi simgesi ve adıyla hazır", "NeuralWeb NW-1 → ...\\NeuralWeb\\Program" }) logView.Add(l);
                    break;
                case "tamam": Show(Page.Done); break;
                case "hata": failMessage = "Örnek hata: dosya kullanımda."; Show(Page.Fail); break;
            }
        }
    }
}
