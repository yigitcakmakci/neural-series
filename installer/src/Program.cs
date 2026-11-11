// Entry point of the Neural setup program. The switches are Turkish, like the rest of the user interface.
//   Neural-Setup-x.y.z.exe             wizard (install or update)
//   Neural-Setup-x.y.z.exe /kaldir     uninstall wizard (Ortak\NeuralKaldir.exe always starts in this mode)
// Scripting and tests:
//   /test                              keeps every Windows change under HKCU\Software\NeuralSetupTest and <target>\_test
//   /hedef:<folder>  /sessiz (silent)  /gunluk:<log file>  /veriler (also delete settings and personal data)
//   /uygulamalar:NeuralCalc,NeuralWeb  /secenekler:baslat,pad,navmenu,navvarsayilan,izleyici,nt,web,view,deck,snap,simge,guncelleme
//   /onizle:programlar|windows|secenekler|kurulum|tamam|hata   (with /test: open the wizard on that page)
//   /onizle:siliniyor|kaldirildi                    (with /kaldir /test: the uninstaller's pages)
//   /dil:tr|en                         the language of the setup, written as the series language when installing;
//                                      without it: the series language file, else Windows' display language
//                                      (the uninstaller: the language of the installation, from kurulum.ini)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace NeuralSetup
{
    static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static int Main(string[] argv)
        {
            var args = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var a in argv)
            {
                if (!a.StartsWith("/") && !a.StartsWith("-")) continue;
                string s = a.TrimStart('/', '-');
                int i = s.IndexOf(':');
                args[i < 0 ? s : s.Substring(0, i)] = i < 0 ? "" : s.Substring(i + 1);
            }
            Func<string, string> arg = k => { string v; return args.TryGetValue(k, out v) ? v : null; };

            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            T.Init();

            Payload payload = null;
            try { payload = Payload.Open(); } catch { }
            string self = Process.GetCurrentProcess().MainModule.FileName;
            bool uninstall = arg("kaldir") != null || payload == null;

            var o = new Options { Test = arg("test") != null };
            if (arg("hedef") != null) o.Root = Path.GetFullPath(arg("hedef"));
            else if (payload == null) o.Root = Path.GetDirectoryName(Path.GetDirectoryName(self)); // <root>\Ortak\NeuralKaldir.exe
            else o.Root = Engine.ExistingRoot() ?? Engine.DefaultRoot();

            bool existing = Apps.All.Any(a => Directory.Exists(Path.Combine(o.Root, a.Id, "Program")));
            if (existing) Engine.LoadExisting(o);
            else foreach (var a in Apps.All) o.Apps.Add(a.Id);
            if (arg("uygulamalar") != null)
            {
                o.Apps.Clear();
                foreach (var id in arg("uygulamalar").Split(',')) { var app = Apps.All.FirstOrDefault(x => x.Id.Equals(id.Trim(), StringComparison.OrdinalIgnoreCase)); if (app != null) o.Apps.Add(app.Id); }
            }
            if (arg("secenekler") != null)
            {
                var on = new HashSet<string>(arg("secenekler").Split(',').Select(x => x.Trim().ToLowerInvariant()));
                o.StartMenu = on.Contains("baslat"); o.PadOpenWith = on.Contains("pad"); o.NavMenu = on.Contains("navmenu");
                o.NavDefault = on.Contains("navvarsayilan"); o.NavWatch = on.Contains("izleyici"); o.TermCommands = on.Contains("nt");
                o.WebRegister = on.Contains("web"); o.WindowsIcons = on.Contains("simge"); o.ViewOpenWith = on.Contains("view"); o.DeckAutostart = on.Contains("deck");
                o.SnapAutostart = on.Contains("snap"); o.UpdateCheck = on.Contains("guncelleme");
            }
            o.RemoveData = arg("veriler") != null;
            L.Lang = ChooseLanguage(arg("dil"), o, uninstall);

            if (uninstall && !existing && arg("sessiz") == null)
            {
                MessageBox.Show(payload == null ? L.MsgNoPackage(o.Root) : L.MsgNothingToUninstall, "Neural", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }

            if (arg("sessiz") != null) return Silent(o, payload, uninstall, arg("gunluk"));

            var form = new NeuralForm(880, 680, true);
            var wizard = new Wizard(form, o, payload, uninstall, existing);
            if (arg("onizle") != null && o.Test) form.Shown += delegate { wizard.Preview(arg("onizle")); };
            Application.Run(form);
            return 0;
        }

        // The language of the setup: /dil:, else the series language file (in test mode the one under the test data
        // folder), else Windows' display language. The installation's own language (kurulum.ini) comes first for the
        // uninstaller, so it speaks the language the shortcuts and menus were made in, and last for the setup.
        static string ChooseLanguage(string switchValue, Options o, bool uninstall)
        {
            string chosen = L.Normalize(switchValue);
            if (chosen != null) return chosen;
            string installed = L.FromManifest(Path.Combine(o.Root, "Ortak", "kurulum.ini"));
            string series = L.FromFile(new Engine(o, null, null).LanguageFile);
            return (uninstall ? installed ?? series : series ?? installed) ?? L.FromCulture(CultureInfo.CurrentUICulture);
        }

        // No window: for tests and scripted installs. Exit code 0 on success.
        static int Silent(Options o, Payload payload, bool uninstall, string logFile)
        {
            var lines = new List<string>();
            Action<string> log = s => { lock (lines) lines.Add(DateTime.Now.ToString("HH:mm:ss ") + s); };
            int code = 0;
            try
            {
                var running = Engine.RunningIn(o.Root).Where(p => !Engine.IsBackground(p)).ToList();
                if (running.Count > 0) throw new Exception(L.ErrOpenApps(string.Join(", ", running.Select(p => p.ProcessName).Distinct())));
                var engine = new Engine(o, null, log);
                if (uninstall) { engine.Uninstall(); engine.ScheduleSelfDelete(); }
                else engine.Install(payload);
            }
            catch (Exception ex) { log(L.LogError + ex); code = 2; }
            if (logFile != null) File.WriteAllLines(logFile, lines);
            return code;
        }
    }
}
