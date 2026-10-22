using System;
using System.IO;
using System.Text;
using System.Collections.Specialized;
using System.Globalization;
using System.Windows.Forms;

// NeuralNav helper. Reads one request per line on stdin ("id<TAB>command<TAB>args...") and answers
// with one line on stdout ("id<TAB>json"). It supplies what Node cannot see on Windows: file attributes
// (hidden/system), volume labels, and the shell's file clipboard, so copy/cut work with Windows Explorer.
static class Program {
  static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

  [STAThread]
  static int Main() {
    var utf8 = new UTF8Encoding(false);
    var input = new StreamReader(Console.OpenStandardInput(), utf8);
    var output = new StreamWriter(Console.OpenStandardOutput(), utf8);
    string line;
    while ((line = input.ReadLine()) != null) {
      if (line.Length == 0) continue;
      string[] p = line.Split('\t');
      string reply;
      try { reply = Handle(p); }
      catch (UnauthorizedAccessException e) { reply = Err("EACCES", e.Message); }
      catch (DirectoryNotFoundException e) { reply = Err("ENOENT", e.Message); }
      catch (FileNotFoundException e) { reply = Err("ENOENT", e.Message); }
      catch (Exception e) { reply = Err("EIO", e.Message); }
      output.Write(p[0]);
      output.Write('\t');
      output.Write(reply);
      output.Write('\n');
      output.Flush();
    }
    return 0;
  }

  static string Handle(string[] p) {
    string cmd = p.Length > 1 ? p[1] : "";
    switch (cmd) {
      case "ping": return "\"pong\"";
      case "list": return List(p[2]);
      case "drives": return Drives();
      case "attrs": return ((int)File.GetAttributes(p[2])).ToString(CultureInfo.InvariantCulture);
      case "clip-get": return ClipGet();
      case "clip-set": return ClipSet(p);
      case "clip-clear": Clipboard.Clear(); return "true";
      default: throw new ArgumentException("unknown command: " + cmd);
    }
  }

  static string List(string dir) {
    var sb = new StringBuilder("[");
    bool first = true;
    foreach (FileSystemInfo fi in new DirectoryInfo(dir).EnumerateFileSystemInfos()) {
      int a = 0; long size = 0, m = 0, c = 0;
      try { a = (int)fi.Attributes; } catch { }
      bool isDir = (a & (int)FileAttributes.Directory) != 0;
      try { if (!isDir) size = ((FileInfo)fi).Length; } catch { }
      try { m = Ms(fi.LastWriteTimeUtc); } catch { }
      try { c = Ms(fi.CreationTimeUtc); } catch { }
      if (!first) sb.Append(',');
      first = false;
      sb.Append("{\"n\":").Append(Q(fi.Name))
        .Append(",\"d\":").Append(isDir ? '1' : '0')
        .Append(",\"s\":").Append(size.ToString(CultureInfo.InvariantCulture))
        .Append(",\"m\":").Append(m.ToString(CultureInfo.InvariantCulture))
        .Append(",\"c\":").Append(c.ToString(CultureInfo.InvariantCulture))
        .Append(",\"a\":").Append(a.ToString(CultureInfo.InvariantCulture))
        .Append('}');
    }
    return sb.Append(']').ToString();
  }

  static string Drives() {
    var sb = new StringBuilder("[");
    bool first = true;
    foreach (DriveInfo d in DriveInfo.GetDrives()) {
      string label = "", format = "";
      long total = 0, free = 0;
      bool ready = false;
      try { ready = d.IsReady; } catch { }
      if (ready) {
        try { label = d.VolumeLabel; } catch { }
        try { format = d.DriveFormat; } catch { }
        try { total = d.TotalSize; free = d.AvailableFreeSpace; } catch { }
      }
      if (!first) sb.Append(',');
      first = false;
      sb.Append("{\"root\":").Append(Q(d.Name))
        .Append(",\"type\":").Append(Q(d.DriveType.ToString()))
        .Append(",\"label\":").Append(Q(label))
        .Append(",\"format\":").Append(Q(format))
        .Append(",\"total\":").Append(total.ToString(CultureInfo.InvariantCulture))
        .Append(",\"free\":").Append(free.ToString(CultureInfo.InvariantCulture))
        .Append(",\"ready\":").Append(ready ? "true" : "false")
        .Append('}');
    }
    return sb.Append(']').ToString();
  }

  static string ClipGet() {
    if (!Clipboard.ContainsFileDropList()) return "{\"op\":null,\"paths\":[]}";
    StringCollection files = Clipboard.GetFileDropList();
    string op = "copy";
    var effect = Clipboard.GetData("Preferred DropEffect") as MemoryStream;
    if (effect != null && effect.Length >= 4) {
      var b = new byte[4];
      effect.Position = 0;
      effect.Read(b, 0, 4);
      if ((BitConverter.ToInt32(b, 0) & 2) != 0) op = "move";
    }
    var sb = new StringBuilder("{\"op\":").Append(Q(op)).Append(",\"paths\":[");
    for (int i = 0; i < files.Count; i++) {
      if (i > 0) sb.Append(',');
      sb.Append(Q(files[i]));
    }
    return sb.Append("]}").ToString();
  }

  // Explorer marks cut files with DROPEFFECT_MOVE (2) and copied files with COPY | LINK (5).
  static string ClipSet(string[] p) {
    var files = new StringCollection();
    for (int i = 3; i < p.Length; i++) if (p[i].Length > 0) files.Add(p[i]);
    var data = new DataObject();
    data.SetFileDropList(files);
    data.SetData("Preferred DropEffect", new MemoryStream(BitConverter.GetBytes(p[2] == "move" ? 2 : 5)));
    Clipboard.SetDataObject(data, true, 10, 100);
    return "true";
  }

  static long Ms(DateTime utc) { return (long)(utc - Epoch).TotalMilliseconds; }

  static string Err(string code, string message) {
    return "{\"error\":" + Q(message) + ",\"code\":" + Q(code) + "}";
  }

  static string Q(string s) {
    if (s == null) return "null";
    var sb = new StringBuilder("\"");
    foreach (char ch in s) {
      switch (ch) {
        case '"': sb.Append("\\\""); break;
        case '\\': sb.Append("\\\\"); break;
        case '\n': sb.Append("\\n"); break;
        case '\r': sb.Append("\\r"); break;
        case '\t': sb.Append("\\t"); break;
        default:
          if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
          else sb.Append(ch);
          break;
      }
    }
    return sb.Append('"').ToString();
  }
}
