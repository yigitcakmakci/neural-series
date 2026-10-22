param([int]$ProcessId, [string]$Keys)
# Sends real keystrokes, but only when a window of the given process is in front; otherwise does nothing.
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static uint Owner(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }
  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => { if (IsWindowVisible(h) && Owner(h) == pid) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
$ids = @($ProcessId) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" | ForEach-Object { [int]$_.ProcessId })
$fgOwner = [Fg]::Owner([Fg]::GetForegroundWindow())
if ($ids -notcontains [int]$fgOwner) {
  foreach ($id in $ids) {
    $h = [Fg]::Find([uint32]$id)
    if ($h -ne [IntPtr]::Zero) {
      [void][Fg]::SetForegroundWindow($h)
      Start-Sleep -Milliseconds 250
      break
    }
  }
  $fgOwner = [Fg]::Owner([Fg]::GetForegroundWindow())
}
if ($ids -notcontains [int]$fgOwner) { Write-Output "NOT-FOREGROUND"; exit 3 }
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Write-Output "SENT"
