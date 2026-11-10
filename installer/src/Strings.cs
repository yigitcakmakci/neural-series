// Every text the setup shows, in Turkish and English: the wizard, the uninstaller, the dialogs, the setup log and the
// names Windows shows for the programs (Start menu shortcuts, context-menu verbs, Default apps, the uninstall entry).
// The Turkish texts are the ones of the earlier releases, word for word; scripts look for "Bitti.", "HATA" and
// "durduruldu" in the Turkish log. Folder names, the uninstaller's file name and the switches stay Turkish.
// C# 5 (the compiler of .NET Framework): no string interpolation, no ?. and no expression-bodied members.
using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace NeuralSetup
{
    static class L
    {
        /* ------------------------------------------------------------ the language */
        public static readonly string[] Ids = { "tr", "en" };
        static string lang = "tr";
        public static string Lang { get { return lang; } set { lang = Normalize(value) ?? "tr"; } }
        public static bool En { get { return lang == "en"; } }
        // Dates, sizes and upper case: tr-TR for Turkish, en-GB for English (as the programs do).
        public static CultureInfo Culture { get { return CultureInfo.GetCultureInfo(En ? "en-GB" : "tr-TR"); } }
        public static string NameOf(string id) { return id == "en" ? "English" : "Türkçe"; }

        public static string Normalize(string id)
        {
            id = (id ?? "").Trim().ToLowerInvariant();
            return Array.IndexOf(Ids, id) >= 0 ? id : null;
        }
        // Windows' display language: Turkish for a Turkish Windows, English for any other.
        public static string FromCulture(CultureInfo c) { return c != null && c.TwoLetterISOLanguageName == "tr" ? "tr" : "en"; }
        // The series language file (%APPDATA%\NeuralSeries\language.json, written by the programs and the setup).
        public static string FromFile(string file)
        {
            try
            {
                if (!File.Exists(file)) return null;
                var m = Regex.Match(File.ReadAllText(file, Encoding.UTF8), "\"language\"\\s*:\\s*\"([A-Za-z]+)\"");
                return m.Success ? Normalize(m.Groups[1].Value) : null;
            }
            catch { return null; }
        }
        // The "Dil=" line of an installation's kurulum.ini: the language it was installed in.
        public static string FromManifest(string ini)
        {
            try
            {
                if (!File.Exists(ini)) return null;
                foreach (var line in File.ReadAllLines(ini)) if (line.StartsWith("Dil=")) return Normalize(line.Substring(4));
            }
            catch { }
            return null;
        }

        static string P(string tr, string en) { return lang == "en" ? en : tr; }
        static string F(string tr, string en, params object[] args) { return string.Format(Culture, P(tr, en), args); }

        /* ------------------------------------------------------------ the programs */
        // The line under each program in the wizard (and in BENİOKU.txt).
        public static string Summary(string app)
        {
            switch (app)
            {
                case "NeuralCalc": return P("Hesap makinesi", "Calculator");
                case "NeuralPad": return P("Not defteri", "Notepad");
                case "NeuralNav": return P("Dosya gezgini", "File explorer");
                case "NeuralTerm": return P("Terminal: PowerShell ve Komut İstemi", "Terminal: PowerShell and Command Prompt");
                case "NeuralWeb": return P("Web tarayıcısı: kalkan ve şifre yöneticisiyle", "Web browser with a shield and a password manager");
                case "NeuralView": return P("Resim görüntüleyici", "Image viewer");
                case "NeuralDeck": return P("Başlatıcı ve komut paleti", "Launcher and command palette");
                case "NeuralPulse": return P("Sistem izleyici: CPU, bellek, disk, ağ, GPU", "System monitor: CPU, memory, disk, network, GPU");
            }
            return app;
        }
        // The name of the Start menu shortcut. Both languages are needed: an update that changes the language
        // removes the shortcut under the other name.
        public static string ShortcutName(string app, string id)
        {
            bool en = id == "en";
            switch (app)
            {
                case "NeuralCalc": return en ? "NeuralCalc Calculator" : "NeuralCalc Hesap Makinesi";
                case "NeuralPad": return en ? "NeuralPad Notepad" : "NeuralPad Not Defteri";
                case "NeuralNav": return en ? "NeuralNav File Explorer" : "NeuralNav Dosya Gezgini";
                case "NeuralTerm": return "NeuralTerm Terminal";
                case "NeuralWeb": return "NeuralWeb";
                case "NeuralView": return en ? "NeuralView Image Viewer" : "NeuralView Resim Görüntüleyici";
                case "NeuralDeck": return en ? "NeuralDeck Command Palette" : "NeuralDeck Komut Paleti";
                case "NeuralPulse": return en ? "NeuralPulse System Monitor" : "NeuralPulse Sistem İzleyici";
            }
            return app;
        }
        // The shortcut's tooltip.
        public static string ShortcutDesc(string app)
        {
            switch (app)
            {
                case "NeuralCalc": return P("NeuralCalc KX-9 cyberpunk hesap makinesi", "NeuralCalc KX-9 cyberpunk calculator");
                case "NeuralPad": return P("NeuralPad NP-7 cyberpunk not defteri", "NeuralPad NP-7 cyberpunk notepad");
                case "NeuralNav": return P("NeuralNav NV-4 cyberpunk dosya gezgini", "NeuralNav NV-4 cyberpunk file explorer");
                case "NeuralTerm": return P("NeuralTerm NT-5 Neural serisi terminal", "NeuralTerm NT-5 Neural Series terminal");
                case "NeuralWeb": return P("NeuralWeb NW-1 Neural serisi web tarayıcısı", "NeuralWeb NW-1 Neural Series web browser");
                case "NeuralView": return P("NeuralView VW-3 cyberpunk resim görüntüleyici", "NeuralView VW-3 cyberpunk image viewer");
                case "NeuralDeck": return P("NeuralDeck DK-0 cyberpunk başlatıcı ve komut paleti", "NeuralDeck DK-0 cyberpunk launcher and command palette");
                case "NeuralPulse": return P("NeuralPulse PL-2 cyberpunk sistem izleyici", "NeuralPulse PL-2 cyberpunk system monitor");
            }
            return app;
        }
        // The exe's version comment; NeuralPad's and NeuralView's also describe them in Open with and Default apps.
        public static string Comments(string app)
        {
            switch (app)
            {
                case "NeuralCalc": return P("NeuralCalc KX-9 hesap makinesi", "NeuralCalc KX-9 calculator");
                case "NeuralPad": return P("NeuralPad NP-7 not defteri", "NeuralPad NP-7 notepad");
                case "NeuralNav": return P("NeuralNav NV-4 dosya gezgini", "NeuralNav NV-4 file explorer");
                case "NeuralTerm": return P("NeuralTerm NT-5 terminal", "NeuralTerm NT-5 terminal");
                case "NeuralWeb": return P("NeuralWeb NW-1 web tarayıcısı", "NeuralWeb NW-1 web browser");
                case "NeuralView": return P("NeuralView VW-3 resim görüntüleyici", "NeuralView VW-3 image viewer");
                case "NeuralDeck": return P("NeuralDeck DK-0 komut paleti", "NeuralDeck DK-0 command palette");
                case "NeuralPulse": return P("NeuralPulse PL-2 sistem izleyici", "NeuralPulse PL-2 system monitor");
            }
            return app;
        }

        /* ------------------------------------------------------------ what Windows shows */
        public static string SeriesName { get { return P("Neural serisi", "Neural Series"); } } // the uninstall entry
        public static string PadFileType { get { return P("Metin Belgesi (NeuralPad)", "Text Document (NeuralPad)"); } }
        public static string ViewFileType { get { return P("Resim (NeuralView)", "Image (NeuralView)"); } }
        public static string NavVerb { get { return P("NeuralNav ile aç", "Open with NeuralNav"); } }
        public static string TermVerb { get { return P("NeuralTerm'de aç", "Open in NeuralTerm"); } }
        public static string WebDescription { get { return P("Neural serisi web tarayıcısı", "Neural Series web browser"); } }
        public static string WebHtmlType { get { return P("NeuralWeb HTML belgesi", "NeuralWeb HTML Document"); } }
        public static string WebUrlType { get { return P("NeuralWeb bağlantısı", "NeuralWeb Link"); } }
        public static string DataShortcutDesc(string app) { return F("{0} ayarları ve verileri", "{0} settings and data", app); }

        // BENİOKU.txt in the installation folder (the file keeps its name, like the folders).
        public static string Readme(string version, string programs)
        {
            var sb = new StringBuilder();
            sb.AppendLine(P("NEURAL SERİSİ", "NEURAL SERIES"));
            sb.AppendLine("=============");
            sb.AppendLine();
            sb.AppendLine(F("Neural kurulum programı {0} ile kuruldu ({1}).", "Installed with the Neural setup {0} ({1}).", version, DateTime.Now.ToString("d MMMM yyyy", Culture)));
            sb.AppendLine();
            sb.AppendLine(P("Her programın kendi klasörü var; çalışan program Program\\ içindedir.", "Each app has its own folder; the app itself runs from Program\\."));
            sb.AppendLine(P("Kaynak kodlarıyla çalışıyorsan onlar aynı klasördeki Kaynak\\ içinde durur.", "If you work with the source code, it sits in Kaynak\\ in the same folder."));
            sb.AppendLine();
            sb.Append(programs);
            sb.AppendLine();
            sb.AppendLine(P("  Ortak\\Electron   Bütün programların paylaştığı Electron çalışma dosyaları (sabit bağlantılar).", "  Ortak\\Electron   The Electron runtime files all the apps share (hard links)."));
            sb.AppendLine(P("  Ortak\\NeuralKaldir.exe   Kaldırıcı (Windows Ayarlar > Uygulamalar listesinde de görünür).", "  Ortak\\NeuralKaldir.exe   The uninstaller (also listed in Windows Settings > Apps)."));
            sb.AppendLine(P("  Simgeler\\        Windows simgeleri.", "  Simgeler\\        Windows icons."));
            sb.AppendLine(P("  Veriler\\         Programların ayar klasörlerine kısayollar.", "  Veriler\\         Shortcuts to the apps' settings folders."));
            sb.AppendLine();
            sb.AppendLine(P("Ayarlar ve kişisel veriler (yer imleri, geçmiş, şifreler, notlar) %APPDATA% altında durur;", "Settings and personal data (bookmarks, history, passwords, notes) live under %APPDATA%;"));
            sb.AppendLine(P("programı güncellemek ya da yeniden kurmak onlara dokunmaz.", "updating or reinstalling the apps does not touch them."));
            sb.AppendLine();
            sb.AppendLine(P("Program\\ klasörlerini taşıma ya da yeniden adlandırma: Windows'taki kayıtlar bu yolları kullanır.", "Do not move or rename the Program\\ folders: the Windows registrations use these paths."));
            sb.AppendLine(P("Ayarları değiştirmek için Neural kurulum programını yeniden çalıştırman yeterli.", "To change the options, just run the Neural setup again."));
            return sb.ToString();
        }

        /* ------------------------------------------------------------ the setup log and the progress line */
        public static string LogInstallFolder(string root) { return P("Kurulum klasörü: ", "Install folder: ") + root; }
        public static string ProgressRuntime { get { return P("Ortak Electron dosyaları açılıyor", "Unpacking the shared Electron files"); } }
        public static string LogRuntime { get { return P("Ortak Electron çalışma dosyaları → Ortak\\Electron", "Shared Electron runtime files → Ortak\\Electron"); } }
        public static string ProgressInstalling(string app) { return F("{0} kuruluyor", "Installing {0}", app); }
        public static string LogLinks(int n) { return F("  ortak dosyalara {0} sabit bağlantı", "  {0} hard links to the shared files", n); }
        public static string ProgressStamping(string app) { return F("{0} simgesi basılıyor", "Setting the {0} icon", app); }
        public static string LogExeReady(string app) { return F("  {0}.exe kendi simgesi ve adıyla hazır", "  {0}.exe ready with its own icon and name", app); }
        public static string ProgressRegistering { get { return P("Windows'a tanıtılıyor", "Registering with Windows"); } }
        public static string ProgressInstalled { get { return P("Kurulum tamamlandı", "Installation complete"); } }
        public static string LogDone { get { return P("Bitti.", "Done."); } }
        public static string LogError { get { return P("HATA: ", "ERROR: "); } }
        public static string LogRegistryTest { get { return P("  Windows kayıtları test anahtarına yazıldı", "  Windows registrations written to the test key"); } }
        public static string LogRegistry { get { return P("  Windows kayıtları güncellendi", "  Windows registrations updated"); } }
        public static string LogStartMenu { get { return P("  Başlat menüsü kısayolları", "  Start menu shortcuts"); } }
        public static string LogPinUpdated(string name) { return P("  görev çubuğu sabitlemesi güncellendi: ", "  taskbar pin updated: ") + name; }
        public static string LogShortcutDeleted(string name) { return P("  kısayol silindi: ", "  shortcut deleted: ") + name; }
        public static string LogLanguage { get { return P("  seri dili: Türkçe", "  series language: English"); } }
        public static string LogLanguageFailed(string why) { return P("  seri dil dosyası yazılamadı: ", "  could not write the series language file: ") + why; }
        public static string LogUpdate(bool on) { return on ? P("  yeni sürüm denetimi: açık", "  new version check: on") : P("  yeni sürüm denetimi: kapalı", "  new version check: off"); }
        public static string LogUpdateFailed(string why) { return P("  güncelleme ayarı yazılamadı: ", "  could not write the update setting: ") + why; }
        public static string LogUninstalling(string root) { return P("Kaldırılıyor: ", "Uninstalling: ") + root; }
        public static string ProgressUnregistering { get { return P("Windows kayıtları geri alınıyor", "Undoing the Windows registrations"); } }
        public static string LogUnregistered { get { return P("  Windows kayıtları geri alındı", "  Windows registrations undone"); } }
        public static string LogUnregisteredNav { get { return P("  Windows kayıtları geri alındı; klasörleri yine Windows Gezgini açar", "  Windows registrations undone; folders open in File Explorer again"); } }
        public static string ProgressShortcuts { get { return P("Kısayollar siliniyor", "Deleting the shortcuts"); } }
        public static string ProgressDeleting(string app) { return F("{0} siliniyor", "Deleting {0}", app); }
        public static string LogProgramDeleted(string app) { return F("  {0}\\Program silindi", "  {0}\\Program deleted", app); }
        public static string LogDataDeleted(string app) { return F("  {0} verileri silindi", "  {0} data deleted", app); }
        public static string LogSeriesDeleted { get { return P("  ortak tema dosyası silindi", "  series theme and language files deleted"); } }
        public static string ProgressShared { get { return P("Ortak dosyalar siliniyor", "Deleting the shared files"); } }
        public static string ProgressUninstalled { get { return P("Kaldırıldı", "Uninstalled"); } }
        public static string LogDeckStopped { get { return P("NeuralDeck durduruldu", "NeuralDeck stopped"); } }
        public static string LogWatcherStopped { get { return P("Gezgin izleyicisi durduruldu", "File Explorer watcher stopped"); } }
        public static string LogDeckStarted { get { return P("  NeuralDeck arka planda başlatıldı", "  NeuralDeck started in the background"); } }
        public static string LogWatcherStarted { get { return P("  Gezgin izleyicisi başlatıldı", "  File Explorer watcher started"); } }

        /* ------------------------------------------------------------ errors */
        public static string ErrOpenApps(string names) { return P("Açık programlar: ", "Apps still open: ") + names; }
        public static string ErrPackageDamaged(string entry) { return F("Kurulum paketi bozuk: {0}. Kurulum dosyasını yeniden indir.", "The setup package is damaged: {0}. Download the setup file again.", entry); }
        public static string ErrResDelete { get { return P("silme: ", "delete: "); } }
        public static string ErrResIcon { get { return P("simge: ", "icon: "); } }
        public static string ErrResIconGroup { get { return P("simge grubu: ", "icon group: "); } }
        public static string ErrResVersion { get { return P("sürüm: ", "version: "); } }
        public static string MsgNoPackage(string root) { return F("Kurulum paketi bulunamadı ve {0} içinde Neural kurulumu yok.", "The setup package is missing and there is no Neural installation in {0}.", root); }
        public static string MsgNothingToUninstall { get { return P("Kaldırılacak bir Neural kurulumu bulunamadı.", "No Neural installation was found to uninstall."); } }

        /* ------------------------------------------------------------ the window */
        public static string WindowSetup { get { return P("Neural serisi kurulumu", "Neural Series setup"); } }
        public static string WindowUninstall { get { return P("Neural serisini kaldır", "Uninstall the Neural Series"); } }
        public static string WindowDefault { get { return P("Neural Kurulum", "Neural Setup"); } }
        public static string BandSetup { get { return P("NEURAL KURULUM", "NEURAL SETUP"); } }
        public static string BandUninstall { get { return P("NEURAL KALDIRMA", "NEURAL UNINSTALL"); } }
        public static string[] InstallSteps { get { return En ? new[] { "Welcome", "Apps", "Windows", "Install", "Done" } : new[] { "Hoş geldin", "Programlar", "Windows", "Kurulum", "Tamam" }; } }
        public static string[] UninstallSteps { get { return En ? new[] { "Uninstall", "Removing", "Done" } : new[] { "Kaldır", "Siliniyor", "Tamam" }; } }
        public static string SideNote { get { return P("Yalnızca senin Windows hesabına kurulur; yönetici izni gerekmez.", "For your Windows account only; no admin rights needed."); } }
        public static string SideVersion { get { return P("SÜRÜM ", "VERSION "); } }
        public static string Back { get { return P("‹  Geri", "‹  Back"); } }
        public static string Next { get { return P("İleri  ›", "Next  ›"); } }
        public static string Change { get { return P("Değiştir…", "Change…"); } }

        /* ------------------------------------------------------------ dialogs */
        public static string Ok { get { return P("Tamam", "OK"); } }
        public static string Cancel { get { return P("Vazgeç", "Cancel"); } }
        public static string DlgDataTitle { get { return P("VERİLER SİLİNECEK", "DATA WILL BE DELETED"); } }
        public static string DlgDataText { get { return P("Yer imlerin, geçmişin, kayıtlı şifrelerin, notların ve bütün ayarların kalıcı olarak silinecek. Bu geri alınamaz.\n\nDevam edilsin mi?", "Your bookmarks, history, saved passwords, notes and all settings will be deleted for good. This cannot be undone.\n\nContinue?"); } }
        public static string DlgDataYes { get { return P("Verileri de sil", "Delete data too"); } }
        public static string DlgWaitTitle { get { return P("BEKLE", "PLEASE WAIT"); } }
        public static string DlgWaitText { get { return P("İşlem sürüyor; yarıda kesilirse programlar eksik kalır. Bitmesine birkaç saniye kaldı.", "The work is in progress; stopping it halfway would leave the apps incomplete. It will be done in a few seconds."); } }
        public static string DlgExitTitle { get { return P("ÇIKIŞ", "EXIT"); } }
        public static string DlgExitUninstall { get { return P("Neural serisi kaldırılmadan çıkılsın mı?", "Exit without uninstalling the Neural Series?"); } }
        public static string DlgExitSetup { get { return P("Kurulum yapılmadan çıkılsın mı?", "Exit without installing?"); } }
        public static string DlgExitYes { get { return P("Çık", "Exit"); } }
        public static string DlgAppsTitle { get { return P("PROGRAM SEÇ", "CHOOSE APPS"); } }
        public static string DlgAppsText { get { return P("Kurmak için en az bir program seç.", "Choose at least one app to install."); } }
        public static string DlgFolderTitle { get { return P("KLASÖR", "FOLDER"); } }
        public static string DlgFolderInvalid(string user) { return F("Geçerli bir kurulum klasörü seç (ör. C:\\Users\\{0}\\Neural).", "Choose a valid install folder (e.g. C:\\Users\\{0}\\Neural).", user); }
        public static string DlgFolderReadOnly { get { return P("Bu klasöre yazılamıyor. Yönetici izni gerektirmeyen bir yer seç; kişisel klasörün en güvenli seçenek.", "This folder cannot be written to. Choose a place that needs no administrator rights; your user folder is the safest choice."); } }
        public static string DlgDiskTitle { get { return P("DİSK ALANI", "DISK SPACE"); } }
        public static string DlgDiskText(string need, string drive, string free) { return F("Kurulum için yaklaşık {0} gerekiyor, {1} sürücüsünde {2} boş.\n\nYine de devam edilsin mi?", "The installation needs about {0}; drive {1} has {2} free.\n\nContinue anyway?", need, drive, free); }
        public static string DlgDiskYes { get { return P("Devam et", "Continue"); } }
        public static string DlgRunningTitle { get { return P("AÇIK PROGRAMLAR", "OPEN APPS"); } }
        public static string DlgRunningText(string names) { return F("Devam etmeden önce şunları kapat: {0}.\n\n\"Benim yerime kapat\" pencerelerine kapatma isteği gönderir; kaydedilmemiş bir şey varsa program sorar.", "Close these before going on: {0}.\n\n\"Close them for me\" asks their windows to close; an app with unsaved work asks you first.", names); }
        public static string DlgRunningRetry { get { return P("Yeniden dene", "Try again"); } }
        public static string DlgRunningClose { get { return P("Benim yerime kapat", "Close them for me"); } }
        public static string StatusClosing { get { return P("Programlar kapatılıyor…", "Closing the apps…"); } }

        /* ------------------------------------------------------------ welcome */
        public static string StatusPackage(string size, string version) { return F("Paket: {0} · Neural serisi {1}", "Package: {0} · Neural Series {1}", size, version); }
        public static string WelcomeTitle { get { return P("Neural serisine hoş geldin", "Welcome to the Neural Series"); } }
        public static string WelcomeLead { get { return P("Bu sihirbaz Neural serisinin sekiz programını bilgisayarına kurar. Hepsi aynı Neural tasarımını ve tek bir ortak Electron çalışma klasörünü paylaşır.", "This wizard installs the eight apps of the Neural Series on your computer. They all share the same Neural design and a single Electron runtime folder."); } }
        public static string WelcomeExisting(string root) { return F("Bilgisayarında bir Neural kurulumu var: {0}\nKurulum onu güncelleyecek. Ayarların, yer imlerin, şifrelerin ve notların olduğu gibi kalır.", "There is a Neural installation on this computer: {0}\nThe setup will update it. Your settings, bookmarks, passwords and notes stay as they are.", root); }
        public static string WelcomeNote { get { return P("Ayarlar ve kişisel veriler programlardan ayrı tutulur; güncelleme ya da yeniden kurulum onlara dokunmaz.", "Settings and personal data are kept apart from the apps; updating or reinstalling never touches them."); } }
        public static string WelcomeStart { get { return P("Başla  ›", "Start  ›"); } }
        public static string LanguageChoice { get { return P("Dil · Language", "Language · Dil"); } } // the accessible name of the language buttons

        /* ------------------------------------------------------------ programs and location */
        public static string AppsTitle { get { return P("Programlar ve konum", "Apps and location"); } }
        public static string AppsLead { get { return P("Kurulacak programları ve kurulum klasörünü seç. Seçmediğin programlar bilgisayarında zaten kuruluysa oldukları gibi kalır.", "Choose the apps to install and the install folder. Apps you leave unchecked stay as they are if they are already installed."); } }
        public static string AppsFolder { get { return P("Kurulum klasörü", "Install folder"); } }
        public static string AppsBrowse { get { return P("Neural programlarının kurulacağı yeri seç. Seçtiğin klasörün içinde bir Neural klasörü açılır.", "Choose where to install the Neural apps. A Neural folder is created inside the folder you choose."); } }
        public static string AppsNote { get { return P("Programlar ortak Electron dosyalarını sabit bağlantıyla paylaşır; aynı dosyalar diskte bir kez durur.", "The apps share the Electron runtime files through hard links, so those files are on the disk only once."); } }
        public static string StatusNeed(string need, string free) { return free == null ? F("Gereken alan ≈ {0}", "Space needed ≈ {0}", need) : F("Gereken alan ≈ {0} · boş: {1}", "Space needed ≈ {0} · free: {1}", need, free); }

        /* ------------------------------------------------------------ Windows */
        public static string Install { get { return P("Kur", "Install"); } }
        public static string Update { get { return P("Güncelle", "Update"); } }
        public static string WinStatus { get { return P("Sonradan kurulumla değiştirebilirsin.", "You can change these later with the setup."); } }
        public static string WinTitle { get { return P("Windows ile bağlantılar", "Windows integration"); } }
        public static string WinLead { get { return P("Hangi Windows özelliklerinin Neural programlarını kullanacağını seç. Kutuyu kaldırırsan o bağlantı geri alınır.", "Choose which Windows features use the Neural apps. Unchecking a box undoes that link."); } }
        public static string OptStart { get { return P("Başlat menüsü kısayolları", "Start menu shortcuts"); } }
        public static string OptStartSub { get { return P("Programlar Başlat menüsünde ve Windows aramasında görünür.", "The apps appear in Start and in Windows search."); } }
        public static string OptWeb { get { return P("NeuralWeb'i tarayıcı olarak tanıt", "Register NeuralWeb as a browser"); } }
        public static string OptWebSub { get { return P("Varsayılan tarayıcıyı yine sen Windows Ayarlar'dan seçersin.", "You still choose the default browser in Windows Settings."); } }
        public static string OptPad { get { return P("NeuralPad: .txt için \"Birlikte aç\"", "NeuralPad in \"Open with\""); } }
        public static string OptPadSub { get { return P("Varsayılan not defterin değişmez.", "For .txt files; your default text editor does not change."); } }
        public static string OptView { get { return P("NeuralView: resimler için \"Birlikte aç\"", "NeuralView in \"Open with\""); } }
        public static string OptViewSub { get { return P("Ayarlar'daki Varsayılan uygulamalar listesine de girer; varsayılanı sen seçersin.", "For images; also listed under Default apps in Settings, where you choose."); } }
        public static string OptTerm { get { return P("NeuralTerm: nt komutu ve sağ tık", "NeuralTerm: nt and right-click"); } }
        public static string OptTermSub { get { return P("Win+R'de nt; klasörlerde \"NeuralTerm'de aç\".", "nt in Win+R; \"Open in NeuralTerm\" on folders."); } }
        public static string OptNavMenu { get { return P("NeuralNav: \"NeuralNav ile aç\"", "NeuralNav in the folder menu"); } }
        public static string OptNavMenuSub { get { return P("Klasörlerin ve sürücülerin sağ tık menüsüne eklenir.", "Added to the right-click menu of folders and drives."); } }
        public static string OptNavDefault { get { return P("NeuralNav varsayılan klasör açıcı", "NeuralNav opens folders"); } }
        public static string OptNavDefaultSub { get { return P("Klasörlere çift tıklayınca NeuralNav açılır. Kaldırınca Windows Gezgini geri gelir.", "Double-clicking a folder opens NeuralNav. Uninstalling brings File Explorer back."); } }
        public static string OptNavWatch { get { return P("Gezgin pencerelerini yakala", "Catch File Explorer windows"); } }
        public static string OptNavWatchSub { get { return P("Küçük bir izleyici, Win+E dahil açılan Gezgin pencerelerini NeuralNav'a çevirir.", "A small watcher hands File Explorer windows, Win+E included, to NeuralNav."); } }
        public static string OptIcons { get { return P("Windows simgelerini değiştir", "Change Windows icons"); } }
        public static string OptIconsSub { get { return P("Bu Bilgisayar, Geri Dönüşüm Kutusu, Ağ ve kullanıcı klasörü Neural simgelerini alır.", "This PC, Recycle Bin, Network and the user folder get the Neural icons."); } }
        public static string OptDeck { get { return P("NeuralDeck: açılışta başlat", "NeuralDeck: start with Windows"); } }
        public static string OptDeckSub { get { return P("Windows açılınca başlar; Alt+Space ile açılan komut paleti arka planda bekler.", "Starts with Windows and waits in the background for Alt+Space."); } }
        public static string OptUpdate { get { return P("Yeni sürümleri denetle", "Check for new versions"); } }
        public static string OptUpdateSub { get { return P("Günde en fazla bir kez GitHub'a sorar; yeni sürüm çıkınca bildirir.", "Asks GitHub at most once a day; tells you when a new version is out."); } }

        /* ------------------------------------------------------------ working */
        public static string Installing { get { return P("Kuruluyor…", "Installing…"); } }
        public static string Removing { get { return P("Siliniyor…", "Removing…"); } }
        public static string WorkTitleInstall { get { return P("Kuruluyor", "Installing"); } }
        public static string WorkTitleUpdate { get { return P("Güncelleniyor", "Updating"); } }
        public static string WorkTitleUninstall { get { return P("Kaldırılıyor", "Uninstalling"); } }
        public static string WorkLeadInstall { get { return P("Dosyalar açılıyor, her programa kendi simgesi basılıyor ve Windows'a tanıtılıyor. Bu bir iki dakika sürebilir.", "Unpacking the files, giving each app its own icon and registering it with Windows. This can take a minute or two."); } }
        public static string WorkLeadUninstall { get { return P("Programlar, kısayollar ve Windows bağlantıları kaldırılıyor.", "Removing the apps, the shortcuts and the Windows integration."); } }

        /* ------------------------------------------------------------ done, failed */
        public static string Finish { get { return P("Bitir", "Finish"); } }
        public static string Close { get { return P("Kapat", "Close"); } }
        public static string DoneTitleInstall { get { return P("Kurulum tamamlandı", "Installation complete"); } }
        public static string DoneTitleUpdate { get { return P("Güncelleme tamamlandı", "Update complete"); } }
        public static string DoneLead(string root) { return F("Neural serisi hazır. Programlar Başlat menüsünde; hepsi {0} klasöründe.", "The Neural Series is ready. The apps are in the Start menu, and all of them in {0}.", root); }
        public static string DoneOpenWeb { get { return P("NeuralWeb'i şimdi aç", "Open NeuralWeb now"); } }
        public static string DoneOpenWebSub { get { return P("Bitir'e basınca tarayıcı açılır.", "The browser opens when you press Finish."); } }
        public static string DoneDefaultBrowser { get { return P("Varsayılan tarayıcıyı seç…", "Choose the default browser…"); } }
        public static string DoneDefaultPictures { get { return P("Varsayılan resim uygulaması yap…", "Make it the default picture app…"); } }
        public static string DoneDefaultsNote(bool several)
        {
            return several ? P("Windows varsayılan uygulamayı yalnızca senin seçmene izin verir; her düğme Ayarlar'da o programın sayfasını açar.", "Windows lets only you choose a default app; each button opens that app's page in Settings.")
                : P("Windows varsayılan uygulamayı yalnızca senin seçmene izin verir; düğme Ayarlar'da o programın sayfasını açar.", "Windows lets only you choose a default app; the button opens that app's page in Settings.");
        }
        public static string DoneNote { get { return P("Seçenekleri değiştirmek için kurulumu yeniden çalıştırman yeterli. Kaldırmak için: Windows Ayarlar › Uygulamalar › Neural serisi.", "To change the options, just run the setup again. To uninstall: Windows Settings › Apps › Neural Series."); } }
        public static string DoneLog(string path) { return P("Kurulum günlüğü: ", "Setup log: ") + path; }
        public static string FailTitle { get { return P("İşlem tamamlanamadı", "The operation could not be completed"); } }
        public static string FailNote(string path) { return F("Ayrıntılar kurulum günlüğünde: {0}. Kurulumu yeniden çalıştırmak yarım kalan işi tamamlar.", "The details are in the setup log: {0}. Running the setup again completes the unfinished work.", path); }

        /* ------------------------------------------------------------ uninstall */
        public static string UninstallButton { get { return P("Kaldır", "Uninstall"); } }
        public static string UninstallTitle { get { return P("Neural serisini kaldır", "Uninstall the Neural Series"); } }
        public static string UninstallLead(string programs, bool navDefault)
        {
            return F("Şunlar silinecek: {0}, ortak Electron dosyaları, Başlat menüsü kısayolları ve Windows bağlantıları.", "This deletes {0}, the shared Electron files, the Start menu shortcuts and the Windows integration.", programs ?? P("Neural programları", "the Neural apps"))
                + (navDefault ? P(" Klasörleri yine Windows Gezgini açacak.", " Folders will open in File Explorer again.") : "");
        }
        public static string UninstallData { get { return P("Ayarlarımı ve kişisel verilerimi de sil", "Also delete my settings and personal data"); } }
        public static string UninstallDataSub { get { return P("Yer imleri, geçmiş, kayıtlı şifreler, notlar ve bütün program ayarları. Bu geri alınamaz.", "Bookmarks, history, saved passwords, notes and all app settings. This cannot be undone."); } }
        public static string UninstallNote { get { return P("Kaynak kodlarla çalışıyorsan programların Kaynak klasörlerine dokunulmaz.", "If you work with the source code, the apps' Kaynak folders are left alone."); } }
        public static string UDoneTitle { get { return P("Neural serisi kaldırıldı", "The Neural Series has been removed"); } }
        public static string UDoneLeadData { get { return P("Programlar ve bütün verileri silindi.", "The apps and all their data have been deleted."); } }
        public static string UDoneLead { get { return P("Programlar silindi. Ayarların ve kişisel verilerin duruyor; Neural serisini yeniden kurarsan kaldığın yerden devam eder.", "The apps have been deleted. Your settings and personal data are still there; if you install the Neural Series again, you carry on where you left off."); } }
        public static string UDoneNote { get { return P("Görev çubuğuna sabitlediğin simgeler varsa Windows onları bir sonraki oturumda temizler.", "If you pinned any of the apps to the taskbar, Windows clears those icons at your next sign-in."); } }

        /* ------------------------------------------------------------ previews (test mode) */
        public static string SampleError { get { return P("Örnek hata: dosya kullanımda.", "Sample error: the file is in use."); } }
    }
}
