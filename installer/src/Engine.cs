// Setup engine of the Neural series: unpacks the payload, installs the programs, registers them with Windows and
// can take all of it back. Written in C# 5 for the .NET Framework compiler that ships with Windows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using Microsoft.Win32;

namespace NeuralSetup
{
    // One Neural program: what it is called and how Windows should know it.
    class AppInfo
    {
        public string Id, Code, Summary, Ico, ShortcutName, ShortcutDesc, Comments, DataDir;
        // The AppUserModelID each program sets for itself (app.setAppUserModelId); shortcuts must carry the same one,
        // or a pinned shortcut and the program's window show up as two taskbar buttons.
        public string Aumid;
        public bool WorkInHome;
        public AppInfo(string id, string code, string summary, string ico, string shortcutName, string shortcutDesc, string comments, string dataDir, bool workInHome)
        {
            Id = id; Code = code; Summary = summary; Ico = ico; ShortcutName = shortcutName; ShortcutDesc = shortcutDesc;
            Comments = comments; DataDir = dataDir; WorkInHome = workInHome;
            Aumid = id + "." + code.Replace("-", "");
        }
    }

    static class Apps
    {
        public static readonly AppInfo[] All = {
            new AppInfo("NeuralCalc", "KX-9", "Hesap makinesi", "neuralcalc.ico", "NeuralCalc Hesap Makinesi", "NeuralCalc KX-9 cyberpunk hesap makinesi", "NeuralCalc KX-9 hesap makinesi", "NeuralCalc KX-9", false),
            new AppInfo("NeuralPad", "NP-7", "Not defteri", "neuralpad.ico", "NeuralPad Not Defteri", "NeuralPad NP-7 cyberpunk not defteri", "NeuralPad NP-7 not defteri", "NeuralPad", false),
            new AppInfo("NeuralNav", "NV-4", "Dosya gezgini", "neuralnav.ico", "NeuralNav Dosya Gezgini", "NeuralNav NV-4 cyberpunk dosya gezgini", "NeuralNav NV-4 dosya gezgini", "NeuralNav", false),
            new AppInfo("NeuralTerm", "NT-5", "Terminal: PowerShell ve Komut İstemi", "neuralterm.ico", "NeuralTerm Terminal", "NeuralTerm NT-5 Neural serisi terminal", "NeuralTerm NT-5 terminal", "NeuralTerm", true),
            new AppInfo("NeuralWeb", "NW-1", "Web tarayıcısı: kalkan ve şifre yöneticisiyle", "neuralweb.ico", "NeuralWeb", "NeuralWeb NW-1 Neural serisi web tarayıcısı", "NeuralWeb NW-1 web tarayıcısı", "NeuralWeb", false),
            new AppInfo("NeuralView", "VW-3", "Resim görüntüleyici", "neuralview.ico", "NeuralView Resim Görüntüleyici", "NeuralView VW-3 cyberpunk resim görüntüleyici", "NeuralView VW-3 resim görüntüleyici", "NeuralView", false),
        };
        // The programs of the first release (1.0). An installation whose manifest has no "Bilinen" line was made by a
        // setup that knew only these, so any other program is new to it and is offered as checked when updating.
        public static readonly string[] First = { "NeuralCalc", "NeuralPad", "NeuralNav", "NeuralTerm", "NeuralWeb" };
        public static AppInfo Get(string id) { return All.First(a => a.Id == id); }
    }

    // Everything the user chose. Test mode keeps every Windows change inside a throwaway registry key and folder.
    class Options
    {
        public string Root;
        public HashSet<string> Apps = new HashSet<string>();
        public bool StartMenu = true, PadOpenWith = true, NavMenu = true, NavDefault, NavWatch, TermCommands = true, WebRegister = true, WindowsIcons;
        public bool ViewOpenWith = true;
        public bool RemoveData;
        public bool Test;
    }

    class Engine
    {
        public const string Version = BuildInfo.Version; // written by build.ps1 from package.json
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\NeuralSerisi";
        public const string TestPrefix = @"Software\NeuralSetupTest\";
        const string WebAumid = "NeuralWeb.NW1";

        readonly Options o;
        readonly Action<double, string> progress;
        readonly Action<string> log;
        public Engine(Options options, Action<double, string> onProgress, Action<string> onLog)
        {
            o = options; progress = onProgress ?? delegate { }; log = onLog ?? delegate { };
        }

