# Changelog

All notable changes to Neural Series are listed here. Versions follow [Semantic Versioning](https://semver.org/).
Every major and minor release carries a codename from the map of Neo-Istanbul; patch releases keep the codename of
their line.

## 1.8.0 "Taksim" (2026-11-11)

A new unit joins the series: **NeuralSnap SN-8**, a screenshot tool. All nine apps are at 1.8.0. Run the new setup over
an existing installation: it adds NeuralSnap and keeps your options, settings and personal data.

### New: NeuralSnap SN-8

- Waits in the background from sign-in and takes a screenshot on **`Ctrl+Alt+S`** (changeable in its settings). The
  screen freezes at once: drag a region, click a window, or press `Enter` for the whole display; `Esc` cancels. A
  magnifier and the selection's size in pixels help to hit the edge.
- The picture goes straight to the clipboard and, unless you switch it off, is saved in `Pictures\NeuralSnap`.
- The editor marks it up: arrow, rectangle, pen, highlighter, text and **pixelate**, which hides personal data for good
  (the blocks are computed from the picture, they cannot be turned back). Undo and redo, copy, save, save as, open in
  NeuralView.
- **Pin** keeps a picture on top of every window as a small frame you can move and zoom.
- A small C# helper, `sngrab`, copies the screen and the outlines of the open windows. The frozen screen stays in memory;
  nothing is uploaded.
- Themes, the series theme, Turkish and English, and the update check, like every app.

### Changed

- **NeuralDeck:** `snap` / `ekran` / `yakala` takes a screenshot with NeuralSnap; "screenshot" and "ekran görüntüsü"
  find NeuralSnap.
- **Setup:** NeuralSnap is offered, checked, when updating. A new *Seçenekler* (Options) page holds the apps that start
  with Windows (NeuralDeck, and NeuralSnap, on by default) and the update check, so every page fits with nine apps.

## 1.7.0 "Moda" (2026-11-11)

A new unit joins the series: **NeuralPulse PL-2**, a system monitor. All eight apps are at 1.7.0. Run the new setup over
an existing installation: it adds NeuralPulse and keeps your options, settings and personal data.

### New: NeuralPulse PL-2

- Live graphs of the last 60 seconds: processor (total and each core), memory (and the commit charge), every physical
  disk (read, write, active time), the network adapters and the graphics card (busiest engine and dedicated memory).
- The process list: CPU, memory and file location of every process, sorted by any column, searchable by name, PID or
  location; open a process's location in NeuralNav, copy its path, or end it. Ending asks first and works on your own
  processes only (no administrator rights); Windows' processes and NeuralPulse itself are refused.
- A small C# helper, `plsensor`, reads Windows' performance counters and the process table about once a second (about
  1 % of one core) and pauses while the window is minimized. Nothing is sent anywhere.
- Themes, the series theme, Turkish and English, and the update check, like every app.

### Changed

- **NeuralDeck:** `cpu` / `işlemci` shows the processor and memory load and the three busiest processes, measured by
  NeuralPulse's helper; `Enter` opens NeuralPulse. "Task manager" and "görev yöneticisi" find NeuralPulse.
- **Setup:** NeuralPulse is offered, checked, when updating. The apps page lists the apps in three columns.

## 1.6.0 "Ortakoy" (2026-11-10)

The apps tell you when a new version of the series is out. All seven apps are at 1.6.0. Run the new setup over an
existing installation; options, settings and personal data are kept.

### New

- **New versions.** Once a day, the first Neural app you open asks GitHub for the series' latest release; the other
  apps use its answer, so the series asks at most once a day whatever is open. A newer version is announced once with a
  Windows notification, and clicking it opens the release page (in NeuralWeb when it is installed). The apps' theme
  menus (NeuralWeb: *Settings → Appearance*; NeuralDeck: its settings) show *"New version: v…"* until you update.
  Nothing is downloaded or installed by itself.
- **One switch for the series:** *Check for new versions* (*Yeni sürümleri denetle*) in every app and on the setup's
  apps page, on by default; `guncelleme` in `/secenekler:` for unattended installs. When it is off, the apps make no
  request at all. The state lives in `%APPDATA%\NeuralSeries\update.json`.
- The request is a plain GET of the public latest release on `api.github.com` with a generic User-Agent; drafts and
  pre-releases are never offered.

### Build

- GitHub Actions builds the setup with `build.ps1` for every push and pull request and runs the unit tests; the setup
  is kept with the run. A version tag also opens a draft release with the setup, its SHA-256 and the notes from this
  changelog (`.github\workflows\build.yml`, `tools\release-notes.js`).

## 1.5.0 "Beyoglu" (2026-11-06)

The series speaks English too. Every app, the setup and the uninstaller show their texts in Turkish or English, one
language for the whole series. All seven apps are at 1.5.0. Run the new setup over an existing installation; options,
settings and personal data are kept.

### New

- **One language for the series.** Pick *Türkçe* or *English* on the setup's first page, or later in any app under
  *Dil · Language* (the theme menu; NeuralWeb: *Ayarlar → Görünüm*; NeuralDeck: its settings; NeuralCalc: a `TR | EN`
  switch). The change shows the next time each app starts. Without a choice the apps follow Windows' display
  language: Turkish on a Turkish Windows, English on any other. The choice is stored in
  `%APPDATA%\NeuralSeries\language.json`.
