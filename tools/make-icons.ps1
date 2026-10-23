<#
.SYNOPSIS
  Draws every icon of the Neural series: the seven app icons, the setup icon and the optional Windows icon set.

.DESCRIPTION
  All icons share one tile: a yellow chamfered frame (top-right and bottom-left corners cut) around a dark core,
  with a yellow and cyan glyph. Coordinates are on a 256 grid; each .ico holds PNG frames of 16 to 256 px.
  The results are committed, so this only needs to run after changing a glyph.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
#>
param([string]$Root = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$yellowC = [System.Drawing.Color]::FromArgb(255, 252, 238, 10)
$cyanC = [System.Drawing.Color]::FromArgb(255, 0, 240, 255)
$panelC = [System.Drawing.Color]::FromArgb(255, 12, 13, 21)

function New-TilePng([int]$size, [scriptblock]$glyph) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 256.0
  $Y = New-Object System.Drawing.SolidBrush $yellowC
  $C = New-Object System.Drawing.SolidBrush $cyanC
  $D = New-Object System.Drawing.SolidBrush $panelC
  $pt = { param($x, $y) New-Object System.Drawing.PointF ([float]($x * $s)), ([float]($y * $s)) }
  $poly = { param($brush, [double[]]$xy)
    $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
    for ($i = 0; $i -lt $xy.Length; $i += 2) { $pts.Add((& $pt $xy[$i] $xy[$i + 1])) }
    $g.FillPolygon($brush, $pts.ToArray()) }
  $rect = { param($brush, $x, $y, $w, $h) $g.FillRectangle($brush, [float]($x * $s), [float]($y * $s), [float]($w * $s), [float]($h * $s)) }
  $stroke = { param($color, $width, [double[]]$xy, [bool]$closed)
    $pen = New-Object System.Drawing.Pen $color, ([float]([math]::Max(1, $width * $s)))
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
    $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
    for ($i = 0; $i -lt $xy.Length; $i += 2) { $pts.Add((& $pt $xy[$i] $xy[$i + 1])) }
    if ($closed) { $g.DrawPolygon($pen, $pts.ToArray()) } else { $g.DrawLines($pen, $pts.ToArray()) }
    $pen.Dispose() }

  & $poly $Y @(8, 8, 196, 8, 248, 60, 248, 248, 60, 248, 8, 196)
  & $poly $D @(28, 28, 188, 28, 228, 68, 228, 228, 68, 228, 28, 188)
  & $glyph
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ,$ms.ToArray()
}

# Writes <path>.ico (16-256 px) and, when asked, the 256 px frame as a PNG.
function Save-Icon([string]$path, [scriptblock]$glyph, [string]$png) {
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $sizes = @(16, 24, 32, 48, 64, 256)
  $pngs = New-Object 'System.Collections.Generic.List[byte[]]'
  foreach ($sz in $sizes) { $pngs.Add((New-TilePng $sz $glyph)) }
  $ico = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ico
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
    $offset += $pngs[$i].Length
  }
  foreach ($data in $pngs) { $bw.Write($data) }
  $bw.Flush()
  [IO.File]::WriteAllBytes($path, $ico.ToArray())
  if ($png) { [IO.File]::WriteAllBytes($png, $pngs[$pngs.Count - 1]) }
}

