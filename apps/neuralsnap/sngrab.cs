// NeuralSnap SN-8 screen grabber (C# 5, .NET Framework 4.x).
//   sngrab.exe                 waits for commands on stdin, one per line, and answers each with one JSON line:
//                                grab <file>   copies the whole virtual screen into <file>
//                                quit          ends it (so does the end of stdin: the program that started it is gone)
//   sngrab.exe --once <file>   one grab, one JSON line, exit
// The file holds raw pixels, top row first, 4 bytes each in R, G, B, A order (A always 255), nothing else: the page
// puts them into a canvas as they are. The answer:
//   {"ok":true,"file":"...","format":"rgba","x":..,"y":..,"w":..,"h":..,
//    "monitors":[{"x":..,"y":..,"w":..,"h":..,"primary":true,"dpi":96}],
//    "windows":[{"x":..,"y":..,"w":..,"h":..,"pid":..}],"ms":..}
//   or {"ok":false,"error":"..."}
// Every coordinate is in physical pixels of the virtual screen (the process is per-monitor DPI aware). "windows" are
// the visible top-level windows in z-order, top first, without minimized, cloaked, tool and click-through windows and
// without the desktop itself; their bounds come from DWM (no invisible resize borders). No titles: they are not needed
// and they are personal.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace NeuralSnap
{
    static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor, rcWork;
            public uint dwFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct BITMAPINFOHEADER
        {
            public int biSize, biWidth, biHeight;
            public short biPlanes, biBitCount;
            public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
        }

        public delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);
        public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr data);

        [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
        [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr data);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

        [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
        [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
        [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER info, uint usage, out IntPtr bits, IntPtr section, uint offset);
        [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll", SetLastError = true)] public static extern bool BitBlt(IntPtr dest, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
        [DllImport("gdi32.dll")] public static extern bool GdiFlush();

        public const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;
        public const uint MONITORINFOF_PRIMARY = 1;
        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80;
        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
        public const uint SRCCOPY = 0x00CC0020, CAPTUREBLT = 0x40000000;
    }

    class Json
    {
        readonly StringBuilder sb = new StringBuilder(4096);
        public Json Raw(string s) { sb.Append(s); return this; }
        public Json Key(string k) { sb.Append('"').Append(k).Append("\":"); return this; }
        public Json Int(long v) { sb.Append(v.ToString(CultureInfo.InvariantCulture)); return this; }
        public Json Bool(bool v) { sb.Append(v ? "true" : "false"); return this; }
        // Plain ASCII out: everything else as \u escapes.
        public Json Str(string s)
        {
            sb.Append('"');
            foreach (char c in s ?? "")
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < 0x20 || c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else sb.Append(c);
            }
            sb.Append('"');
            return this;
        }
        public override string ToString() { return sb.ToString(); }
    }

    class Rect
    {
        public int X, Y, W, H;
        public Rect(int x, int y, int w, int h) { X = x; Y = y; W = w; H = h; }
    }

    class Monitor
    {
        public Rect R;
        public bool Primary;
        public int Dpi;
    }

    class Win
    {
        public Rect R;
        public uint Pid;
    }

    class Grabber
    {
        IntPtr memDC = IntPtr.Zero, bitmap = IntPtr.Zero, bits = IntPtr.Zero;
        int bw, bh;
        int[] pixels = new int[0];
        byte[] bytes = new byte[0];

        // The DIB section and the arrays are kept between grabs of the same size.
        void Prepare(IntPtr screen, int w, int h)
        {
            if (bitmap != IntPtr.Zero && bw == w && bh == h) return;
            Release();
            Native.BITMAPINFOHEADER bi = new Native.BITMAPINFOHEADER();
            bi.biSize = Marshal.SizeOf(typeof(Native.BITMAPINFOHEADER));
            bi.biWidth = w;
            bi.biHeight = -h; // top row first
            bi.biPlanes = 1;
            bi.biBitCount = 32;
            memDC = Native.CreateCompatibleDC(screen);
            bitmap = Native.CreateDIBSection(screen, ref bi, 0, out bits, IntPtr.Zero, 0);
            if (memDC == IntPtr.Zero || bitmap == IntPtr.Zero) { Release(); throw new Exception("CreateDIBSection failed"); }
            Native.SelectObject(memDC, bitmap);
            bw = w;
            bh = h;
            pixels = new int[w * h];
            bytes = new byte[w * h * 4];
        }

        public void Release()
        {
            if (memDC != IntPtr.Zero) Native.DeleteDC(memDC);
            if (bitmap != IntPtr.Zero) Native.DeleteObject(bitmap);
            memDC = bitmap = bits = IntPtr.Zero;
            bw = bh = 0;
        }

        static List<Monitor> Monitors()
        {
            List<Monitor> list = new List<Monitor>();
            Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr m, IntPtr hdc, ref Native.RECT r, IntPtr d)
            {
                Native.MONITORINFO mi = new Native.MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO));
                if (!Native.GetMonitorInfo(m, ref mi)) return true;
                Monitor mon = new Monitor();
                mon.R = new Rect(mi.rcMonitor.Left, mi.rcMonitor.Top, mi.rcMonitor.Right - mi.rcMonitor.Left, mi.rcMonitor.Bottom - mi.rcMonitor.Top);
                mon.Primary = (mi.dwFlags & Native.MONITORINFOF_PRIMARY) != 0;
                mon.Dpi = 96;
                try
                {
                    uint dx, dy;
                    if (Native.GetDpiForMonitor(m, 0, out dx, out dy) == 0 && dx > 0) mon.Dpi = (int)dx;
                }
                catch (Exception) { /* before Windows 8.1 */ }
                list.Add(mon);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        static List<Win> Windows()
        {
            List<Win> list = new List<Win>();
            StringBuilder cls = new StringBuilder(64);
            Native.EnumWindows(delegate(IntPtr hwnd, IntPtr d)
            {
                if (!Native.IsWindowVisible(hwnd) || Native.IsIconic(hwnd)) return true;
                int ex = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE);
                if ((ex & (Native.WS_EX_TOOLWINDOW | Native.WS_EX_TRANSPARENT)) != 0) return true;
                int cloaked;
                if (Native.DwmGetWindowAttribute(hwnd, Native.DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
                // the desktop (it spans every monitor; a click there takes the display instead)
                cls.Length = 0;
                if (Native.GetClassName(hwnd, cls, cls.Capacity) > 0)
                {
                    string c = cls.ToString();
                    if (c == "Progman" || c == "WorkerW") return true;
                }
                Native.RECT r;
                if (Native.DwmGetWindowAttribute(hwnd, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(Native.RECT))) != 0) return true;
                int w = r.Right - r.Left, h = r.Bottom - r.Top;
                if (w <= 1 || h <= 1) return true;
                Win win = new Win();
                win.R = new Rect(r.Left, r.Top, w, h);
                Native.GetWindowThreadProcessId(hwnd, out win.Pid);
                list.Add(win);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        public string Grab(string file)
        {
            Stopwatch sw = Stopwatch.StartNew();
            int x = Native.GetSystemMetrics(Native.SM_XVIRTUALSCREEN);
            int y = Native.GetSystemMetrics(Native.SM_YVIRTUALSCREEN);
            int w = Native.GetSystemMetrics(Native.SM_CXVIRTUALSCREEN);
            int h = Native.GetSystemMetrics(Native.SM_CYVIRTUALSCREEN);
            if (w <= 0 || h <= 0) throw new Exception("no screen");
            // The windows first: the picture is taken right after, so both show the same moment.
            List<Win> windows = Windows();
            IntPtr screen = Native.GetDC(IntPtr.Zero);
            if (screen == IntPtr.Zero) throw new Exception("GetDC failed");
            try
            {
                Prepare(screen, w, h);
                // CAPTUREBLT: layered (transparent) windows are part of the picture too.
                if (!Native.BitBlt(memDC, 0, 0, w, h, screen, x, y, Native.SRCCOPY | Native.CAPTUREBLT))
                    throw new Exception("BitBlt failed (" + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture) + ")");
                Native.GdiFlush();
            }
            finally
            {
                Native.ReleaseDC(IntPtr.Zero, screen);
            }
            // GDI leaves BGRA with an undefined alpha; the page wants RGBA, opaque.
            int n = w * h;
            Marshal.Copy(bits, pixels, 0, n);
            int[] p = pixels;
            for (int i = 0; i < p.Length; i++)
            {
                int v = p[i];
                p[i] = unchecked((int)0xFF000000) | ((v & 0xFF) << 16) | (v & 0xFF00) | ((v >> 16) & 0xFF);
            }
            Buffer.BlockCopy(p, 0, bytes, 0, n * 4);
            using (FileStream fs = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.Read, 4096))
            {
                fs.Write(bytes, 0, n * 4);
            }
            List<Monitor> monitors = Monitors();
            long ms = sw.ElapsedMilliseconds;

            Json j = new Json();
            j.Raw("{").Key("ok").Bool(true).Raw(",").Key("file").Str(file).Raw(",").Key("format").Str("rgba");
            j.Raw(",").Key("x").Int(x).Raw(",").Key("y").Int(y).Raw(",").Key("w").Int(w).Raw(",").Key("h").Int(h);
            j.Raw(",").Key("monitors").Raw("[");
            for (int i = 0; i < monitors.Count; i++)
            {
                Monitor m = monitors[i];
                if (i > 0) j.Raw(",");
                j.Raw("{").Key("x").Int(m.R.X).Raw(",").Key("y").Int(m.R.Y).Raw(",").Key("w").Int(m.R.W).Raw(",").Key("h").Int(m.R.H);
                j.Raw(",").Key("primary").Bool(m.Primary).Raw(",").Key("dpi").Int(m.Dpi).Raw("}");
            }
            j.Raw("],").Key("windows").Raw("[");
            for (int i = 0; i < windows.Count; i++)
            {
                Win v = windows[i];
                if (i > 0) j.Raw(",");
                j.Raw("{").Key("x").Int(v.R.X).Raw(",").Key("y").Int(v.R.Y).Raw(",").Key("w").Int(v.R.W).Raw(",").Key("h").Int(v.R.H);
                j.Raw(",").Key("pid").Int(v.Pid).Raw("}");
            }
            j.Raw("],").Key("ms").Int(ms).Raw("}");
            return j.ToString();
        }
    }

    static class Program
    {
        static StreamWriter output;

        static void Emit(string line)
        {
            try { output.Write(line); output.Write('\n'); output.Flush(); }
            catch (Exception) { Environment.Exit(0); } // nobody reads any more
        }

        static string Error(string message)
        {
            return new Json().Raw("{").Key("ok").Bool(false).Raw(",").Key("error").Str(message).Raw("}").ToString();
        }

        // Physical pixels everywhere: per-monitor (v2) where Windows has it, else the older ways.
        static void DpiAware()
        {
            try { if (Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { /* before Windows 10 1703 */ }
            try { if (Native.SetProcessDpiAwareness(2) == 0) return; } catch (Exception) { /* before Windows 8.1 */ }
            try { Native.SetProcessDPIAware(); } catch (Exception) { /* nothing more to try */ }
        }

        static string Run(Grabber g, string file)
        {
            if (string.IsNullOrEmpty(file)) return Error("no file");
            try { return g.Grab(Path.GetFullPath(file)); }
            catch (Exception e) { return Error(e.Message); }
        }

        static int Main(string[] args)
        {
            DpiAware();
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            Grabber g = new Grabber();
            if (args.Length >= 1 && args[0].ToLowerInvariant() == "--once")
            {
                Emit(Run(g, args.Length >= 2 ? args[1] : ""));
                return 0;
            }
            TextReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = input.ReadLine()) != null)
            {
                string l = line.Trim();
                if (l.Length == 0) continue;
                if (l == "quit") break;
                if (l.StartsWith("grab ", StringComparison.Ordinal)) Emit(Run(g, l.Substring(5).Trim()));
                else Emit(Error("unknown command"));
            }
            g.Release();
            return 0;
        }
    }
}
