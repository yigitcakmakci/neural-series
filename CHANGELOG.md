# Changelog

All notable changes to Neural Series are listed here. Versions follow [Semantic Versioning](https://semver.org/).
Every major and minor release carries a codename from the map of Neo-Istanbul; patch releases keep the codename of
their line.

## 1.2.0 "Galata" (2026-10-22)

All six apps are at 1.2.0. Run the new setup over an existing installation; options, settings and personal data are
kept.

### New: one theme for the series

- Pick a theme in NeuralPad, NeuralNav, NeuralTerm, NeuralWeb or NeuralView and the others that are open switch to it
  within a moment (about 0.2 s); the ones that are closed start with it next time. NeuralCalc has no themes.
- Each of these apps has a **"Temayı seriyle eşitle"** (follow the series theme) switch at the end of its theme menu,
  on by default; NeuralWeb also shows it under *Ayarlar → Görünüm*. Switched off, the app keeps its own theme and
  neither follows nor changes the others; switched on again, it takes the series theme.
- The windows of one app (several NeuralPad, NeuralNav or NeuralTerm windows) now always change theme together.
- The shared theme lives in `%APPDATA%\NeuralSeries\theme.json`, written through a temporary file and a rename and
  watched by every app. When two apps change it at once, the change that lands last wins everywhere; an app that
  follows never writes back, so changes cannot bounce between apps.

### Changed

- **Setup:** *"Ayarlarımı ve kişisel verilerimi de sil"* (also delete my settings and personal data) removes the
  shared theme folder too.
- **NeuralTerm:** its menu can show check marks.

## 1.1.1 "Karakoy" (2026-10-22)

All six apps are at 1.1.1. Run the new setup over an existing installation; options, settings and personal data are
kept.

### Changed

- **Setup:** NeuralView is registered in the Default apps list of Windows Settings (*Settings → Apps → Default apps →
  NeuralView*), with the twelve picture types it opens. Making it the default picture app is still your choice:
  Windows lets only the user change a default, so the setup never does it on its own. The entries belong to the
  NeuralView *Open with* option and are removed with it.
- **Setup:** the last page has a **"Varsayılan resim uygulaması yap…"** button (make it the default picture app) next
  to NeuralWeb's browser button; it opens NeuralView's page in Settings.

## 1.1.0 "Karakoy" (2026-10-22)

A new unit joins the series: **NeuralView VW-3**, an image viewer. All six apps are at 1.1.0: NeuralCalc KX-9,
NeuralPad NP-7, NeuralNav NV-4, NeuralTerm NT-5, NeuralWeb NW-1, NeuralView VW-3.

### New: NeuralView VW-3

- Opens JPEG, PNG, GIF (animated), WebP, BMP, ICO, SVG and AVIF. HEIC/HEIF files are listed, and the viewer says
  plainly that it cannot decode them instead of failing silently.
- Steps through the images of the folder with `←` `→`, the mouse wheel or the thumbnail strip; sorts by name, date
  or size, and follows changes to the folder while it is open.
- Fit to window, actual size, `Ctrl` + wheel zoom around the pointer, drag to pan, double-click to switch between fit
  and 100 %; `F11` full screen and a slideshow on `Space`.
- `R` / `Shift+R` turn the picture on screen; saving asks first. JPEG rotation is lossless (only the EXIF orientation
  changes), PNG and BMP are rewritten without loss, WebP at the highest quality; other formats turn on screen only.
- Information panel (`I`): dimensions, file size, dates and EXIF data (camera, lens, exposure, aperture, ISO, focal
  length). Pictures that carry GPS coordinates get a clear *"contains location data"* warning.
- Copy the picture (`Ctrl+C`) or its path, show it in NeuralNav (`Ctrl+E`), rename (`F2`), move it to the Recycle Bin
  (`Del`, asks first), open by drag and drop, shortcut list on `?` or `F1`.

### Changed

- **NeuralNav:** images get *"NeuralView ile aç"* (open with NeuralView) in their right-click menu. Double-clicking
  still opens them with the Windows default.
- **Setup:** new option *"NeuralView: resimler için Birlikte aç"*: NeuralView joins *Open with* for twelve image
  extensions. The default picture app does not change, and uninstalling removes the entries again.
- **Setup:** updating an installation from an earlier release offers the programs added since then as checked; a
  program left out on purpose stays out at later updates (`kurulum.ini` now records which programs the setup knew).

## 1.0.1 "Neo-Istanbul" (2026-10-22)

All five apps are at 1.0.1: NeuralCalc KX-9, NeuralPad NP-7, NeuralNav NV-4, NeuralTerm NT-5, NeuralWeb NW-1.
Run the new setup over an existing installation; options, settings and personal data are kept.

### Changed

- **Bundled typefaces.** All five apps now ship their fonts (Chakra Petch, Rajdhani, Share Tech Mono, and NeuralPad's
  editor fonts IBM Plex Mono, JetBrains Mono, Space Mono and Oxanium) as local WOFF2 files instead of loading them
  from Google Fonts. The apps look the same offline, starting them no longer contacts Google, and Turkish letters
  (ğ ş İ) come from the latin-ext subsets. The OFL-1.1 license texts are installed next to the fonts.
- NeuralWeb's internal `neural://` pages load the fonts through their own protocol handler; their Content Security
  Policy now allows fonts only from the app itself (`font-src 'self'`) and no longer lists Google's font servers.
- `build.ps1` copies the fonts from the `@fontsource` npm packages (pinned in `package.json`) into every app.

## 1.0.0 "Neo-Istanbul" (2026-10-22)

First public release.

### Apps

| Unit | Model | Version |
|---|:-:|:-:|
| NeuralCalc | KX-9 | 1.0.0 |
| NeuralPad | NP-7 | 1.0.0 |
| NeuralNav | NV-4 | 1.0.0 |
| NeuralTerm | NT-5 | 1.0.0 |
| NeuralWeb | NW-1 | 1.0.0 |

- **NeuralCalc KX-9:** scientific calculator with expression readout, DEG/RAD, memory, ANS, key sounds and full keyboard input.
- **NeuralPad NP-7:** tabbed notepad with multiple windows, session restore (unsaved tabs included), find and replace,
  go to line, UTF-8 / UTF-16 / Windows-1254, CRLF / LF / CR, zoom, print and four themes.
- **NeuralNav NV-4:** tabbed file explorer with quick access, drives, details and tiles views, preview pane, background
  copy and move with conflict handling, Recycle Bin, undo, and optional replacement of File Explorer.
- **NeuralTerm NT-5:** tabbed terminal on xterm.js and ConPTY for Windows PowerShell, PowerShell 7, Command Prompt,
  Git Bash and WSL, with the `nt` command and a folder context menu.
- **NeuralWeb NW-1:** Chromium-based browser with the shield (ad, tracker and malware blocking), password manager
  protected by Windows Hello, Edge import, private windows, bookmarks, history and downloads.

### Setup

- One per-user setup for all apps; no administrator rights.
- Optional Windows integration, every part reversible: Start menu, browser registration, *Open with*, context menus,
  `nt` command, NeuralNav as the default folder opener, Explorer watcher, Windows icon set.
- Shared Electron 44.5.1 runtime through hard links; each app gets its own executable, icon, version info and
  AppUserModelID, and taskbar pins are kept across updates.
- Uninstaller in **Settings → Apps** that restores every Windows setting, optionally with the user's data.
- The payload is verified against its CRCs while it is written, so a damaged download cannot install broken files.
