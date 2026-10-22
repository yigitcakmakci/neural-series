param([string]$ProcessName, [string]$Out)
# Finds the visible titled window of the given process and renders it with PrintWindow (works for transparent Electron windows).
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Snap {
  public delegate bool Cb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Cb cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static List<IntPtr> Find(HashSet<uint> pids) {
    var o = new List<IntPtr>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid);
      if (pids.Contains(pid) && IsWindowVisible(h)) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.Length > 0 && sb.ToString() != "Default IME" && sb.ToString() != "MSCTFIME UI") o.Add(h); }
      return true; }, IntPtr.Zero);
    return o;
  }
}
"@
[Snap]::SetProcessDPIAware() | Out-Null
$set = New-Object 'System.Collections.Generic.HashSet[uint32]'
Get-Process $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { [void]$set.Add([uint32]$_.Id) }
$wins = [Snap]::Find($set)
if (-not $wins.Count) { "no window"; exit 1 }
$h = $wins[0]
$sb = New-Object System.Text.StringBuilder 256; [Snap]::GetWindowText($h, $sb, 256) | Out-Null
$r = New-Object Snap+RECT; [Snap]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
"window: '$($sb.ToString())'  rect: $($r.L),$($r.T)  size: ${w}x${hh}  count: $($wins.Count)"
$bmp = New-Object System.Drawing.Bitmap $w, $hh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
[Snap]::PrintWindow($h, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"saved $Out"
