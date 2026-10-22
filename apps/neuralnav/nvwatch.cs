using System;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Collections.Generic;

// NeuralNav watcher. Runs in the background from sign-in. When a new Windows Explorer window opens on a
// regular folder (desktop double-click, Win+E, "open file location"), it closes that window and opens the
// same place in NeuralNav. Virtual folders (Recycle Bin, Control Panel, ...) stay in Explorer, and so does
// any Explorer window NeuralNav opened on purpose (it leaves a fresh "explorer-allow" marker first).
static class Program {
  const string ThisPc = "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}";
  const string Home = "::{F874310E-B6B7-47DC-BC84-B9E6B38F5903}";

  [STAThread]
  static void Main() {
    bool created;
    using (var mutex = new Mutex(true, @"Local\NeuralNavWatch", out created)) {
      if (!created) return;
      string dir = AppDomain.CurrentDomain.BaseDirectory;
      string nav = Path.GetFullPath(Path.Combine(dir, @"..\..\NeuralNav.exe"));
      string marker = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"NeuralNav\explorer-allow");
      dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));

      var seen = new HashSet<long>(Snapshot(shell).Keys);
      var pending = new Dictionary<long, DateTime>();
      while (true) {
        Thread.Sleep(150);
        if (!File.Exists(nav)) continue;
        Dictionary<long, dynamic> now;
        try { now = Snapshot(shell); } catch { continue; }
        seen.IntersectWith(now.Keys);
        foreach (var pair in now) {
          long hwnd = pair.Key;
          if (seen.Contains(hwnd)) continue;
          if (!pending.ContainsKey(hwnd)) pending[hwnd] = DateTime.UtcNow;
          if (AllowedByNeuralNav(marker)) { seen.Add(hwnd); pending.Remove(hwnd); continue; }
          string target = Target(pair.Value);
          if (target == null) {
            // The view may not be ready yet; give it up to two seconds.
            if ((DateTime.UtcNow - pending[hwnd]).TotalSeconds > 2) { seen.Add(hwnd); pending.Remove(hwnd); }
            continue;
          }
          seen.Add(hwnd);
          pending.Remove(hwnd);
          if (target.Length == 0) continue;
          try { pair.Value.Quit(); } catch { }
          try { Process.Start(new ProcessStartInfo(nav, "\"" + target + "\"") { UseShellExecute = false }); } catch { }
        }
      }
    }
  }

  static Dictionary<long, dynamic> Snapshot(dynamic shell) {
    var map = new Dictionary<long, dynamic>();
    dynamic wins = shell.Windows();
    int count = wins.Count;
    for (int i = 0; i < count; i++) {
      try {
        dynamic w = wins.Item(i);
        if (w == null) continue;
        string exe = Path.GetFileName((string)w.FullName).ToLowerInvariant();
        if (exe != "explorer.exe") continue;
        long hwnd = Convert.ToInt64(w.HWND);
        if (!map.ContainsKey(hwnd)) map[hwnd] = w;
      } catch { }
    }
    return map;
  }

  // null: not known yet; "": leave this window in Explorer; otherwise what to open in NeuralNav.
  static string Target(dynamic w) {
    string path;
    try { path = (string)w.Document.Folder.Self.Path; } catch { return null; }
    if (string.IsNullOrEmpty(path)) return null;
    if (string.Equals(path, ThisPc, StringComparison.OrdinalIgnoreCase) || string.Equals(path, Home, StringComparison.OrdinalIgnoreCase)) return "shell:MyComputerFolder";
    bool fileSystem = (path.Length >= 2 && path[1] == ':') || path.StartsWith(@"\\");
    if (!fileSystem || !Directory.Exists(path)) return "";
    // "Open file location" opens Explorer with one file selected: hand NeuralNav the file so it is selected there too.
    try {
      dynamic selected = w.Document.SelectedItems();
      if (selected != null && selected.Count == 1) {
        string one = (string)selected.Item(0).Path;
        if (File.Exists(one)) return one;
      }
    } catch { }
    return path;
  }

  static bool AllowedByNeuralNav(string marker) {
    try {
      if (!File.Exists(marker)) return false;
      if ((DateTime.UtcNow - File.GetLastWriteTimeUtc(marker)).TotalSeconds > 10) return false;
      File.Delete(marker);
      return true;
    } catch { return false; }
  }
}
