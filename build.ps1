<#
.SYNOPSIS
  Builds the seven Neural programs and the Windows setup from a clean clone.

.DESCRIPTION
  1. npm ci       Electron, xterm.js, the bundled typefaces (@fontsource) and NeuralWeb's ad blocker, at the
                  exact versions of the lock files.
  2. out\stage    Every program as the setup installs it: app files, icons, fonts, helper executables (compiled
                  with the C# compiler that ships with Windows), the shared Electron runtime and the Windows icon set.
  3. out\Neural-Setup-<version>.exe
                  The setup program with out\stage appended as a zip:
                  [setup program][zip][8-byte zip offset]["NRLPAKET"]

  Needs Windows 10 or 11 (for the .NET Framework 4.x C# compiler) and Node.js with npm.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build.ps1 -SkipNpm    # reuse the node_modules folders
#>
param([switch]$SkipNpm)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$out = Join-Path $root 'out'
$stage = Join-Path $out 'stage'
$obj = Join-Path $out 'obj'
$fw = "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319"
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { throw "C# compiler not found: $csc" }

function Invoke-Csc([string[]]$arguments) {
  & $csc /nologo /optimize+ @arguments
  if ($LASTEXITCODE -ne 0) { throw "csc failed: $($arguments[-1])" }
}
function Invoke-Npm([string]$dir, [string[]]$arguments) {
  Push-Location $dir
  try {
    & npm @arguments
    if ($LASTEXITCODE -ne 0) { throw "npm $($arguments -join ' ') failed in $dir" }
  } finally { Pop-Location }
}
function Copy-Files([string]$from, [string]$to, [string[]]$names) {
  New-Item -ItemType Directory -Force $to | Out-Null
  foreach ($name in $names) { Copy-Item (Join-Path $from $name) (Join-Path $to $name) -Force }
}
# Bundled typefaces: the given style sheets from assets\fonts, every WOFF2 file they name (from the @fontsource
# packages) and each family's SIL Open Font License text as <family>-OFL.txt.
function Copy-Fonts([string]$to, [string[]]$sheets) {
  New-Item -ItemType Directory -Force $to | Out-Null
  foreach ($sheet in $sheets) {
    $css = Join-Path $root "assets\fonts\$sheet"
    Copy-Item $css (Join-Path $to $sheet) -Force
    foreach ($m in [regex]::Matches([IO.File]::ReadAllText($css), 'url\("(([a-z0-9-]+?)-latin(?:-ext)?-\d{3}-(?:normal|italic)\.woff2)"\)')) {
      $file = $m.Groups[1].Value; $family = $m.Groups[2].Value
      $pkg = Join-Path $root "node_modules\@fontsource\$family"
      if (-not (Test-Path "$pkg\files\$file")) { throw "font file missing: @fontsource/$family/files/$file (run without -SkipNpm)" }
      Copy-Item "$pkg\files\$file" (Join-Path $to $file) -Force
      Copy-Item "$pkg\LICENSE" (Join-Path $to "$family-OFL.txt") -Force
    }
  }
}

# ---------- 1. dependencies ----------
if (-not $SkipNpm) {
  Invoke-Npm $root @('ci', '--no-audit', '--no-fund')
  Invoke-Npm (Join-Path $root 'apps\neuralweb') @('ci', '--omit=dev', '--no-audit', '--no-fund')
}
$electron = Join-Path $root 'node_modules\electron\dist'
$electronVersion = $package.devDependencies.electron
# The electron package fetches its runtime on first use (checksums are part of the package; downloads are cached
# in %LOCALAPPDATA%\electron\Cache), not while npm installs it.
if (-not (Test-Path (Join-Path $electron 'version'))) {
  & node (Join-Path $root 'node_modules\electron\install.js')
  if ($LASTEXITCODE -ne 0) { throw 'the Electron runtime could not be fetched' }
}
if ((Get-Content (Join-Path $electron 'version') -ErrorAction SilentlyContinue) -ne $electronVersion) {
  throw "Electron $electronVersion is missing from node_modules; run build.ps1 without -SkipNpm"
}
$xterm = Join-Path $root 'node_modules\@xterm'
$webModules = Join-Path $root 'apps\neuralweb\node_modules'
if (-not (Test-Path $webModules)) { throw "apps\neuralweb\node_modules is missing; run build.ps1 without -SkipNpm" }

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $stage, $obj | Out-Null
# out\fonts holds every bundled typeface; the README images (docs\src) use it too.
Copy-Fonts "$out\fonts" @('fonts.css', 'editor-fonts.css')

# ---------- 2. stage: shared Electron runtime and the exe every program is made from ----------
Get-ChildItem $electron -Recurse -File | Where-Object { $_.Extension -ne '.exe' } | ForEach-Object {
  $target = Join-Path "$stage\electron" $_.FullName.Substring($electron.Length + 1)
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  Copy-Item $_.FullName $target
}
New-Item -ItemType Directory -Force "$stage\base" | Out-Null
Copy-Item (Join-Path $electron 'electron.exe') "$stage\base\electron.exe"

# ---------- 2. stage: the programs ----------
$apps = Join-Path $root 'apps'

# NeuralCalc KX-9: one HTML page (it also runs in a plain browser), wrapped into a full document for the shell
$calc = "$stage\apps\NeuralCalc"
Copy-Files "$apps\neuralcalc" $calc @('main.js', 'preload.js', 'package.json', 'icon.png', 'neuralcalc.ico')
$head = "<!doctype html>`n<html lang=`"tr`" class=`"is-shell`">`n<head>`n<meta charset=`"utf-8`">`n" +
  "<meta name=`"viewport`" content=`"width=device-width, initial-scale=1`">`n<meta name=`"color-scheme`" content=`"dark`">`n" +
  "<link rel=`"icon`" type=`"image/png`" href=`"icon.png`">`n</head>`n<body>"
$body = [IO.File]::ReadAllText("$apps\neuralcalc\neuralcalc.html", [Text.Encoding]::UTF8)
# the engine (shared with NeuralDeck) lies next to the page in the installed program
$body = $body.Replace('<script src="../shared/calc-engine.js"></script>', '<script src="calc-engine.js"></script>')
[IO.File]::WriteAllText("$calc\index.html", $head + $body + "`n</body>`n</html>`n", (New-Object Text.UTF8Encoding($false)))
Copy-Item "$apps\shared\calc-engine.js" "$calc\calc-engine.js"
Copy-Fonts "$calc\fonts" @('fonts.css')

# NeuralPad NP-7, with the extra typefaces of its editor font menu
Copy-Files "$apps\neuralpad" "$stage\apps\NeuralPad" @('index.html', 'styles.css', 'app.js', 'main.js', 'preload.js', 'package.json', 'icon.png', 'neuralpad.ico')
Copy-Fonts "$stage\apps\NeuralPad\fonts" @('fonts.css', 'editor-fonts.css')

# NeuralNav NV-4, with its shell helper and the Explorer watcher
$nav = "$stage\apps\NeuralNav"
Copy-Files "$apps\neuralnav" $nav @('index.html', 'styles.css', 'app.js', 'main.js', 'preload.js', 'ops.js', 'package.json', 'icon.png', 'neuralnav.ico')
Copy-Fonts "$nav\fonts" @('fonts.css')
Invoke-Csc @('/target:exe', '/reference:System.Windows.Forms.dll', "/out:$nav\nvhelper.exe", "$apps\neuralnav\nvhelper.cs")
Invoke-Csc @('/target:winexe', '/reference:Microsoft.CSharp.dll', '/reference:System.Core.dll', "/out:$nav\nvwatch.exe", "$apps\neuralnav\nvwatch.cs")

# NeuralTerm NT-5, with its pseudo-console bridge and xterm.js
$term = "$stage\apps\NeuralTerm"
Copy-Files "$apps\neuralterm" $term @('index.html', 'styles.css', 'app.js', 'links.js', 'main.js', 'preload.js', 'package.json', 'icon.png', 'neuralterm.ico')
Copy-Fonts "$term\fonts" @('fonts.css')
Invoke-Csc @('/target:exe', '/unsafe', '/platform:x64', "/out:$term\ntpty.exe", "$apps\neuralterm\ntpty.cs")
New-Item -ItemType Directory -Force "$term\vendor" | Out-Null
Copy-Item "$xterm\xterm\lib\xterm.js" "$term\vendor\xterm.js"
Copy-Item "$xterm\xterm\css\xterm.css" "$term\vendor\xterm.css"
Copy-Item "$xterm\addon-fit\lib\addon-fit.js" "$term\vendor\addon-fit.js"
Copy-Item "$xterm\xterm\LICENSE" "$term\vendor\xterm-LICENSE.txt"

# NeuralWeb NW-1, with the ad blocker and the password manager's helpers (DPAPI for the Edge import, Windows Hello)
$web = "$stage\apps\NeuralWeb"
Copy-Files "$apps\neuralweb" $web @('main.js', 'store.js', 'shield.js', 'passwords.js', 'preload-ui.js', 'preload-page.js', 'package.json', 'icon.png', 'neuralweb.ico')
Copy-Item $webModules "$web\node_modules" -Recurse
foreach ($sub in 'ui', 'pages') { Copy-Item "$apps\neuralweb\$sub" "$web\$sub" -Recurse }
Copy-Item "$apps\neuralweb\ui\theme.css" "$web\pages\theme.css" -Force
Copy-Fonts "$web\fonts" @('fonts.css')   # served to the neural:// pages as neural://<page>/fonts/...
$wm = "$env:SystemRoot\System32\WinMetadata"
Invoke-Csc @('/target:exe', '/platform:x64', "/r:$fw\System.Security.dll", "/out:$web\nwdpapi.exe", "$apps\neuralweb\nwdpapi.cs")
Invoke-Csc @('/target:winexe', '/platform:x64', "/r:$wm\Windows.Foundation.winmd", "/r:$wm\Windows.Security.winmd",
  "/r:$fw\System.Runtime.dll", "/r:$fw\System.Runtime.InteropServices.WindowsRuntime.dll", "/out:$web\nwhello.exe", "$apps\neuralweb\nwhello.cs")

# NeuralView VW-3, with its metadata reader (EXIF, lossless JPEG rotation)
Copy-Files "$apps\neuralview" "$stage\apps\NeuralView" @('index.html', 'styles.css', 'app.js', 'main.js', 'preload.js', 'meta.js', 'package.json', 'icon.png', 'neuralview.ico')
Copy-Fonts "$stage\apps\NeuralView\fonts" @('fonts.css')

# NeuralDeck DK-0, with the calculator engine it shares with NeuralCalc
$deck = "$stage\apps\NeuralDeck"
Copy-Files "$apps\neuraldeck" $deck @('index.html', 'styles.css', 'app.js', 'main.js', 'preload.js', 'commands.js', 'package.json', 'icon.png', 'neuraldeck.ico')
Copy-Item "$apps\shared\calc-engine.js" "$deck\calc-engine.js"
Copy-Fonts "$deck\fonts" @('fonts.css')

# The series theme module, next to the main.js of every program that follows the series theme (NeuralCalc has none)
foreach ($a in 'NeuralPad', 'NeuralNav', 'NeuralTerm', 'NeuralWeb', 'NeuralView', 'NeuralDeck') { Copy-Item "$apps\shared\theme-sync.js" "$stage\apps\$a\theme-sync.js" }
# The hand-off module (which series program opens a file, a folder or an address), next to the programs that hand off
foreach ($a in 'NeuralNav', 'NeuralTerm', 'NeuralWeb') { Copy-Item "$apps\shared\handoff.js" "$stage\apps\$a\handoff.js" }

# Windows icon set (optional in the setup: This PC, Recycle Bin, Network, user folder)
Copy-Files (Join-Path $root 'assets\windows-icons') "$stage\simgeler" (Get-ChildItem (Join-Path $root 'assets\windows-icons') -Filter *.ico | ForEach-Object Name)

# ---------- 3. setup program ----------
$src = Join-Path $root 'installer\src'
$info = @"
using System.Reflection;
[assembly: AssemblyTitle("Neural Series Setup")]
[assembly: AssemblyDescription("Installs, updates and removes the Neural Series apps")]
[assembly: AssemblyCompany("Neural Systems")]
[assembly: AssemblyProduct("Neural Series")]
[assembly: AssemblyCopyright("GPL-3.0-or-later")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
namespace NeuralSetup { static class BuildInfo { public const string Version = "$version"; } }
"@
[IO.File]::WriteAllText("$obj\BuildInfo.cs", $info, (New-Object Text.UTF8Encoding($false)))
$stub = "$obj\setup.exe"
Invoke-Csc @('/target:winexe', '/platform:x64', '/codepage:65001', "/win32manifest:$src\app.manifest", "/win32icon:$src\setup.ico", "/out:$stub",
  "/r:$fw\System.Windows.Forms.dll", "/r:$fw\System.Drawing.dll", "/r:$fw\System.IO.Compression.dll", "/r:$fw\System.IO.Compression.FileSystem.dll",
  "$src\Program.cs", "$src\Engine.cs", "$src\Controls.cs", "$src\Wizard.cs", "$obj\BuildInfo.cs")

$zip = "$obj\payload.zip"
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

$setup = Join-Path $out "Neural-Setup-$version.exe"
$fs = [IO.File]::Create($setup)
try {
  foreach ($part in $stub, $zip) { $in = [IO.File]::OpenRead($part); try { $in.CopyTo($fs) } finally { $in.Dispose() } }
  $tail = [BitConverter]::GetBytes([Int64](Get-Item $stub).Length) + [Text.Encoding]::ASCII.GetBytes('NRLPAKET')
  $fs.Write($tail, 0, $tail.Length)
} finally { $fs.Dispose() }

$size = (Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum
"programs staged:  {0:N0} MB" -f ($size / 1MB)
"setup:            $setup ({0:N0} MB)" -f ((Get-Item $setup).Length / 1MB)
"sha256:           $((Get-FileHash $setup -Algorithm SHA256).Hash)"