# ---------- app icons and the setup icon ----------
$apps = [ordered]@{
  'neuralcalc' = {   # "=" bars and a cyan status mark
    & $rect $Y 68 96 120 26
    & $rect $Y 68 140 120 26
    & $rect $C 46 48 30 8
  }
  'neuralpad' = {    # text lines and a cyan caret
    & $rect $Y 60 76 136 20
    & $rect $Y 60 112 136 20
    & $rect $Y 60 148 84 20
    & $rect $C 154 142 18 32
  }
  'neuralnav' = {    # folder with a cyan arrow
    & $poly $Y @(58, 76, 110, 76, 124, 92, 198, 92, 198, 186, 58, 186)
    & $rect $D 58 106 140 6
    & $poly $C @(96, 130, 138, 130, 138, 120, 164, 144, 138, 168, 138, 158, 96, 158)
  }
  'neuralterm' = {   # ">_" prompt
    & $poly $Y @(62, 82, 84, 82, 134, 128, 84, 174, 62, 174, 112, 128)
    & $rect $C 132 156 62 18
  }
  'neuralweb' = {    # cyan globe with yellow meridians
    $cyanPen = New-Object System.Drawing.Pen $cyanC, ([float]([Math]::Max(1.5, 15 * $s)))
    $yellowPen = New-Object System.Drawing.Pen $yellowC, ([float]([Math]::Max(1.2, 11 * $s)))
    $g.DrawEllipse($cyanPen, [float](64 * $s), [float](64 * $s), [float](128 * $s), [float](128 * $s))
    if ($size -ge 24) { $g.DrawEllipse($yellowPen, [float](104 * $s), [float](66 * $s), [float](48 * $s), [float](124 * $s)) }
    $g.DrawLine($yellowPen, [float](68 * $s), [float](128 * $s), [float](188 * $s), [float](128 * $s))
  }
  'neuralview' = {   # picture frame with mountains and a cyan sun
    & $stroke $yellowC 12 @(62, 70, 194, 70, 194, 186, 62, 186) $true
    & $poly $Y @(74, 176, 112, 118, 134, 148, 154, 128, 182, 176)
    & $rect $C 140 86 26 26
  }
  'neuraldeck' = {   # command palette: an input bar with a cyan prompt over two result rows
    & $stroke $yellowC 10 @(56, 66, 200, 66, 200, 108, 56, 108) $true
    & $poly $C @(70, 76, 84, 76, 100, 87, 84, 98, 70, 98, 86, 87)
    & $rect $C 108 82 30 10
    & $rect $Y 56 126 144 20
    & $rect $Y 56 160 96 20
  }
}
foreach ($name in $apps.Keys) { Save-Icon (Join-Path $Root "apps\$name\$name.ico") $apps[$name] (Join-Path $Root "apps\$name\icon.png") }
Save-Icon (Join-Path $Root 'installer\src\setup.ico') {   # cyan arrow into a yellow tray
  & $poly $C @(112, 56, 144, 56, 144, 116, 174, 116, 128, 162, 82, 116, 112, 116)
  & $poly $Y @(64, 172, 84, 172, 84, 188, 172, 188, 172, 172, 192, 172, 192, 208, 64, 208)
} $null

# ---------- optional Windows icon set (file names are the ones the setup installs) ----------
$windows = [ordered]@{
  'bu-bilgisayar' = {      # This PC: monitor with a prompt and cursor
    & $stroke $cyanC 12 @(62, 70, 194, 70, 194, 156, 62, 156) $true
    & $stroke $yellowC 10 @(84, 94, 104, 113, 84, 132) $false
    & $rect $Y 114 124 30 10
    & $rect $Y 118 162 20 18
    & $rect $Y 86 180 84 12
  }
  'kullanici' = {          # user folder: chamfered helmet head with a visor, shoulders
    & $poly $Y @(100, 56, 146, 56, 158, 68, 158, 120, 112, 120, 100, 108)
    & $rect $C 108 80 44 11
    & $poly $Y @(68, 200, 82, 138, 174, 138, 188, 200)
    & $rect $C 110 160 36 8
  }
  'ag' = {                 # Network: three linked nodes
    & $stroke $cyanC 8 @(128, 71, 73, 169) $false
    & $stroke $cyanC 8 @(128, 71, 183, 169) $false
    & $stroke $cyanC 8 @(73, 169, 183, 169) $false
    & $rect $Y 113 56 30 30
    & $rect $Y 58 154 30 30
    & $rect $Y 168 154 30 30
  }
  'geri-donusum-bos' = {   # Recycle Bin, empty: outline, lid and slots
    & $rect $C 110 52 36 12
    & $rect $C 66 66 124 12
    & $stroke $cyanC 10 @(80, 92, 176, 92, 166, 202, 90, 202) $true
    & $rect $Y 104 108 8 78
    & $rect $Y 124 108 8 78
    & $rect $Y 144 108 8 78
  }
  'geri-donusum-dolu' = {  # Recycle Bin, full: lifted lid, filled body
    & $poly $C @(64, 74, 184, 50, 187, 62, 67, 86)
    & $poly $C @(106, 64, 140, 57, 142, 66, 108, 73)
    & $poly $Y @(78, 94, 178, 94, 167, 204, 89, 204)
    & $rect $D 104 110 8 76
    & $rect $D 124 110 8 76
    & $rect $D 144 110 8 76
  }
  'klasor' = {             # folder with a tab and a cyan status mark
    & $poly $Y @(56, 72, 110, 72, 124, 88, 200, 88, 200, 188, 56, 188)
    & $rect $D 56 102 144 6
    & $rect $C 70 166 44 9
  }
}
foreach ($name in $windows.Keys) { Save-Icon (Join-Path $Root "assets\windows-icons\$name.ico") $windows[$name] $null }

Get-ChildItem (Join-Path $Root 'apps'), (Join-Path $Root 'assets\windows-icons'), (Join-Path $Root 'installer\src') -Recurse -Include *.ico, icon.png |
  ForEach-Object { "{0,8}  {1}" -f $_.Length, $_.FullName.Substring($Root.Length + 1) }
