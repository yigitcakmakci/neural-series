# Changelog

All notable changes to Neural Series are listed here. Versions follow [Semantic Versioning](https://semver.org/), and
every release carries a codename from the map of Neo-Istanbul.

## Unreleased

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
