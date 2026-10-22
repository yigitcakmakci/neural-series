param([string]$Parent, [string]$Name)
# Opens $Parent in a Windows Explorer window, "double-clicks" $Name there (its default action, run by explorer.exe)
# and reports who answered. Closes the Explorer window it opened.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$sh = New-Object -ComObject Shell.Application
$before = @($sh.Windows() | ForEach-Object { $_.HWND })
Start-Process explorer.exe -ArgumentList "`"$Parent`""
$win = $null
for ($i = 0; $i -lt 40 -and -not $win; $i++) { Start-Sleep -Milliseconds 250; $win = $sh.Windows() | Where-Object { $before -notcontains $_.HWND } | Select-Object -First 1 }
$navCount = (Get-Process NeuralNav -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle }).Count
if (-not $win) { "explorer.exe did not open a window (NeuralNav windows: $navCount)"; exit 1 }
"explorer.exe opened a Windows Explorer window on: $($win.LocationName)"
Start-Sleep -Seconds 1
$el = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$win.HWND)
$cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), $Name
$item = $null
for ($i = 0; $i -lt 20 -and -not $item; $i++) {
  $item = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem } | Select-Object -First 1
  if (-not $item) { Start-Sleep -Milliseconds 250 }
}
if (-not $item) { "item '$Name' not found in the Explorer window"; $win.Quit(); exit 1 }
$navTitleBefore = (Get-Process NeuralNav -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle
# A real mouse double-click on the item, then the cursor goes back where it was
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Mouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Double(int x, int y) {
    POINT old; GetCursorPos(out old);
    SetCursorPos(x, y); System.Threading.Thread.Sleep(80);
    for (int i = 0; i < 2; i++) { mouse_event(2, 0, 0, 0, IntPtr.Zero); mouse_event(4, 0, 0, 0, IntPtr.Zero); System.Threading.Thread.Sleep(60); }
    System.Threading.Thread.Sleep(80); SetCursorPos(old.X, old.Y);
  }
}
"@
[Mouse]::SetProcessDPIAware() | Out-Null
[Mouse]::SetForegroundWindow([IntPtr]$win.HWND) | Out-Null
Start-Sleep -Milliseconds 300
$item = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem } | Select-Object -First 1
$r = $item.Current.BoundingRectangle
[Mouse]::Double([int]($r.X + 30), [int]($r.Y + $r.Height / 2))
Start-Sleep -Seconds 4
$navTitle = (Get-Process NeuralNav -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle
"after double-click: Explorer shows '$($win.LocationName)'; NeuralNav title '$navTitleBefore' -> '$navTitle'"
$win.Quit()