- **Everything is translated:** menus, dialogs, toasts, tooltips, status bars, the shortcut lists, NeuralWeb's own
  pages, the calculator's errors, NeuralDeck's suggestions (its command words work in both languages, and
  "not defteri" finds NeuralPad as well as "notepad"), default names such as *New folder* or *Untitled.txt*, and the
  dates and numbers, which follow the interface language.
- **Setup:** `/dil:tr` / `/dil:en` switch. Start menu names, context menu entries, file type and Default apps
  descriptions, the uninstall entry and the setup log follow the setup's language; an update in another language
  renames the shortcuts. The switches and the folder names stay Turkish.

### Changed

- The interface texts moved into `lang\tr.json` and `lang\en.json` in each app, with two shared modules,
  `apps\shared\language.js` and `apps\shared\i18n.js`; the setup's texts into `installer\src\Strings.cs`. The
  calculator engine reports error codes, which each app translates.
- NeuralWeb asks Google for search suggestions in the interface language.

## 1.4.0 "Kadikoy" (2026-10-23)

The apps hand off to each other: each piece of work goes to the Neural app made for it. All seven apps are at 1.4.0.
Run the new setup over an existing installation; options, settings and personal data are kept.

### New

- **NeuralNav:** double-click or `Enter` opens pictures in NeuralView and `.txt`, `.md` and `.log` files in NeuralPad.
  With several files selected, NeuralView gets the first picture (it pages through the folder itself) and NeuralPad all
  the notes in one window. Other files open with their Windows program, as before.
- **NeuralTerm:** `Ctrl`+click a path in the output to open it in NeuralNav (a folder, or a file's folder with the file
  selected), or a web address to open it in NeuralWeb. Paths are underlined under the pointer with a hint; absolute
  paths, network shares and relative paths count, a relative path being read from the folder of the nearest prompt
  (`PS C:\…>`, `C:\…>`) or `Directory:` header above it. Only paths that exist become links, and a slow network drive
  cannot freeze the window.
- **NeuralWeb downloads:** *Aç* opens a picture in NeuralView and a `.txt`, `.md` or `.log` file in NeuralPad;
  *Klasörde göster* and *İndirme klasörünü aç* open NeuralNav (the file selected).
- When the app a hand-off needs is not installed, Windows takes over: File Explorer, the default browser, or the
  file's default app.

### Changed

- The hand-offs live in one module, `apps\shared\handoff.js`, used by NeuralNav, NeuralTerm and NeuralWeb: the program
  for each kind of file, where the other apps are, and how they start (their executable with an argument array, never
  through a shell).

### Fixed

- **NeuralTerm:** after `Enter` restarts a shell that had ended, the status bar no longer keeps saying *sonlandı*.

## 1.3.0 "Levent" (2026-10-23)

A new unit joins the series: **NeuralDeck DK-0**, a launcher and command palette. All seven apps are at 1.3.0. Run the
new setup over an existing installation: it adds NeuralDeck and keeps your options, settings and personal data.

### New: NeuralDeck DK-0

- Waits in the background (icon in the notification area) and drops a panel in at the top of the screen on
  **`Alt+Space`**. The shortcut can be changed under *ayarlar*; when another program already holds it, NeuralDeck says
  so instead of failing silently. `Esc` or a click elsewhere puts the panel away.
- Fuzzy matching over the apps (name, model code, Turkish description, letters in order), arrow keys, `Enter` to run,
  `Tab` to complete a command word or a path.
- Commands, in Turkish and English: `=`/`calc`/`hesap` (calculator, `Enter` copies the result), `nav`/`gez` and
  `term`/`nt` with path completion, `pad` and `view` with recently opened files, `web` (http/https only), `ara`/`search`
  (Google in NeuralWeb), `tema`/`theme` (the series theme), `ayarlar`/`settings`.
- Starts only the Neural apps and web addresses, with arguments as an array and never through a shell; the page asks
  the main process for suggestions and can only name one of them by its number. Commands for apps that are not
  installed are greyed out.

### Changed

- **NeuralCalc:** its engine (lexer, evaluator, number format) moved to `apps\shared\calc-engine.js`, which NeuralDeck
  uses too; the calculator works as before.
- **Setup:** new option *"NeuralDeck: açılışta başlat"* (start NeuralDeck with Windows, off by default). The
  setup and the uninstaller stop a running NeuralDeck themselves, like the Explorer watcher, and an update starts it
  again when it was running.

## 1.2.1 "Galata" (2026-10-23)

All six apps are at 1.2.1. Run the new setup over an existing installation; options, settings and personal data are
kept.

### Fixed

- **NeuralWeb:** closing a window could show *"A JavaScript error occurred in the main process … Object has been
  destroyed"* now and then. When the pointer had just been over a link, the page could still report it while the
  window was already gone. NeuralWeb now drops messages for windows that are closed and takes a closing window out of
  its list before its tabs shut down (`tests\neuralweb\test-close.js` reproduces the old error).

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
