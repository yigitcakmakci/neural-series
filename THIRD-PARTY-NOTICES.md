# Third-party notices

Neural Series is licensed under the [GNU General Public License v3.0 or later](LICENSE). It includes, or uses at run time,
the following third-party work. Each remains under its own license.

## Distributed with the setup

### Electron 44.5.1

- License: MIT
- Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc.
- Source: <https://github.com/electron/electron>

The shared runtime of all five apps. Electron includes Chromium, Node.js and their dependencies. Their license texts
are installed with every app as `LICENSE` (Electron) and `LICENSES.chromium.html` (Chromium and everything it bundles),
in `Neural\Ortak\Electron` and in each `Neural\<App>\Program` folder.

### xterm.js 6.0.0 and @xterm/addon-fit 0.11.0 (NeuralTerm)

- License: MIT
- Copyright (c) 2017-2019, The xterm.js authors; Copyright (c) 2014-2016, SourceLair Private Company;
  Copyright (c) 2012-2013, Christopher Jeffrey
- Source: <https://github.com/xtermjs/xterm.js>

The terminal emulator inside NeuralTerm. Its license text is installed as `resources\app\vendor\xterm-LICENSE.txt`.

### Ghostery ad blocker 2.18.2 (NeuralWeb)

| Package | Version | License |
|---|---|---|
| `@ghostery/adblocker` | 2.18.2 | MPL-2.0 |
| `@ghostery/adblocker-content` | 2.18.2 | MPL-2.0 |
| `@ghostery/adblocker-electron` | 2.18.2 | MPL-2.0 |
| `@ghostery/adblocker-electron-preload` | 2.18.2 | MPL-2.0 |
| `@ghostery/adblocker-extended-selectors` | 2.18.2 | MPL-2.0 |
| `@ghostery/url-parser` | 1.3.1 | MPL-2.0 |
| `@remusao/guess-url-type`, `@remusao/small`, `@remusao/smaz`, `@remusao/smaz-compress`, `@remusao/smaz-decompress`, `@remusao/trie` | 2.1.0 – 2.2.0 | MPL-2.0 |
| `tldts-core`, `tldts-experimental` | 7.4.16 | MIT, Copyright (c) 2017 Thomas Parisot, 2018 Rémi Berson |

The blocking engine behind NeuralWeb's shield. These packages are distributed unmodified inside NeuralWeb
(`resources\app\node_modules`), each with its license. The source code of the MPL-2.0 packages is available at
<https://github.com/ghostery/adblocker> and from the npm registry.

## Used at run time, not distributed

### Filter lists (NeuralWeb)

NeuralWeb downloads these lists while it runs and refreshes them every few days; they are not part of this repository
or the setup:

- EasyList and EasyPrivacy, <https://easylist.to/> (GPL-3.0 or CC BY-SA 3.0)
- uBlock Origin filters, <https://github.com/uBlockOrigin/uAssets> (GPL-3.0)
- Peter Lowe's ad and tracking server list, <https://pgl.yoyo.org/adservers/>

### Typefaces (all apps)

Loaded from Google Fonts when an app starts; not bundled:

- Chakra Petch by Cadson Demak, SIL Open Font License 1.1
- Rajdhani by Indian Type Foundry, SIL Open Font License 1.1
- Share Tech Mono by Carrois Apostrophe, SIL Open Font License 1.1

### Windows components

The helper programs and the setup are compiled with the C# compiler of the .NET Framework that is part of Windows, and
they call Windows APIs (ConPTY, DPAPI, Windows Hello, the shell). Nothing from Windows is redistributed.
