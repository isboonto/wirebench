# Contributing to JumperCraft

Thank you for helping! JumperCraft is a breadboard designer and Arduino / electronics simulator for teaching. Problem reports, ideas and pull requests are all welcome.

## Report a problem or suggest a feature

In JumperCraft, open **Help → Report a problem…** or **Help → Suggest a feature…** — they open the right form on GitHub (the problem form already has your JumperCraft version filled in). You can also go to [Issues](https://github.com/isboonto/jumpercraft/issues) directly.

A good problem report says what you did, what you expected and what happened. If it happens with a particular circuit, **File → Save** the project and attach the `.wbproj` file.

## Send a pull request

1. **Fork** the repository and create a branch from `main` (for example `fix-servo-angle`).
2. Make your change and test it (see below).
3. Open a pull request against `main`. Describe what it changes and how you tested it; write "Fixes #123" if it fixes an issue.

Small, focused pull requests are easiest to review. For a big change, please open an issue first so we can agree on the approach.

### Branches

- `main` is the **1.x** line: fixes and new parts / examples for the current app. Pull requests go here.
- `2.x` is **version 2** in progress (UNO Q Python apps, data logger, PCB view, …); see the draft pull request "JumperCraft 2.0 (work in progress)".

## Run it locally

**Web version** (all you need is [Node.js](https://nodejs.org/)):

```
node serve.js
```

then open http://localhost:8080. The app is plain HTML, CSS and JavaScript in `web/` — no build step; reload the page after a change.

**Desktop app and the Rust solver** (Windows): install [Rust](https://rustup.rs/), then

```
.\build.ps1 -Test
```

builds the WebAssembly solver (`web/wasm/wb_core.wasm`) and the desktop app, and runs the solver's tests (`cargo test -p wb-core`). Add `-Installer` for the Windows installers (needs `cargo install tauri-cli --version "^2"`).

## Where things are

See **Project layout** in the [README](README.md). The usual places:

- **A new part:** copy a `WB.defPart(...)` block in `web/js/parts.js` (or `parts-more.js`). A part declares its pins, its SVG drawing and its electrical elements. Add its schematic symbol to `SYMBOLS` in `web/js/schematic.js`.
- **A new example:** `web/js/examples.js`.
- **Arduino functions and libraries:** `web/js/runtime.js` (and `web/js/sketch.js` for the C++ → JavaScript translation).
- **Help pages and the changelog:** `web/js/help.js`.

## Things to keep in mind

- **New script files** go into `web/index.html` twice: as a `<script>` tag and as a `<link rel="preload">`, in the same order (`build.ps1` checks this).
- **Don't rename** the stored names that start with `wirebench` (browser storage keys, the `"wirebench-project"` file format tag, the `.wbproj` extension, the app identifier): they keep users' autosaves, settings and project files working from older versions.
- The web version runs under a strict Content Security Policy: no inline scripts or `onclick="…"` attributes, and scripts only from the app's own files.
- Write user-facing text in plain language — many users are students.

## License

By contributing, you agree that your contribution is released under the [MIT License](LICENSE), like the rest of JumperCraft.
