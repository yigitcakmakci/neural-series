param([string]$Name = 'TasTablet-NotDefteri')
# Opens a desktop icon the way a double-click does (its default action, run inside explorer.exe)
# and reports whether NeuralNav or a Windows Explorer window answered.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$sh = New-Object -ComObject Shell.Application
$explorerBefore = @($sh.Windows() | ForEach-Object { $_.HWND })
$navTitleBefore = (Get-Process NeuralNav -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle

# The desktop icon list lives under Progman or a WorkerW window: SHELLDLL_DefView > SysListView32
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class DeskWin {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  public static IntPtr DesktopList() {
    IntPtr top = IntPtr.Zero;
    while ((top = FindWindowEx(IntPtr.Zero, top, null, null)) != IntPtr.Zero) {
      IntPtr view = FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (view != IntPtr.Zero) { IntPtr list = FindWindowEx(view, IntPtr.Zero, "SysListView32", null); if (list != IntPtr.Zero) return list; }
    }
    return IntPtr.Zero;
  }
}
"@
$hwnd = [DeskWin]::DesktopList()
if ($hwnd -eq [IntPtr]::Zero) { "desktop icon list not found"; exit 1 }
$list = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
$nameCond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), $Name
$icon = $list.FindFirst([System.Windows.Automation.TreeScope]::Children, $nameCond)
if (-not $icon) { "desktop icon '$Name' not found"; exit 1 }
$pattern = $null
if ($icon.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); "invoked desktop icon '$Name'" }
else { "icon has no invoke action"; exit 1 }

Start-Sleep -Seconds 4
$newExplorer = @($sh.Windows() | Where-Object { $explorerBefore -notcontains $_.HWND })
$navTitle = (Get-Process NeuralNav -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle
"new Windows Explorer windows: $($newExplorer.Count)" + $(if ($newExplorer.Count) { " (" + (($newExplorer | ForEach-Object { $_.LocationName }) -join ', ') + ")" })
"NeuralNav title before: '$navTitleBefore'  after: '$navTitle'"
foreach ($w in $newExplorer) { $w.Quit() }
if ($newExplorer.Count) { "closed the Explorer window(s) the test opened" }