        /* ------------------------------------------------------------ paths */
        public string ProgramDir(string app) { return Path.Combine(o.Root, app, "Program"); }
        public string ExePath(string app) { return Path.Combine(ProgramDir(app), app + ".exe"); }
        string AppFiles(string app) { return Path.Combine(ProgramDir(app), "resources", "app"); }
        string IcoPath(string app) { return Path.Combine(AppFiles(app), Apps.Get(app).Ico); }
        string RuntimeDir { get { return Path.Combine(o.Root, "Ortak", "Electron"); } }
        public string UninstallerPath { get { return Path.Combine(o.Root, "Ortak", "NeuralKaldir.exe"); } }
        string ManifestPath { get { return Path.Combine(o.Root, "Ortak", "kurulum.ini"); } }
        string WatchExe { get { return Path.Combine(AppFiles("NeuralNav"), "nvwatch.exe"); } }
        // Where the programs keep settings and personal data; a test run never touches the real one.
        string DataRoot
        {
            get { return o.Test ? Path.Combine(o.Root, "_test", "AppData") : Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData); }
        }
        string StartMenuDir
        {
            get { return o.Test ? Path.Combine(o.Root, "_test", "Baslat") : Environment.GetFolderPath(Environment.SpecialFolder.Programs); }
        }
        string PinnedDir
        {
            get
            {
                return o.Test ? Path.Combine(o.Root, "_test", "GorevCubugu")
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
            }
        }
        static string Q(string s) { return "\"" + s + "\""; }
        bool Inside(string path)
        {
            return !string.IsNullOrEmpty(path) && path.Trim('"').StartsWith(o.Root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
        }

        /* ------------------------------------------------------------ install */
        public void Install(Payload payload)
        {
            Directory.CreateDirectory(o.Root);
            Directory.CreateDirectory(Path.Combine(o.Root, "Ortak"));
            log("Kurulum klasörü: " + o.Root);
            StopWatcher();

            // Weights for the progress bar: the shared runtime, then each program (copy + stamp), then Windows.
            var apps = Apps.All.Where(a => o.Apps.Contains(a.Id)).ToList();
            double total = 30 + apps.Count * 14 + 6, done = 0;
            Func<double, double> at = w => done / total + w / total;

            progress(0, "Ortak Electron dosyaları açılıyor");
            log("Ortak Electron çalışma dosyaları → Ortak\\Electron");
            DeleteDir(RuntimeDir);
            payload.ExtractFolder("electron/", RuntimeDir, f => progress(at(f * 30), "Ortak Electron dosyaları açılıyor"));
            done += 30;

            foreach (var a in apps)
            {
                string dir = ProgramDir(a.Id);
                progress(at(0), a.Id + " kuruluyor");
                log(a.Id + " " + a.Code + " → " + dir);
                DeleteDir(dir);
                Directory.CreateDirectory(dir);
                int linked = LinkTree(RuntimeDir, dir);
                log("  ortak dosyalara " + linked + " sabit bağlantı");
                payload.ExtractFile("base/electron.exe", ExePath(a.Id), f => progress(at(2 + f * 5), a.Id + " kuruluyor"));
                payload.ExtractFolder("apps/" + a.Id + "/", AppFiles(a.Id), null);
                progress(at(8), a.Id + " simgesi basılıyor");
                ResEdit.SetIcon(ExePath(a.Id), IcoPath(a.Id));
                ResEdit.SetVersion(ExePath(a.Id), a.Id, a.Comments, Version);
                log("  " + a.Id + ".exe kendi simgesi ve adıyla hazır");
                done += 14;
            }

            progress(at(0), "Windows'a tanıtılıyor");
            payload.ExtractFolder("simgeler/", Path.Combine(o.Root, "Simgeler"), null);
            payload.CopyStub(UninstallerPath);
            Integrate();
            WriteDataShortcuts();
            WriteReadme();
            WriteManifest();
            WriteUninstallEntry();
            Notify();
            if (o.NavWatch && o.NavDefault && o.Apps.Contains("NeuralNav") && !o.Test) StartWatcher();
            progress(1, "Kurulum tamamlandı");
            log("Bitti.");
        }

        // Every runtime file appears in each program folder as a hard link: one copy on disk, one place per program.
        static int LinkTree(string from, string to)
        {
            int n = 0;
            foreach (var file in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
            {
                string target = Path.Combine(to, file.Substring(from.Length + 1));
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                if (!Native.CreateHardLink(target, file, IntPtr.Zero)) File.Copy(file, target, true);
                n++;
            }
            return n;
        }

        /* ------------------------------------------------------------ Windows integration */
        Reg R { get { return new Reg(o.Test); } }

        void Integrate()
        {
            var r = R;
            if (o.Apps.Contains("NeuralPad")) { if (o.PadOpenWith) RegisterPad(r); else UnregisterPad(r); }
            if (o.Apps.Contains("NeuralNav"))
            {
                if (o.NavMenu || o.NavDefault) RegisterNavMenu(r); else UnregisterNavMenu(r);
                if (o.NavDefault) SetNavDefault(r); else UnsetNavDefault(r);
                if (o.NavDefault && o.NavWatch) r.Set(@"Software\Microsoft\Windows\CurrentVersion\Run", "NeuralNavWatch", Q(WatchExe));
                else UnsetWatch(r);
            }
            if (o.Apps.Contains("NeuralTerm")) { if (o.TermCommands) RegisterTerm(r); else UnregisterTerm(r); }
            if (o.Apps.Contains("NeuralWeb")) { if (o.WebRegister) RegisterWeb(r); else UnregisterWeb(r); }
            if (o.Apps.Contains("NeuralView")) { if (o.ViewOpenWith) RegisterView(r); else UnregisterView(r); }
            if (o.WindowsIcons) SetIcons(r); else UnsetIcons(r);
            log(o.Test ? "  Windows kayıtları test anahtarına yazıldı" : "  Windows kayıtları güncellendi");

            Directory.CreateDirectory(StartMenuDir);
            foreach (var a in Apps.All.Where(x => o.Apps.Contains(x.Id)))
            {
                string lnk = Path.Combine(StartMenuDir, a.ShortcutName + ".lnk");
                if (o.StartMenu) WriteShortcut(lnk, a);
                else if (File.Exists(lnk) && Inside(ShellLink.Target(lnk))) File.Delete(lnk);
            }
            if (o.StartMenu) log("  Başlat menüsü kısayolları");
            FixPins();
        }

        void WriteShortcut(string lnk, AppInfo a)
        {
            string work = a.WorkInHome ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) : ProgramDir(a.Id);
            ShellLink.Create(lnk, ExePath(a.Id), "", work, IcoPath(a.Id), a.ShortcutDesc, a.Aumid);
        }

        // Taskbar pins of these programs are rewritten when they point at a file that no longer exists (an older
        // layout) or lack the program's AppUserModelID, so a pin survives an update and groups with its window.
        void FixPins()
        {
            if (!Directory.Exists(PinnedDir)) return;
            foreach (var lnk in Directory.GetFiles(PinnedDir, "*.lnk"))
            {
                string target;
                try { target = ShellLink.Target(lnk); } catch { continue; }
                if (!Inside(target)) continue;
                string app = target.Substring(o.Root.TrimEnd('\\').Length + 1).Split('\\')[0];
                var a = Apps.All.FirstOrDefault(x => x.Id == app);
                if (a == null || !File.Exists(ExePath(app))) continue;
                bool moved = !File.Exists(target);
                if (!moved && !(string.Equals(target, ExePath(app), StringComparison.OrdinalIgnoreCase) && ShellLink.Aumid(lnk) != a.Aumid)) continue;
                WriteShortcut(lnk, a);
                Native.SHChangeNotify(0x00002000, 0x0005, lnk, null); // SHCNE_UPDATEITEM, SHCNF_PATHW
                log("  görev çubuğu sabitlemesi güncellendi: " + Path.GetFileName(lnk));
            }
        }

        void RegisterPad(Reg r)
        {
            string exe = ExePath("NeuralPad"), ico = IcoPath("NeuralPad") + ",0", cmd = Q(exe) + " \"%1\"";
            string app = @"Software\Classes\Applications\NeuralPad.exe";
            r.Set(app, "FriendlyAppName", "NeuralPad");
            r.Set(app + @"\DefaultIcon", "", ico);
            r.Set(app + @"\shell\open\command", "", cmd);
            r.Set(app + @"\SupportedTypes", ".txt", "");
            string prog = @"Software\Classes\NeuralPad.txt";
            r.Set(prog, "", "Metin Belgesi (NeuralPad)");
            r.Set(prog + @"\DefaultIcon", "", ico);
            r.Set(prog + @"\shell\open\command", "", cmd);
            r.Set(prog + @"\Application", "ApplicationName", "NeuralPad");
            r.Set(prog + @"\Application", "ApplicationIcon", ico);
            r.Set(prog + @"\Application", "ApplicationDescription", "NeuralPad NP-7 not defteri");
            r.SetNone(@"Software\Classes\.txt\OpenWithProgids", "NeuralPad.txt");
        }
        void UnregisterPad(Reg r)
        {
            r.DeleteTree(@"Software\Classes\Applications\NeuralPad.exe");
            r.DeleteTree(@"Software\Classes\NeuralPad.txt");
            r.DeleteValue(@"Software\Classes\.txt\OpenWithProgids", "NeuralPad.txt");
        }

        // NeuralView joins "Open with" for images and the Default apps list of Windows Settings; the default picture app
        // stays whatever the user chose (Windows lets only the user change it).
        static readonly string[] ImageExts = { ".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".gif", ".webp", ".bmp", ".dib", ".ico", ".svg", ".avif" };
        const string ViewCapabilities = @"Software\NeuralSystems\NeuralView\Capabilities";
        void RegisterView(Reg r)
        {
            string exe = ExePath("NeuralView"), ico = IcoPath("NeuralView") + ",0", cmd = Q(exe) + " \"%1\"";
            string app = @"Software\Classes\Applications\NeuralView.exe";
            r.Set(app, "FriendlyAppName", "NeuralView");
            r.Set(app + @"\DefaultIcon", "", ico);
            r.Set(app + @"\shell\open\command", "", cmd);
            foreach (var ext in ImageExts) r.Set(app + @"\SupportedTypes", ext, "");
            string prog = @"Software\Classes\NeuralView.Image";
            r.Set(prog, "", "Resim (NeuralView)");
            r.Set(prog + @"\DefaultIcon", "", ico);
            r.Set(prog + @"\shell\open\command", "", cmd);
            r.Set(prog + @"\Application", "ApplicationName", "NeuralView");
            r.Set(prog + @"\Application", "ApplicationIcon", ico);
            r.Set(prog + @"\Application", "ApplicationDescription", "NeuralView VW-3 resim görüntüleyici");
            r.Set(prog + @"\Application", "AppUserModelId", Apps.Get("NeuralView").Aumid);
            foreach (var ext in ImageExts) r.SetNone(@"Software\Classes\" + ext + @"\OpenWithProgids", "NeuralView.Image");
            r.Set(ViewCapabilities, "ApplicationName", "NeuralView");
            r.Set(ViewCapabilities, "ApplicationDescription", "NeuralView VW-3 resim görüntüleyici");
            r.Set(ViewCapabilities, "ApplicationIcon", ico);
            foreach (var ext in ImageExts) r.Set(ViewCapabilities + @"\FileAssociations", ext, "NeuralView.Image");
            r.Set(@"Software\RegisteredApplications", "NeuralView", ViewCapabilities);
        }
        void UnregisterView(Reg r)
        {
            r.DeleteTree(@"Software\Classes\Applications\NeuralView.exe");
            r.DeleteTree(@"Software\Classes\NeuralView.Image");
            foreach (var ext in ImageExts) r.DeleteValue(@"Software\Classes\" + ext + @"\OpenWithProgids", "NeuralView.Image");
            r.DeleteValue(@"Software\RegisteredApplications", "NeuralView");
            r.DeleteTree(@"Software\NeuralSystems\NeuralView");
            r.DeleteIfEmpty(@"Software\NeuralSystems");
        }

        void Verb(Reg r, string baseKey, string name, string label, string exe, string arg)
        {
            string key = baseKey + @"\shell\" + name;
            r.Set(key, "", label);
            r.Set(key, "Icon", Q(exe) + ",0");
            r.Set(key + @"\command", "", Q(exe) + " " + arg);
        }
        void RegisterNavMenu(Reg r)
        {
            string exe = ExePath("NeuralNav");
            Verb(r, @"Software\Classes\Directory", "NeuralNav", "NeuralNav ile aç", exe, "\"%1\"");
            // A drive's "C:\" must stay unquoted: a quote right after the backslash is read as a literal quote.
            Verb(r, @"Software\Classes\Drive", "NeuralNav", "NeuralNav ile aç", exe, "%1");
        }
        void UnregisterNavMenu(Reg r)
        {
            r.DeleteTree(@"Software\Classes\Directory\shell\NeuralNav");
            r.DeleteTree(@"Software\Classes\Drive\shell\NeuralNav");
        }
        void SetNavDefault(Reg r)
        {
            string exe = ExePath("NeuralNav");
            r.Set(@"Software\Classes\Directory\shell", "", "NeuralNav");
            r.Set(@"Software\Classes\Directory\shell\open\command", "", Q(exe) + " \"%1\"");
            r.Set(@"Software\Classes\Drive\shell", "", "NeuralNav");
            r.Set(@"Software\Classes\Drive\shell\open\command", "", Q(exe) + " %1");
            r.Set(@"Software\Classes\Folder\shell", "", "NeuralNav");
            Verb(r, @"Software\Classes\Folder", "NeuralNav", "NeuralNav ile aç", exe, "\"%1\"");
        }
        // Puts Windows Explorer back as the folder handler, touching only what NeuralNav set.
        void UnsetNavDefault(Reg r)
        {
            foreach (var cls in new[] { "Directory", "Drive", "Folder" })
            {
                string shell = @"Software\Classes\" + cls + @"\shell";
                if (r.Get(shell, "") == "NeuralNav") r.DeleteValue(shell, "");
                string open = r.Get(shell + @"\open\command", "");
                if (open != null && open.IndexOf("NeuralNav.exe", StringComparison.OrdinalIgnoreCase) >= 0) r.DeleteTree(shell + @"\open");
            }
            r.DeleteTree(@"Software\Classes\Folder\shell\NeuralNav");
            UnsetWatch(r);
        }
        void UnsetWatch(Reg r)
        {
            string run = @"Software\Microsoft\Windows\CurrentVersion\Run";
            string v = r.Get(run, "NeuralNavWatch");
            if (v != null) r.DeleteValue(run, "NeuralNavWatch");
        }

        void RegisterTerm(Reg r)
        {
            string exe = ExePath("NeuralTerm"), dir = ProgramDir("NeuralTerm");
            foreach (var alias in new[] { "nt.exe", "neuralterm.exe" })
            {
                string k = @"Software\Microsoft\Windows\CurrentVersion\App Paths\" + alias;
                r.Set(k, "", exe);
                r.Set(k, "Path", dir);
            }
            Verb(r, @"Software\Classes\Directory", "NeuralTerm", "NeuralTerm'de aç", exe, "\"%V\"");
            Verb(r, @"Software\Classes\Directory\Background", "NeuralTerm", "NeuralTerm'de aç", exe, "\"%V\"");
            Verb(r, @"Software\Classes\Drive", "NeuralTerm", "NeuralTerm'de aç", exe, "%V");
        }
        void UnregisterTerm(Reg r)
        {
            foreach (var alias in new[] { "nt.exe", "neuralterm.exe" })
            {
                string k = @"Software\Microsoft\Windows\CurrentVersion\App Paths\" + alias;
                string v = r.Get(k, "");
                if (v != null && v.EndsWith("NeuralTerm.exe", StringComparison.OrdinalIgnoreCase)) r.DeleteTree(k);
            }
            r.DeleteTree(@"Software\Classes\Directory\shell\NeuralTerm");
            r.DeleteTree(@"Software\Classes\Directory\Background\shell\NeuralTerm");
            r.DeleteTree(@"Software\Classes\Drive\shell\NeuralTerm");
        }

        void RegisterWeb(Reg r)
        {
            string exe = ExePath("NeuralWeb"), icon = Q(exe) + ",0", open = Q(exe) + " -- \"%1\"";
            string client = @"Software\Clients\StartMenuInternet\NeuralWeb";
            r.Set(client, "", "NeuralWeb");
            r.Set(client + @"\Capabilities", "ApplicationName", "NeuralWeb");
            r.Set(client + @"\Capabilities", "ApplicationDescription", "Neural serisi web tarayıcısı");
            r.Set(client + @"\Capabilities", "ApplicationIcon", icon);
            foreach (var ext in new[] { ".htm", ".html", ".shtml", ".xht", ".xhtml" }) r.Set(client + @"\Capabilities\FileAssociations", ext, "NeuralWebHTML");
            foreach (var scheme in new[] { "http", "https" }) r.Set(client + @"\Capabilities\URLAssociations", scheme, "NeuralWebURL");
            r.Set(client + @"\Capabilities\StartMenu", "StartMenuInternet", "NeuralWeb");
            r.Set(client + @"\DefaultIcon", "", icon);
            r.Set(client + @"\shell\open\command", "", Q(exe));
            r.Set(@"Software\RegisteredApplications", "NeuralWeb", client + @"\Capabilities");
            foreach (var pair in new[] { new[] { "NeuralWebHTML", "NeuralWeb HTML belgesi" }, new[] { "NeuralWebURL", "NeuralWeb bağlantısı" } })
            {
                string p = @"Software\Classes\" + pair[0];
                r.Set(p, "", pair[1]);
                if (pair[0] == "NeuralWebURL") r.Set(p, "URL Protocol", "");
                r.Set(p + @"\DefaultIcon", "", icon);
                r.Set(p + @"\shell\open\command", "", open); // "--" ends switch parsing: a link cannot smuggle in switches
                r.Set(p + @"\Application", "ApplicationName", "NeuralWeb");
                r.Set(p + @"\Application", "ApplicationIcon", icon);
                r.Set(p + @"\Application", "AppUserModelId", WebAumid);
            }
            foreach (var ext in new[] { ".htm", ".html" }) r.SetBinary(@"Software\Classes\" + ext + @"\OpenWithProgids", "NeuralWebHTML");
            string paths = @"Software\Microsoft\Windows\CurrentVersion\App Paths\neuralweb.exe";
            r.Set(paths, "", exe);
            r.Set(paths, "Path", ProgramDir("NeuralWeb"));
        }
        void UnregisterWeb(Reg r)
        {
            r.DeleteTree(@"Software\Clients\StartMenuInternet\NeuralWeb");
            r.DeleteValue(@"Software\RegisteredApplications", "NeuralWeb");
            r.DeleteTree(@"Software\Classes\NeuralWebHTML");
            r.DeleteTree(@"Software\Classes\NeuralWebURL");
            foreach (var ext in new[] { ".htm", ".html" }) r.DeleteValue(@"Software\Classes\" + ext + @"\OpenWithProgids", "NeuralWebHTML");
            string paths = @"Software\Microsoft\Windows\CurrentVersion\App Paths\neuralweb.exe";
            string v = r.Get(paths, "");
            if (v != null && v.EndsWith("NeuralWeb.exe", StringComparison.OrdinalIgnoreCase)) r.DeleteTree(paths);
        }

        // This PC, the user folder, the Recycle Bin and Network on the desktop get the Neural icons.
        static readonly string[][] IconMap = {
            new[] { "{20D04FE0-3AEA-1069-A2D8-08002B30309D}", "", "bu-bilgisayar.ico" },
            new[] { "{59031A47-3F72-44A7-89C5-5595FE6B30EE}", "", "kullanici.ico" },
            new[] { "{645FF040-5081-101B-9F08-00AA002F954E}", "", "geri-donusum-bos.ico" },
            new[] { "{645FF040-5081-101B-9F08-00AA002F954E}", "empty", "geri-donusum-bos.ico" },
            new[] { "{645FF040-5081-101B-9F08-00AA002F954E}", "full", "geri-donusum-dolu.ico" },
            new[] { "{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}", "", "ag.ico" },
        };
        string IconValue(string file)
        {
            string path = Path.Combine(o.Root, "Simgeler", file);
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return path.StartsWith(home + "\\", StringComparison.OrdinalIgnoreCase) ? "%USERPROFILE%" + path.Substring(home.Length) : path;
        }
        void SetIcons(Reg r)
        {
            foreach (var m in IconMap) r.SetExpand(@"Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\" + m[0] + @"\DefaultIcon", m[1], IconValue(m[2]));
        }
        void UnsetIcons(Reg r)
        {
            foreach (var clsid in IconMap.Select(m => m[0]).Distinct())
            {
                string key = @"Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\" + clsid + @"\DefaultIcon";
                string v = r.GetRaw(key, "");
                if (v != null && (v.IndexOf(@"\Simgeler\", StringComparison.OrdinalIgnoreCase) >= 0 || v.IndexOf("NeuralIcons", StringComparison.OrdinalIgnoreCase) >= 0))
                    r.DeleteTree(key);
            }
        }

        void WriteDataShortcuts()
        {
            string dir = Path.Combine(o.Root, "Veriler");
            Directory.CreateDirectory(dir);
            foreach (var a in Apps.All.Where(x => o.Apps.Contains(x.Id)))
            {
                string data = Path.Combine(DataRoot, a.DataDir);
                Directory.CreateDirectory(data);
                ShellLink.Create(Path.Combine(dir, a.DataDir + ".lnk"), data, "", data, null, a.Id + " ayarları ve verileri", null);
            }
        }

        void WriteReadme()
        {
            var sb = new StringBuilder();
            sb.AppendLine("NEURAL SERİSİ");
            sb.AppendLine("=============");
            sb.AppendLine();
            sb.AppendLine("Neural kurulum programı " + Version + " ile kuruldu (" + DateTime.Now.ToString("d MMMM yyyy", new System.Globalization.CultureInfo("tr-TR")) + ").");
            sb.AppendLine();
            sb.AppendLine("Her programın kendi klasörü var; çalışan program Program\\ içindedir.");
            sb.AppendLine("Kaynak kodlarıyla çalışıyorsan onlar aynı klasördeki Kaynak\\ içinde durur.");
            sb.AppendLine();
            foreach (var a in Apps.All) sb.AppendLine(string.Format("  {0,-12} {1} {2}", a.Id + "\\", a.Code, a.Summary));
            sb.AppendLine();
            sb.AppendLine("  Ortak\\Electron   Bütün programların paylaştığı Electron çalışma dosyaları (sabit bağlantılar).");
            sb.AppendLine("  Ortak\\NeuralKaldir.exe   Kaldırıcı (Windows Ayarlar > Uygulamalar listesinde de görünür).");
            sb.AppendLine("  Simgeler\\        Windows simgeleri.");
            sb.AppendLine("  Veriler\\         Programların ayar klasörlerine kısayollar.");
            sb.AppendLine();
            sb.AppendLine("Ayarlar ve kişisel veriler (yer imleri, geçmiş, şifreler, notlar) %APPDATA% altında durur;");
            sb.AppendLine("programı güncellemek ya da yeniden kurmak onlara dokunmaz.");
            sb.AppendLine();
            sb.AppendLine("Program\\ klasörlerini taşıma ya da yeniden adlandırma: Windows'taki kayıtlar bu yolları kullanır.");
            sb.AppendLine("Ayarları değiştirmek için Neural kurulum programını yeniden çalıştırman yeterli.");
            File.WriteAllText(Path.Combine(o.Root, "BENİOKU.txt"), sb.ToString(), new UTF8Encoding(true));
        }

        void WriteManifest()
        {
            // What is in place now, read back from Windows, so programs this run left alone are described correctly too.
            var now = new Options { Root = o.Root, Test = o.Test };
            LoadExisting(now);
            Func<string, bool> has = app => File.Exists(ExePath(app));
            var lines = new List<string> {
                "Surum=" + Version,
                "Tarih=" + DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                "Programlar=" + string.Join(",", Apps.All.Where(a => has(a.Id)).Select(a => a.Id)),
                "Baslat=" + B(o.StartMenu), "NeuralPadAc=" + B(has("NeuralPad") && now.PadOpenWith),
                "NeuralNavMenu=" + B(has("NeuralNav") && now.NavMenu), "NeuralNavVarsayilan=" + B(has("NeuralNav") && now.NavDefault),
                "NeuralNavIzleyici=" + B(has("NeuralNav") && now.NavWatch), "NeuralTermKomut=" + B(has("NeuralTerm") && now.TermCommands),
                "NeuralWebKayit=" + B(has("NeuralWeb") && now.WebRegister), "NeuralViewAc=" + B(has("NeuralView") && now.ViewOpenWith),
                "WindowsSimgeleri=" + B(now.WindowsIcons),
                "Bilinen=" + string.Join(",", Apps.All.Select(a => a.Id)),
            };
            File.WriteAllLines(ManifestPath, lines, new UTF8Encoding(false));
        }
        static string B(bool v) { return v ? "1" : "0"; }

        void WriteUninstallEntry()
        {
            var r = R;
            long kb = 0;
            try { kb = Directory.GetFiles(o.Root, "*.exe", SearchOption.AllDirectories).Where(f => f.IndexOf(@"\Program\", StringComparison.OrdinalIgnoreCase) > 0).Sum(f => new FileInfo(f).Length) / 1024 + 140 * 1024; } catch { }
            r.Set(UninstallKey, "DisplayName", "Neural serisi");
            r.Set(UninstallKey, "DisplayVersion", Version);
            r.Set(UninstallKey, "Publisher", "Neural Systems");
            r.Set(UninstallKey, "InstallLocation", o.Root);
            r.Set(UninstallKey, "DisplayIcon", Q(UninstallerPath) + ",0");
            r.Set(UninstallKey, "UninstallString", Q(UninstallerPath) + (o.Test ? " /kaldir /test" : " /kaldir"));
            r.Set(UninstallKey, "InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            r.SetDword(UninstallKey, "EstimatedSize", (int)Math.Min(int.MaxValue, kb));
            r.SetDword(UninstallKey, "NoModify", 1);
            r.SetDword(UninstallKey, "NoRepair", 1);
        }

        void Notify()
        {
            if (o.Test) return;
            Native.SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
            try
            {
                var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "ie4uinit.exe"), "-show") { CreateNoWindow = true, UseShellExecute = false };
                using (var p = Process.Start(psi)) p.WaitForExit(10000);
            }
            catch { }
        }

        /* ------------------------------------------------------------ uninstall */
        public void Uninstall()
        {
            log("Kaldırılıyor: " + o.Root);
            StopWatcher();
            progress(0.05, "Windows kayıtları geri alınıyor");
            var r = R;
            UnregisterPad(r); UnregisterNavMenu(r); UnsetNavDefault(r); UnregisterTerm(r); UnregisterWeb(r); UnregisterView(r); UnsetIcons(r);
            log(o.NavDefault ? "  Windows kayıtları geri alındı; klasörleri yine Windows Gezgini açar" : "  Windows kayıtları geri alındı");

            progress(0.15, "Kısayollar siliniyor");
            foreach (var dir in new[] { StartMenuDir, PinnedDir })
            {
                if (!Directory.Exists(dir)) continue;
                foreach (var lnk in Directory.GetFiles(dir, "*.lnk"))
                {
                    string t = null;
                    try { t = ShellLink.Target(lnk); } catch { }
                    if (Inside(t)) { File.Delete(lnk); log("  kısayol silindi: " + Path.GetFileName(lnk)); }
                }
            }

            int step = 0;
            foreach (var a in Apps.All)
            {
                step++;
                string appDir = Path.Combine(o.Root, a.Id);
                progress(0.2 + 0.6 * step / Apps.All.Length, a.Id + " siliniyor");
                if (Directory.Exists(ProgramDir(a.Id))) { DeleteDir(ProgramDir(a.Id)); log("  " + a.Id + "\\Program silindi"); }
                RemoveIfEmpty(appDir);
                if (o.RemoveData)
                {
                    string data = Path.Combine(DataRoot, a.DataDir);
                    if (Directory.Exists(data)) { DeleteDir(data); log("  " + a.Id + " verileri silindi"); }
                }
            }
            if (o.RemoveData)
            {
                string series = Path.Combine(DataRoot, "NeuralSeries"); // the series theme, shared by the programs
                if (Directory.Exists(series)) { DeleteDir(series); log("  ortak tema dosyası silindi"); }
            }
            progress(0.85, "Ortak dosyalar siliniyor");
            DeleteDir(RuntimeDir);
            DeleteDir(Path.Combine(o.Root, "Simgeler"));
            DeleteDir(Path.Combine(o.Root, "Veriler"));
            DeleteDir(Path.Combine(o.Root, "_test"));
            foreach (var f in new[] { ManifestPath, Path.Combine(o.Root, "BENİOKU.txt") }) if (File.Exists(f)) File.Delete(f);
            r.DeleteTree(UninstallKey);
            if (o.Test) Registry.CurrentUser.DeleteSubKeyTree(TestPrefix.TrimEnd('\\'), false);
            Notify();
            progress(1, "Kaldırıldı");
            log("Bitti.");
        }

        // The uninstaller is inside the installation; it is deleted a moment after it exits.
        public void ScheduleSelfDelete()
        {
            string self = Process.GetCurrentProcess().MainModule.FileName;
            string ortak = Path.Combine(o.Root, "Ortak");
            string cmd = "/c ping 127.0.0.1 -n 3 >nul & del /f /q " + Q(self) + " & rmdir " + Q(ortak) + " & rmdir " + Q(o.Root);
            if (!Inside(self) && File.Exists(UninstallerPath)) cmd = "/c del /f /q " + Q(UninstallerPath) + " & rmdir " + Q(ortak) + " & rmdir " + Q(o.Root);
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        }

        /* ------------------------------------------------------------ processes */
        public static List<Process> RunningIn(string root)
        {
            var list = new List<Process>();
            string prefix = root.TrimEnd('\\') + "\\";
            int self = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcesses())
            {
                if (p.Id == self) continue;
                string file = null;
                try { file = p.MainModule.FileName; } catch { }
                if (file != null && file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) list.Add(p);
            }
            return list;
        }
        void StopWatcher()
        {
            foreach (var p in RunningIn(o.Root).Where(x => x.ProcessName.Equals("nvwatch", StringComparison.OrdinalIgnoreCase)))
            {
                try { p.Kill(); p.WaitForExit(3000); log("  Gezgin izleyicisi durduruldu"); } catch { }
            }
        }
        void StartWatcher()
        {
            try { Process.Start(new ProcessStartInfo(WatchExe) { UseShellExecute = false }); log("  Gezgin izleyicisi başlatıldı"); } catch { }
        }

        /* ------------------------------------------------------------ helpers */
        static void DeleteDir(string dir)
        {
            if (!Directory.Exists(dir)) return;
            for (int i = 0; ; i++)
            {
                try
                {
                    foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
                    Directory.Delete(dir, true);
                    return;
                }
                catch (IOException) { if (i >= 8) throw; System.Threading.Thread.Sleep(400); }
                catch (UnauthorizedAccessException) { if (i >= 8) throw; System.Threading.Thread.Sleep(400); }
            }
        }
        static void RemoveIfEmpty(string dir)
        {
            try { if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir); } catch { }
        }

        /* ------------------------------------------------------------ what is already there */
        // The folder of an existing installation: the uninstall entry, else the usual place if programs are there.
        public static string ExistingRoot()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                var v = k == null ? null : k.GetValue("InstallLocation") as string;
                if (!string.IsNullOrEmpty(v) && Directory.Exists(v)) return v;
            }
            string usual = DefaultRoot();
            return Apps.All.Any(a => Directory.Exists(Path.Combine(usual, a.Id, "Program"))) ? usual : null;
        }
        // Programs added to the series after the installation was made: not installed, and not in the list of programs
        // its setup knew about (a program the user left out on purpose is in that list).
        static List<string> NewSinceInstall(string root)
        {
            var known = new HashSet<string>(Apps.First);
            try
            {
                string ini = Path.Combine(root, "Ortak", "kurulum.ini");
                if (File.Exists(ini))
                    foreach (var line in File.ReadAllLines(ini))
                        if (line.StartsWith("Bilinen=")) known = new HashSet<string>(line.Substring(8).Split(','));
            }
            catch { }
            return Apps.All.Where(a => !known.Contains(a.Id) && !Directory.Exists(Path.Combine(root, a.Id, "Program"))).Select(a => a.Id).ToList();
        }
        public static string DefaultRoot() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Neural"); }

        // Reads the current state of an installation into the options, so running setup again starts from it.
        public static void LoadExisting(Options o)
        {
            var r = new Reg(o.Test);
            o.Apps.Clear();
            foreach (var a in Apps.All) if (Directory.Exists(Path.Combine(o.Root, a.Id, "Program"))) o.Apps.Add(a.Id);
            if (o.Apps.Count == 0) foreach (var a in Apps.All) o.Apps.Add(a.Id);
            else foreach (var id in NewSinceInstall(o.Root)) o.Apps.Add(id);
            Func<string, string, string, bool> has = (key, name, needle) =>
            {
                string v = r.Get(key, name);
                return v != null && v.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0;
            };
            if (o.Apps.Contains("NeuralPad") && Directory.Exists(Path.Combine(o.Root, "NeuralPad", "Program")))
                o.PadOpenWith = has(@"Software\Classes\NeuralPad.txt\shell\open\command", "", "NeuralPad.exe");
            if (Directory.Exists(Path.Combine(o.Root, "NeuralNav", "Program")))
            {
                o.NavMenu = has(@"Software\Classes\Directory\shell\NeuralNav\command", "", "NeuralNav.exe");
                o.NavDefault = has(@"Software\Classes\Directory\shell\open\command", "", "NeuralNav.exe");
                o.NavWatch = has(@"Software\Microsoft\Windows\CurrentVersion\Run", "NeuralNavWatch", "nvwatch.exe");
            }
            if (Directory.Exists(Path.Combine(o.Root, "NeuralTerm", "Program")))
                o.TermCommands = has(@"Software\Microsoft\Windows\CurrentVersion\App Paths\nt.exe", "", "NeuralTerm.exe");
            if (Directory.Exists(Path.Combine(o.Root, "NeuralWeb", "Program")))
                o.WebRegister = has(@"Software\Clients\StartMenuInternet\NeuralWeb\shell\open\command", "", "NeuralWeb.exe");
            if (Directory.Exists(Path.Combine(o.Root, "NeuralView", "Program")))
                o.ViewOpenWith = has(@"Software\Classes\NeuralView.Image\shell\open\command", "", "NeuralView.exe");
            string icon = r.GetRaw(@"Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\DefaultIcon", "");
            o.WindowsIcons = icon != null && (icon.IndexOf(@"\Simgeler\", StringComparison.OrdinalIgnoreCase) >= 0 || icon.IndexOf("NeuralIcons", StringComparison.OrdinalIgnoreCase) >= 0);
        }
    }

    /* ================================================================ registry (HKCU, or a test key under it) */
    class Reg
    {
        readonly string prefix;
        public Reg(bool test) { prefix = test ? Engine.TestPrefix : ""; }
        RegistryKey Open(string key) { return Registry.CurrentUser.CreateSubKey(prefix + key); }
        public void Set(string key, string name, string value) { using (var k = Open(key)) k.SetValue(name, value, RegistryValueKind.String); }
        public void SetExpand(string key, string name, string value) { using (var k = Open(key)) k.SetValue(name, value, RegistryValueKind.ExpandString); }
        public void SetDword(string key, string name, int value) { using (var k = Open(key)) k.SetValue(name, value, RegistryValueKind.DWord); }
        public void SetNone(string key, string name) { using (var k = Open(key)) k.SetValue(name, new byte[0], RegistryValueKind.None); }
        public void SetBinary(string key, string name) { using (var k = Open(key)) k.SetValue(name, new byte[0], RegistryValueKind.Binary); }
        public string Get(string key, string name)
        {
            using (var k = Registry.CurrentUser.OpenSubKey(prefix + key)) return k == null ? null : k.GetValue(name) as string;
        }
        public string GetRaw(string key, string name)
        {
            using (var k = Registry.CurrentUser.OpenSubKey(prefix + key))
                return k == null ? null : k.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
        }
        public void DeleteValue(string key, string name)
        {
            using (var k = Registry.CurrentUser.OpenSubKey(prefix + key, true)) if (k != null) k.DeleteValue(name, false);
        }
        public void DeleteTree(string key) { Registry.CurrentUser.DeleteSubKeyTree(prefix + key, false); }
        public void DeleteIfEmpty(string key)
        {
            using (var k = Registry.CurrentUser.OpenSubKey(prefix + key))
                if (k == null || k.SubKeyCount > 0 || k.ValueCount > 0) return;
            Registry.CurrentUser.DeleteSubKey(prefix + key, false);
        }
    }

    /* ================================================================ the payload appended to this exe */
    // Layout of the setup exe: [setup program][zip][8-byte zip offset][8-byte "NRLPAKET"].
    class Payload : IDisposable
    {
        const string Magic = "NRLPAKET";
        readonly FileStream file;
        readonly ZipArchive zip;
        public readonly long Offset;
        Payload(FileStream f, long offset)
        {
            file = f; Offset = offset;
            zip = new ZipArchive(new SubStream(f, offset, f.Length - 16 - offset), ZipArchiveMode.Read);
        }
        public static Payload Open()
        {
            string self = Process.GetCurrentProcess().MainModule.FileName;
            var f = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (f.Length < 32) { f.Dispose(); return null; }
            var tail = new byte[16];
            f.Seek(-16, SeekOrigin.End);
            f.Read(tail, 0, 16);
            if (Encoding.ASCII.GetString(tail, 8, 8) != Magic) { f.Dispose(); return null; }
            return new Payload(f, BitConverter.ToInt64(tail, 0));
        }
        static string Norm(string name) { return name.Replace('\\', '/'); }
        public long SizeOf(string prefix)
        {
            return zip.Entries.Where(e => Norm(e.FullName).StartsWith(prefix, StringComparison.OrdinalIgnoreCase)).Sum(e => e.Length);
        }
        public void ExtractFolder(string prefix, string target, Action<double> onProgress)
        {
            var entries = zip.Entries.Where(e => Norm(e.FullName).StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && e.Name.Length > 0).ToList();
            long total = Math.Max(1, entries.Sum(e => e.Length)), done = 0;
            string root = Path.GetFullPath(target) + "\\";
            foreach (var e in entries)
            {
                string dest = Path.GetFullPath(Path.Combine(target, Norm(e.FullName).Substring(prefix.Length).Replace('/', '\\')));
                if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue; // never outside the target
                long before = done;
                lock (zip) Write(e, dest, n => { if (onProgress != null) onProgress((double)(before + n) / total); });
                done += e.Length;
            }
        }
        public void ExtractFile(string name, string dest, Action<double> onProgress)
        {
            var e = zip.Entries.First(x => Norm(x.FullName).Equals(name, StringComparison.OrdinalIgnoreCase));
            lock (zip) Write(e, dest, n => { if (onProgress != null) onProgress((double)n / Math.Max(1, e.Length)); });
        }

        // .NET Framework's ZipArchive does not check CRCs, so a damaged download or a bad read would be installed
        // silently; the CRC recorded in the zip is read from the entry's private field and compared here.
        static readonly System.Reflection.FieldInfo CrcField = typeof(ZipArchiveEntry).GetField("_crc32", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        static readonly uint[] CrcTable = MakeCrcTable();
        static uint[] MakeCrcTable()
        {
            var t = new uint[256];
            for (uint i = 0; i < 256; i++) { uint c = i; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; t[i] = c; }
            return t;
        }

        static void Write(ZipArchiveEntry e, string dest, Action<long> onBytes)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            if (File.Exists(dest)) File.SetAttributes(dest, FileAttributes.Normal);
            uint crc = 0xFFFFFFFFu;
            using (var src = e.Open())
            using (var dst = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20))
            {
                var buf = new byte[1 << 20];
                long n = 0, last = 0;
                int read;
                while ((read = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, read);
                    for (int i = 0; i < read; i++) crc = CrcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >> 8);
                    n += read;
                    if (n - last > (8 << 20)) { last = n; onBytes(n); }
                }
                onBytes(n);
                if (n != e.Length || (CrcField != null && (crc ^ 0xFFFFFFFFu) != (uint)CrcField.GetValue(e)))
                    throw new InvalidDataException("Kurulum paketi bozuk: " + Norm(e.FullName) + ". Kurulum dosyasını yeniden indir.");
            }
            File.SetLastWriteTime(dest, e.LastWriteTime.DateTime);
        }
        // The setup program alone, without the payload: that is the uninstaller.
        public void CopyStub(string dest)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            using (var dst = new FileStream(dest, FileMode.Create, FileAccess.Write))
            {
                file.Seek(0, SeekOrigin.Begin);
                var buf = new byte[1 << 16];
                long left = Offset;
                while (left > 0)
                {
                    int read = file.Read(buf, 0, (int)Math.Min(buf.Length, left));
                    if (read <= 0) break;
                    dst.Write(buf, 0, read);
                    left -= read;
                }
            }
        }
        public void Dispose() { zip.Dispose(); file.Dispose(); }
    }

    // A read-only window onto part of another stream, so the zip reader sees only the payload.
    class SubStream : Stream
    {
        readonly Stream inner; readonly long start, length; long pos;
        public SubStream(Stream s, long start, long length) { inner = s; this.start = start; this.length = length; }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }
        public override long Position { get { return pos; } set { pos = value; } }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (pos >= length) return 0;
            inner.Seek(start + pos, SeekOrigin.Begin);
            int n = inner.Read(buffer, offset, (int)Math.Min(count, length - pos));
            pos += n;
            return n;
        }
        public override long Seek(long offset, SeekOrigin origin)
        {
            pos = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? pos + offset : length + offset;
            return pos;
        }
        public override void Flush() { }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }

    /* ================================================================ Windows APIs */
    static class Native
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CreateHardLink(string newFile, string existingFile, IntPtr security);
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        public static extern void SHChangeNotify(int eventId, uint flags, string item1, string item2);
    }

    // Shortcuts through the shell's own IShellLink, including the AppUserModelID that ties NeuralWeb's windows to it.
    static class ShellLink
    {
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink { }
        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int max, IntPtr findData, uint flags);
            void GetIDList(out IntPtr pidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int max);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int max);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int max);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
            void GetHotkey(out short hotkey);
            void SetHotkey(short hotkey);
            void GetShowCmd(out int cmd);
            void SetShowCmd(int cmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max, out int index);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string rel, uint reserved);
            void Resolve(IntPtr hwnd, uint flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
        }
        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        interface IPropertyStore
        {
            int GetCount(out uint count);
            int GetAt(uint index, out PropertyKey key);
            int GetValue(ref PropertyKey key, out PropVariant value);
            int SetValue(ref PropertyKey key, ref PropVariant value);
            int Commit();
        }
        [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PropertyKey { public Guid fmtid; public uint pid; }
        [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer; }

        public static void Create(string lnk, string target, string args, string workDir, string icon, string description, string aumid)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(lnk));
            var link = (IShellLinkW)new CShellLink();
            try
            {
                link.SetPath(target);
                link.SetArguments(args ?? "");
                if (workDir != null) link.SetWorkingDirectory(workDir);
                if (icon != null) link.SetIconLocation(icon, 0);
                if (description != null) link.SetDescription(description);
                if (aumid != null)
                {
                    var store = (IPropertyStore)link;
                    var key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 }; // PKEY_AppUserModel_ID
                    var value = new PropVariant { vt = 31, pointer = Marshal.StringToCoTaskMemUni(aumid) };
                    try { store.SetValue(ref key, ref value); store.Commit(); } finally { Marshal.FreeCoTaskMem(value.pointer); }
                }
                if (File.Exists(lnk)) File.Delete(lnk);
                ((IPersistFile)link).Save(lnk, true);
            }
            finally { Marshal.ReleaseComObject(link); }
        }
        public static string Target(string lnk)
        {
            var link = (IShellLinkW)new CShellLink();
            try
            {
                ((IPersistFile)link).Load(lnk, 0);
                var sb = new StringBuilder(1024);
                link.GetPath(sb, sb.Capacity, IntPtr.Zero, 0x4); // SLGP_RAWPATH
                return Environment.ExpandEnvironmentVariables(sb.ToString());
            }
            finally { Marshal.ReleaseComObject(link); }
        }
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
        public static string Aumid(string lnk)
        {
            var link = (IShellLinkW)new CShellLink();
            try
            {
                ((IPersistFile)link).Load(lnk, 0);
                var key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
                PropVariant value;
                if (((IPropertyStore)link).GetValue(ref key, out value) != 0) return null;
                try { return value.vt == 31 ? Marshal.PtrToStringUni(value.pointer) : null; } // VT_LPWSTR
                finally { PropVariantClear(ref value); }
            }
            finally { Marshal.ReleaseComObject(link); }
        }
    }

    /* ================================================================ exe icon and version (Windows resource API) */
    static class ResEdit
    {
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
        [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr h);
        delegate bool EnumNameProc(IntPtr h, IntPtr type, IntPtr name, IntPtr param);
        delegate bool EnumLangProc(IntPtr h, IntPtr type, IntPtr name, ushort lang, IntPtr param);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumNameProc cb, IntPtr p);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, IntPtr name, EnumLangProc cb, IntPtr p);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string f, bool del);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool EndUpdateResource(IntPtr h, bool discard);

        static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14, RT_VERSION = (IntPtr)16;
        class Res { public IntPtr Id; public string Str; public ushort Lang; }

        static List<Res> List(string exe, IntPtr type)
        {
            var list = new List<Res>();
            IntPtr h = LoadLibraryEx(exe, IntPtr.Zero, 0x2);
            if (h == IntPtr.Zero) throw new Exception("LoadLibraryEx: " + Marshal.GetLastWin32Error());
            try
            {
                EnumNameProc names = (hh, t, n, p) =>
                {
                    bool isId = ((ulong)n.ToInt64() >> 16) == 0;
                    string s = isId ? null : Marshal.PtrToStringUni(n);
                    IntPtr id = isId ? n : IntPtr.Zero;
                    EnumResourceLanguages(hh, t, n, (h2, t2, n2, lang, p2) => { list.Add(new Res { Id = id, Str = s, Lang = lang }); return true; }, IntPtr.Zero);
                    return true;
                };
                EnumResourceNames(h, type, names, IntPtr.Zero);
                GC.KeepAlive(names);
            }
            finally { FreeLibrary(h); }
            return list;
        }
        static void Del(IntPtr hu, IntPtr type, Res r)
        {
            IntPtr name = r.Str != null ? Marshal.StringToHGlobalUni(r.Str) : r.Id;
            try { if (!UpdateResource(hu, type, name, r.Lang, null, 0)) throw new Exception("silme: " + Marshal.GetLastWin32Error()); }
            finally { if (r.Str != null) Marshal.FreeHGlobal(name); }
        }
        static void Commit(IntPtr hu, bool ok)
        {
            if (!EndUpdateResource(hu, !ok) && ok) throw new Exception("EndUpdateResource: " + Marshal.GetLastWin32Error());
        }

        public static void SetIcon(string exe, string ico)
        {
            byte[] b = File.ReadAllBytes(ico);
            int count = BitConverter.ToUInt16(b, 4);
            var groups = List(exe, RT_GROUP_ICON);
            var icons = List(exe, RT_ICON);
            ushort lang = groups.Count > 0 ? groups[0].Lang : (ushort)1033;
            IntPtr hu = BeginUpdateResource(exe, false);
            if (hu == IntPtr.Zero) throw new Exception("BeginUpdateResource: " + Marshal.GetLastWin32Error());
            bool ok = false;
            try
            {
                foreach (var r in groups) Del(hu, RT_GROUP_ICON, r);
                foreach (var r in icons) Del(hu, RT_ICON, r);
                var grp = new MemoryStream(); var gw = new BinaryWriter(grp);
                gw.Write((ushort)0); gw.Write((ushort)1); gw.Write((ushort)count);
                for (int i = 0; i < count; i++)
                {
                    int e = 6 + 16 * i;
                    int size = BitConverter.ToInt32(b, e + 8), off = BitConverter.ToInt32(b, e + 12);
                    byte[] img = new byte[size]; Array.Copy(b, off, img, 0, size);
                    ushort id = (ushort)(i + 1);
                    if (!UpdateResource(hu, RT_ICON, (IntPtr)id, lang, img, (uint)img.Length)) throw new Exception("simge: " + Marshal.GetLastWin32Error());
                    gw.Write(b, e, 8); gw.Write(size); gw.Write(id);
                }
                byte[] g = grp.ToArray();
                if (!UpdateResource(hu, RT_GROUP_ICON, (IntPtr)1, lang, g, (uint)g.Length)) throw new Exception("simge grubu: " + Marshal.GetLastWin32Error());
                ok = true;
            }
            finally { Commit(hu, ok); }
        }

        static void Pad(BinaryWriter w) { while (w.BaseStream.Position % 4 != 0) w.Write((byte)0); }
        static byte[] Block(string key, byte[] value, ushort valueLength, ushort type, params byte[][] children)
        {
            var ms = new MemoryStream(); var w = new BinaryWriter(ms);
            w.Write((ushort)0); w.Write(valueLength); w.Write(type);
            w.Write(Encoding.Unicode.GetBytes(key)); w.Write((ushort)0);
            Pad(w);
            if (value != null) w.Write(value);
            foreach (var c in children) { Pad(w); w.Write(c); }
            byte[] a = ms.ToArray();
            BitConverter.GetBytes((ushort)a.Length).CopyTo(a, 0);
            return a;
        }
        static byte[] Str(string key, string val) { return Block(key, Encoding.Unicode.GetBytes(val + "\0"), (ushort)(val.Length + 1), 1); }

        public static void SetVersion(string exe, string name, string comments, string version)
        {
            var v = version.Split('.').Select(int.Parse).Concat(new[] { 0, 0, 0, 0 }).Take(4).ToArray();
            string file = Path.GetFileName(exe), ver = string.Join(".", v);
            var fx = new MemoryStream(); var f = new BinaryWriter(fx);
            f.Write(0xFEEF04BDu); f.Write(0x00010000u);
            f.Write((uint)((v[0] << 16) | v[1])); f.Write((uint)((v[2] << 16) | v[3]));
            f.Write((uint)((v[0] << 16) | v[1])); f.Write((uint)((v[2] << 16) | v[3]));
            f.Write(0x3Fu); f.Write(0u); f.Write(0x40004u); f.Write(1u); f.Write(0u); f.Write(0u); f.Write(0u);
            var kv = new[] {
                "CompanyName", "Neural Systems", "FileDescription", name, "FileVersion", ver, "InternalName", file,
                "OriginalFilename", file, "ProductName", name, "ProductVersion", ver, "Comments", comments,
            };
            var strs = new List<byte[]>();
            for (int i = 0; i + 1 < kv.Length; i += 2) strs.Add(Str(kv[i], kv[i + 1]));
            byte[] table = Block("040904B0", null, 0, 1, strs.ToArray());
            byte[] sfi = Block("StringFileInfo", null, 0, 1, table);
            byte[] trans = Block("Translation", new byte[] { 0x09, 0x04, 0xB0, 0x04 }, 4, 0);
            byte[] vfi = Block("VarFileInfo", null, 0, 1, trans);
            byte[] data = Block("VS_VERSION_INFO", fx.ToArray(), 52, 0, sfi, vfi);

            var old = List(exe, RT_VERSION);
            IntPtr hu = BeginUpdateResource(exe, false);
            if (hu == IntPtr.Zero) throw new Exception("BeginUpdateResource: " + Marshal.GetLastWin32Error());
            bool ok = false;
            try
            {
                foreach (var r in old) Del(hu, RT_VERSION, r);
                if (!UpdateResource(hu, RT_VERSION, (IntPtr)1, 1033, data, (uint)data.Length)) throw new Exception("sürüm: " + Marshal.GetLastWin32Error());
                ok = true;
            }
            finally { Commit(hu, ok); }
        }
    }
}
